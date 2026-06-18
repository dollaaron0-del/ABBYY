'use strict';

const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
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
 * Apply learned field corrections for a known sender.
 * A correction is "learned" when the same human_value was entered ≥2 times
 * for the same sender + field. Only fills in fields that are currently null.
 */
function applyLearnedCorrections(documentId, sender) {
  if (!sender) return 0;

  const learned = db.prepare(`
    SELECT field_name, human_value, COUNT(*) as count
    FROM bot_corrections
    WHERE sender = ? AND human_value IS NOT NULL AND human_value != ''
    GROUP BY field_name, human_value
    HAVING count >= 2
    ORDER BY count DESC
  `).all(sender);

  if (learned.length === 0) return 0;

  const doc = db.prepare('SELECT extracted_fields FROM documents WHERE id = ?').get(documentId);
  if (!doc) return 0;

  let fields = {};
  try {
    if (doc.extracted_fields) {
      fields = typeof doc.extracted_fields === 'string'
        ? JSON.parse(doc.extracted_fields)
        : doc.extracted_fields;
    }
  } catch (_) {}

  // Only fill fields that are currently null (don't override AI results)
  const learnedByField = {};
  for (const l of learned) {
    if (!learnedByField[l.field_name]) learnedByField[l.field_name] = l.human_value;
  }

  let applied = 0;
  for (const [field, value] of Object.entries(learnedByField)) {
    if (fields[field] == null) {
      fields[field] = value;
      applied++;
    }
  }

  if (applied > 0) {
    db.prepare('UPDATE documents SET extracted_fields = ?, learned_corrections_count = ? WHERE id = ?')
      .run(JSON.stringify(fields), applied, documentId);
  }

  return applied;
}

/**
 * Apply learned region-based corrections for a known sender.
 * If the same field's region was marked ≥2 times for this sender,
 * OCR that averaged region on the new document and fill in null fields.
 */
async function applyLearnedRegions(documentId, sender) {
  if (!sender) return 0;

  const learnedRegions = db.prepare(`
    SELECT field_name,
           AVG(region_x) as rx, AVG(region_y) as ry,
           AVG(region_w) as rw, AVG(region_h) as rh,
           COUNT(*) as count
    FROM bot_corrections
    WHERE sender = ?
      AND region_x IS NOT NULL AND region_y IS NOT NULL
    GROUP BY field_name
    HAVING count >= 2
  `).all(sender);

  if (learnedRegions.length === 0) return 0;

  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(documentId);
  if (!doc || !fs.existsSync(doc.file_path)) return 0;

  let fields = {};
  try {
    if (doc.extracted_fields) {
      fields = typeof doc.extracted_fields === 'string'
        ? JSON.parse(doc.extracted_fields) : doc.extracted_fields;
    }
  } catch (_) {}

  const { extractRegion } = require('./ocrService');
  let applied = 0;

  for (const reg of learnedRegions) {
    if (fields[reg.field_name] != null) continue;
    try {
      const ocr = await extractRegion(doc.file_path, doc.file_type,
        { x: reg.rx, y: reg.ry, w: reg.rw, h: reg.rh });
      if (ocr.text && ocr.text.trim().length > 0) {
        fields[reg.field_name] = ocr.text.trim();
        applied++;
      }
    } catch (_) {}
  }

  if (applied > 0) {
    db.prepare('UPDATE documents SET extracted_fields = ?, learned_corrections_count = ? WHERE id = ?')
      .run(JSON.stringify(fields), (doc.learned_corrections_count || 0) + applied, documentId);
  }

  return applied;
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
    const ocrStart = Date.now();
    try {
      const ocrResult = await extractText(doc.file_path, doc.file_type);
      ocrText = ocrResult.text;
      ocrConfidence = ocrResult.confidence;

      const ocrSecs = ((Date.now() - ocrStart) / 1000).toFixed(1);
      logStep(
        documentId,
        'ocr',
        'success',
        `OCR abgeschlossen in ${ocrSecs}s. ${ocrText.length} Zeichen extrahiert. Konfidenz: ${ocrConfidence}%`
      );
    } catch (ocrErr) {
      logStep(documentId, 'ocr', 'error', `OCR fehlgeschlagen: ${ocrErr.message}`);
      // Continue with empty text - AI will classify as Unleserlich
      ocrText = '';
    }

    // Step 2: AI Analysis
    logStep(documentId, 'ai_analysis', 'running', 'KI-Analyse gestartet (Ollama)');
    const aiStart = Date.now();
    try {
      aiResult = await analyzeDocument(ocrText);
      const aiSecs = ((Date.now() - aiStart) / 1000).toFixed(1);
      logStep(
        documentId,
        'ai_analysis',
        'success',
        `KI-Analyse in ${aiSecs}s: ${aiResult.doc_type}, Absender: ${aiResult.sender || 'unbekannt'}, Konfidenz: ${aiResult.confidence}%`
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

    // Step 4b: Apply learned text corrections for this sender
    const learnedCount = applyLearnedCorrections(documentId, aiResult.sender);
    if (learnedCount > 0) {
      logStep(documentId, 'learned_corrections', 'info', `${learnedCount} gelernte Feld-Korrekturen für Absender "${aiResult.sender}" automatisch angewendet.`);
    }

    // Step 4c: Apply learned region-based corrections (OCR specific areas)
    const regionCount = await applyLearnedRegions(documentId, aiResult.sender);
    if (regionCount > 0) {
      logStep(documentId, 'learned_regions', 'info', `${regionCount} Felder via gelernte Markierungsbereiche für "${aiResult.sender}" extrahiert.`);
    }

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
