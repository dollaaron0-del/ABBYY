'use strict';

const { v4: uuidv4 } = require('uuid');
const path = require('path');
const db = require('../database/db');
const { extractText, hasEnoughText } = require('./ocrService');
const { analyzeDocument } = require('./aiService');
const { matchSupplier } = require('./supplierMatchingService');

/**
 * Log a processing step to the database.
 */
function logStep(documentId, step, status, message) {
  try {
    db.prepare(`
      INSERT INTO processing_log (id, document_id, step, status, message)
      VALUES (?, ?, ?, ?, ?)
    `).run(uuidv4(), documentId, step, status, message || null);
  } catch (err) {
    console.error(`Failed to log step ${step} for document ${documentId}:`, err.message);
  }
}

/**
 * Get the confidence threshold from settings.
 */
function getConfidenceThreshold() {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'confidence_threshold'").get();
    return row ? parseInt(row.value, 10) : 75;
  } catch {
    return 75;
  }
}

/**
 * Check if auto-forwarding to ABBYY is enabled.
 */
function isAutoForwardEnabled() {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'auto_forward_green'").get();
    return row && row.value === 'true';
  } catch {
    return false;
  }
}

/**
 * Calculate the traffic light (Ampel) based on processing results.
 *
 * Green (gruen):  Known doc type (Rechnung/Mahnung/Behördenbescheid)
 *                 AND confidence >= threshold
 *                 AND supplier matched
 *
 * Yellow (gelb):  Known doc type BUT (confidence < threshold OR supplier not matched)
 *
 * Red (rot):      doc_type is Unleserlich OR Sonstiges
 */
function calculateAmpel(docType, confidence, supplierMatched, threshold) {
  const knownTypes = ['Rechnung', 'Mahnung', 'Behördenbescheid'];

  if (!knownTypes.includes(docType)) {
    return 'rot';
  }

  if (confidence >= threshold && supplierMatched) {
    return 'gruen';
  }

  return 'gelb';
}

/**
 * Forward a document to ABBYY FlexiCapture if enabled.
 */
async function forwardToAbbyy(documentId) {
  try {
    const settingsRows = db.prepare(`
      SELECT key, value FROM settings WHERE key IN ('abbyy_enabled', 'abbyy_endpoint', 'abbyy_auth_token')
    `).all();
    const s = {};
    for (const r of settingsRows) s[r.key] = r.value;

    if (s.abbyy_enabled !== 'true' || !s.abbyy_endpoint) {
      return;
    }

    // Use the ABBYY route logic directly
    const axios = require('axios');
    const fs = require('fs');
    const FormData = require('form-data');

    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(documentId);
    if (!doc || !fs.existsSync(doc.file_path)) return;

    const form = new FormData();
    form.append('file', fs.createReadStream(doc.file_path), {
      filename: doc.original_name,
    });
    form.append('document_id', doc.id);
    form.append('doc_type', doc.doc_type || '');
    form.append('sender', doc.sender || '');
    form.append('confidence', String(doc.confidence || 0));
    form.append('ampel', doc.ampel || 'rot');

    const headers = { ...form.getHeaders() };
    if (s.abbyy_auth_token) {
      headers.Authorization = `Bearer ${s.abbyy_auth_token}`;
    }

    await axios.post(
      `${s.abbyy_endpoint.replace(/\/$/, '')}/documents/upload`,
      form,
      { headers, timeout: 60000 }
    );

    db.prepare("UPDATE documents SET status = 'forwarded' WHERE id = ?").run(documentId);
    logStep(documentId, 'abbyy_forward', 'success', 'Automatisch an ABBYY weitergeleitet');
  } catch (err) {
    logStep(documentId, 'abbyy_forward', 'error', `Auto-Weiterleitung fehlgeschlagen: ${err.message}`);
  }
}

/**
 * Main document processing pipeline.
 * Steps:
 *   1. Load document from DB
 *   2. OCR (extract text from file)
 *   3. AI analysis (classify document, extract sender)
 *   4. Supplier matching (fuzzy match sender against supplier list)
 *   5. Traffic light assignment
 *   6. Save results to DB
 *   7. Optional: auto-forward to ABBYY if green
 *
 * @param {string} documentId - UUID of the document to process
 */
