'use strict';

const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const db = require('../database/db');
const { extractText, hasEnoughText } = require('./ocrService');
const { analyzeDocument } = require('./aiService');
const { matchSupplier } = require('./supplierMatchingService');
const { matchHotel } = require('./hotelMatchingService');

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
 * Sucht sowohl nach Absendertext als auch nach Lieferanten-ID (stabiler bei
 * leicht abweichenden Schreibweisen in aufeinanderfolgenden Uploads).
 */
function applyLearnedCorrections(documentId, sender, supplierId = null) {
  if (!sender && !supplierId) return 0;

  let learned;
  if (supplierId) {
    learned = db.prepare(`
      SELECT field_name, human_value, bot_value, COUNT(*) as count
      FROM bot_corrections
      WHERE (sender_id = ? OR (sender = ? AND sender IS NOT NULL))
        AND human_value IS NOT NULL AND human_value != ''
      GROUP BY field_name, human_value
      HAVING count >= 1
      ORDER BY count DESC
    `).all(supplierId, sender || '');
  } else {
    learned = db.prepare(`
      SELECT field_name, human_value, bot_value, COUNT(*) as count
      FROM bot_corrections
      WHERE sender = ? AND human_value IS NOT NULL AND human_value != ''
      GROUP BY field_name, human_value
      HAVING count >= 1
      ORDER BY count DESC
    `).all(sender);
  }

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

  // Build: most frequent human correction per field + which bot_value it replaces
  const learnedByField = {};
  for (const l of learned) {
    if (!learnedByField[l.field_name]) {
      learnedByField[l.field_name] = { human: l.human_value, bot: l.bot_value };
    }
  }

  const appliedFields = [];
  for (const [field, { human, bot }] of Object.entries(learnedByField)) {
    const current = fields[field];
    if (current == null || current === '' || String(current) === bot) {
      fields[field] = human;
      appliedFields.push(field);
    }
  }

  if (appliedFields.length > 0) {
    db.prepare('UPDATE documents SET extracted_fields = ?, learned_corrections_count = ? WHERE id = ?')
      .run(JSON.stringify(fields), appliedFields.length, documentId);
  }

  return appliedFields;
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
    // Step 1: OCR (mit automatischem Retry)
    logStep(documentId, 'ocr', 'running', `OCR gestartet für ${path.basename(doc.file_path)}`);
    const ocrStart = Date.now();
    const MAX_OCR_ATTEMPTS = 2;
    let ocrAttempt = 0;
    let ocrSuccess = false;
    while (ocrAttempt < MAX_OCR_ATTEMPTS && !ocrSuccess) {
      ocrAttempt++;
      try {
        const ocrResult = await extractText(doc.file_path, doc.file_type);
        ocrText = ocrResult.text;
        ocrConfidence = ocrResult.confidence;
        ocrSuccess = true;
        const ocrSecs = ((Date.now() - ocrStart) / 1000).toFixed(1);
        const attempt = ocrAttempt > 1 ? ` (Versuch ${ocrAttempt})` : '';
        logStep(
          documentId,
          'ocr',
          'success',
          `OCR abgeschlossen in ${ocrSecs}s${attempt}. ${ocrText.length} Zeichen extrahiert. Konfidenz: ${ocrConfidence}%`
        );
      } catch (ocrErr) {
        if (ocrAttempt < MAX_OCR_ATTEMPTS) {
          logStep(documentId, 'ocr', 'running', `OCR Versuch ${ocrAttempt} fehlgeschlagen, wiederhole... (${ocrErr.message})`);
          await new Promise((r) => setTimeout(r, 2000));
        } else {
          logStep(documentId, 'ocr', 'error', `OCR nach ${MAX_OCR_ATTEMPTS} Versuchen fehlgeschlagen: ${ocrErr.message}`);
          ocrText = '';
        }
      }
    }

    // Step 2: AI Analysis
    // Voranalyse: Absender ermitteln damit Lernbeispiele in den KI-Prompt geladen werden.
    // Zweistufig:
    //   1. Regelbasierter Scan (findet nur Firmen mit GmbH/AG/... Suffix)
    //   2. Zeilenweise Suche im OCR-Text gegen Lieferantendatenbank (findet alle)
    const { analyzeWithRules } = require('./aiService');
    const quickScan = ocrText ? analyzeWithRules(ocrText) : null;
    let senderHint = quickScan && quickScan.sender ? quickScan.sender : null;
    let preSupplierId = null;

    if (senderHint) {
      // Regel-Scan hat Treffer → direkt gegen DB prüfen
      try {
        const preMatch = matchSupplier(senderHint, null, null);
        if (preMatch.matched) preSupplierId = preMatch.supplier_id;
      } catch (_) {}
    }

    if (!preSupplierId && ocrText) {
      // Kein Treffer vom Regel-Scan (z.B. Lieferant ohne GmbH/AG im Namen):
      // Erste 20 sinnvolle Zeilen einzeln gegen Lieferantenliste testen.
      // Das stellt sicher, dass auch für "Müller Bäckerei" o.ä. Lernkorrekturen
      // geladen werden, auch wenn der Name keine Rechtsform enthält.
      try {
        const lines = ocrText
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l.length >= 5 && !/^\d/.test(l)) // keine reinen Zahlenzeilen
          .slice(0, 20);
        for (const line of lines) {
          const lineMatch = matchSupplier(line, null, null);
          if (lineMatch.matched && lineMatch.score >= 82) {
            preSupplierId = lineMatch.supplier_id;
            if (!senderHint) senderHint = lineMatch.supplier_name;
            logStep(documentId, 'ai_analysis', 'info',
              `Lieferant per Zeilenscan gefunden: "${lineMatch.supplier_name}" (Score: ${lineMatch.score}%) → Lernhinweise geladen`);
            break;
          }
        }
      } catch (_) {}
    }

    logStep(documentId, 'ai_analysis', 'running', 'KI-Analyse gestartet (Ollama)');
    const aiStart = Date.now();
    try {
      aiResult = await analyzeDocument(ocrText, senderHint, preSupplierId);
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

    // Step 3: Supplier matching (Name + IBAN + USt-ID)
    const extractedFields = aiResult.extracted_fields || {};
    const extractedIban = extractedFields.iban || null;
    const extractedUstId = extractedFields.ust_id || null;

    if (aiResult.sender || extractedIban || extractedUstId) {
      const matchInfo = [aiResult.sender, extractedIban && `IBAN: ${extractedIban}`, extractedUstId && `USt-ID: ${extractedUstId}`].filter(Boolean).join(' | ');
      logStep(documentId, 'supplier_matching', 'running', `Lieferantenabgleich: ${matchInfo}`);
      try {
        matchResult = matchSupplier(aiResult.sender, extractedIban, extractedUstId);
        logStep(
          documentId,
          'supplier_matching',
          matchResult.matched ? 'success' : 'info',
          matchResult.matched
            ? `Lieferant gefunden: ${matchResult.supplier_name} (Score: ${matchResult.score}%, Methode: ${matchResult.match_method || 'name'}${matchResult.vendor_code ? ', Nr: ' + matchResult.vendor_code : ''})`
            : `Kein Lieferant gefunden für: ${aiResult.sender || 'unbekannt'}`
        );
      } catch (matchErr) {
        logStep(documentId, 'supplier_matching', 'error', `Lieferantenabgleich fehlgeschlagen: ${matchErr.message}`);
      }
    } else {
      logStep(documentId, 'supplier_matching', 'info', 'Kein Absender/IBAN/USt-ID erkannt, Abgleich übersprungen');
    }

    // Step 3b: Hotel matching – für welche Geschäftsstelle ist die Rechnung?
    let hotelMatch = null;
    try {
      hotelMatch = matchHotel(ocrText);
      if (hotelMatch) {
        logStep(documentId, 'hotel_matching', 'success', `Hotel erkannt: ${hotelMatch.hotel_name} (Kostenstelle: ${hotelMatch.hotel_code}, Score: ${hotelMatch.score}%)`);
      } else {
        logStep(documentId, 'hotel_matching', 'info', 'Keine Geschäftsstelle im Dokument erkannt');
      }
    } catch (hotelErr) {
      logStep(documentId, 'hotel_matching', 'error', `Hotel-Erkennung fehlgeschlagen: ${hotelErr.message}`);
    }

    // Step 4: Konfidenz nach Lieferantenabgleich erhöhen
    // Ollama schätzt oft konservativ – wenn wir den Lieferanten eindeutig kennen,
    // ist die tatsächliche Sicherheit deutlich höher als Ollamals Schätzung.
    let finalConfidence = aiResult.confidence;
    if (matchResult.matched) {
      if (matchResult.match_method === 'iban' || matchResult.match_method === 'ust_id') {
        // Exakte Kennung (IBAN/USt-ID) → praktisch 100% Sicherheit
        finalConfidence = Math.max(finalConfidence, 92);
      } else if (matchResult.score >= 90) {
        finalConfidence = Math.max(finalConfidence, 85);
      } else if (matchResult.score >= 75) {
        finalConfidence = Math.max(finalConfidence, 78);
      }
      if (finalConfidence > aiResult.confidence) {
        logStep(documentId, 'confidence_boost', 'info',
          `Konfidenz erhöht: ${aiResult.confidence}% → ${finalConfidence}% (Lieferant gefunden per ${matchResult.match_method || 'name'}, Score: ${matchResult.score}%)`);
      }
    }

    // Step 4b: Calculate traffic light
    const threshold = getConfidenceThreshold();
    finalAmpel = calculateAmpel(aiResult.doc_type, finalConfidence, matchResult.matched, threshold);

    logStep(documentId, 'ampel', 'success', `Ampel: ${finalAmpel} (Typ: ${aiResult.doc_type}, Konfidenz: ${finalConfidence}%, Lieferant: ${matchResult.matched ? 'ja' : 'nein'})`);

    // Step 4c: Apply learned text corrections for this sender (sucht auch per sender_id)
    const learnedFields = applyLearnedCorrections(documentId, aiResult.sender, matchResult.supplier_id);
    if (learnedFields.length > 0) {
      logStep(documentId, 'learned_corrections', 'info', `${learnedFields.length} gelernte Feld-Korrekturen für Absender "${aiResult.sender}" automatisch angewendet.`);
      // Jede angewendete Lernkorrektur = das System kennt diesen Lieferanten gut → Konfidenz steigt
      const learnBoost = Math.min(15, learnedFields.length * 4);
      const boostedConf = Math.min(95, finalConfidence + learnBoost);
      if (boostedConf > finalConfidence) {
        logStep(documentId, 'confidence_boost', 'info',
          `Konfidenz durch ${learnedFields.length} Lernkorrekturen erhöht: ${finalConfidence}% → ${boostedConf}%`);
        finalConfidence = boostedConf;
      }
    }

    // Step 4d: Apply learned region-based corrections (OCR specific areas)
    const regionCount = await applyLearnedRegions(documentId, aiResult.sender);
    if (regionCount > 0) {
      logStep(documentId, 'learned_regions', 'info', `${regionCount} Felder via gelernte Markierungsbereiche für "${aiResult.sender}" extrahiert.`);
    }

    // Step 4e: Feldherkünfte zusammenstellen (für UI-Anzeige)
    const fieldSources = {};
    // Alle KI-extrahierten Felder → Quelle "ki"
    if (aiResult.extracted_fields) {
      for (const [key, value] of Object.entries(aiResult.extracted_fields)) {
        if (value != null && String(value).trim()) fieldSources[key] = 'ki';
      }
    }
    if (aiResult.sender) fieldSources.absender = 'ki';
    // Lieferant per Datenbank-Abgleich gefunden → Absender + ggf. IBAN/USt-ID aus DB
    if (matchResult.matched) {
      fieldSources.absender = 'datenbank';
      if (matchResult.match_method === 'iban') fieldSources.iban = 'datenbank';
      if (matchResult.match_method === 'ust_id') fieldSources.ust_id = 'datenbank';
    }
    // Hotel per Datenbank → Kostenstelle aus DB
    if (hotelMatch) fieldSources.hotel_code = 'datenbank';
    // Gelernte Korrekturen überschreiben
    for (const field of learnedFields) fieldSources[field] = 'gelernt';

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
        field_sources = ?,
        hotel_id = ?,
        hotel_code = ?,
        hotel_name = ?,
        processed_at = datetime('now')
      WHERE id = ?
    `).run(
      aiResult.doc_type,
      aiResult.sender,
      matchResult.matched ? 1 : 0,
      matchResult.supplier_id || null,
      finalConfidence,
      JSON.stringify({
        doc_type: aiResult.doc_type,
        sender: aiResult.sender,
        confidence: aiResult.confidence,
        ampel: aiResult.ampel,
        vendor_code: matchResult.vendor_code || null,
      }),
      aiResult.reasoning,
      finalAmpel,
      aiResult.extracted_fields ? JSON.stringify(aiResult.extracted_fields) : null,
      JSON.stringify(fieldSources),
      hotelMatch ? hotelMatch.hotel_id : null,
      hotelMatch ? hotelMatch.hotel_code : null,
      hotelMatch ? hotelMatch.hotel_name : null,
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