async function processDocument(documentId) {
  console.log(`[Processor] Starting processing for document ${documentId}`);

  // Step 0: Load document
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(documentId);
  if (!doc) {
    throw new Error(`Document ${documentId} not found in database`);
  }

  db.prepare("UPDATE documents SET status = 'processing' WHERE id = ?").run(documentId);
  logStep(documentId, 'start', 'success', 'Verarbeitung gestartet');

  let ocrText = '';
  let ocrConfidence = 0;
  let aiResult = null;
  let matchResult = { matched: false, supplier_id: null, supplier_name: null, score: 0 };
  let finalAmpel = 'rot';

  try {
    // Step 1: OCR
    logStep(documentId, 'ocr', 'running', `OCR gestartet für ${path.basename(doc.file_path)}`);
    try {
      const ocrResult = await extractText(doc.file_path, doc.file_type);
      ocrText = ocrResult.text;
      ocrConfidence = ocrResult.confidence;

      logStep(
        documentId,
        'ocr',
        'success',
        `OCR abgeschlossen. ${ocrText.length} Zeichen extrahiert. Konfidenz: ${ocrConfidence}%`
      );
    } catch (ocrErr) {
      logStep(documentId, 'ocr', 'error', `OCR fehlgeschlagen: ${ocrErr.message}`);
      // Continue with empty text - AI will classify as Unleserlich
      ocrText = '';
    }

    // Step 2: AI Analysis
    logStep(documentId, 'ai_analysis', 'running', 'KI-Analyse gestartet');
    try {
      aiResult = await analyzeDocument(ocrText);
      logStep(
        documentId,
        'ai_analysis',
        'success',
        `KI-Analyse: ${aiResult.doc_type}, Absender: ${aiResult.sender || 'unbekannt'}, Konfidenz: ${aiResult.confidence}%`
      );
    } catch (aiErr) {
      logStep(documentId, 'ai_analysis', 'error', `KI-Analyse fehlgeschlagen: ${aiErr.message}`);
      aiResult = {
        doc_type: 'Sonstiges',
        sender: null,
        confidence: 0,
        reasoning: `KI-Analyse fehlgeschlagen: ${aiErr.message}`,
        ampel: 'rot',
      };
    }

    // Step 3: Supplier matching
    if (aiResult.sender) {
      logStep(documentId, 'supplier_matching', 'running', `Lieferantenabgleich für: ${aiResult.sender}`);
      try {
        matchResult = matchSupplier(aiResult.sender);
        logStep(
          documentId,
          'supplier_matching',
          matchResult.matched ? 'success' : 'info',
          matchResult.matched
            ? `Lieferant gefunden: ${matchResult.supplier_name} (Score: ${matchResult.score}%)`
            : `Kein Lieferant gefunden für: ${aiResult.sender}`
        );
      } catch (matchErr) {
        logStep(documentId, 'supplier_matching', 'error', `Lieferantenabgleich fehlgeschlagen: ${matchErr.message}`);
      }
    } else {
      logStep(documentId, 'supplier_matching', 'info', 'Kein Absender vom KI erkannt, Lieferantenabgleich übersprungen');
    }

    // Step 4: Calculate traffic light
    const threshold = getConfidenceThreshold();
    finalAmpel = calculateAmpel(aiResult.doc_type, aiResult.confidence, matchResult.matched, threshold);

    logStep(documentId, 'ampel', 'success', `Ampel: ${finalAmpel} (Typ: ${aiResult.doc_type}, Konfidenz: ${aiResult.confidence}%, Lieferant: ${matchResult.matched ? 'ja' : 'nein'})`);

    // Step 5: Save results to DB
    db.prepare(`
      UPDATE documents SET
        status = 'processed',
        doc_type = ?,
        sender = ?,
        sender_matched = ?,
        sender_id = ?,
        confidence = ?,
        ai_suggestion = ?,
        ai_reasoning = ?,
        ampel = ?,
        extracted_fields = ?,
        processed_at = datetime('now')
      WHERE id = ?
    `).run(
      aiResult.doc_type,
      aiResult.sender,
      matchResult.matched ? 1 : 0,
      matchResult.supplier_id || null,
      aiResult.confidence,
      JSON.stringify({
        doc_type: aiResult.doc_type,
        sender: aiResult.sender,
        confidence: aiResult.confidence,
        ampel: aiResult.ampel,
      }),
      aiResult.reasoning,
      finalAmpel,
      aiResult.extracted_fields ? JSON.stringify(aiResult.extracted_fields) : null,
      documentId
    );

    logStep(documentId, 'complete', 'success', 'Verarbeitung erfolgreich abgeschlossen');
    console.log(`[Processor] Document ${documentId} processed: ${aiResult.doc_type}, Ampel: ${finalAmpel}`);

    // Step 6: Auto-forward to ABBYY if green and enabled
    if (finalAmpel === 'gruen' && isAutoForwardEnabled()) {
      logStep(documentId, 'abbyy_forward', 'running', 'Automatische Weiterleitung an ABBYY...');
      await forwardToAbbyy(documentId);
    }
  } catch (err) {
    console.error(`[Processor] Fatal error for document ${documentId}:`, err);

    db.prepare(`
      UPDATE documents SET
        status = 'error',
        ampel = 'rot',
        ai_reasoning = ?,
        processed_at = datetime('now')
      WHERE id = ?
    `).run(`Verarbeitungsfehler: ${err.message}`, documentId);

    logStep(documentId, 'error', 'error', `Kritischer Fehler: ${err.message}`);

    throw err;
  }
}

module.exports = { processDocument, calculateAmpel };
