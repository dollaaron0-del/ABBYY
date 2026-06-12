'use strict';

/**
 * ABBYY Bot API
 * Called by the C# script running inside ABBYY FlexiCapture Verification Station.
 * The script sends OCR text + existing ABBYY fields → we return corrected fields + decision.
 */

const express = require('express');
const { analyzeDocument } = require('../services/aiService');
const { matchSupplier } = require('../services/supplierMatchingService');
const db = require('../database/db');

const router = express.Router();

function getConfidenceThreshold() {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'confidence_threshold'").get();
    return row ? parseInt(row.value, 10) : 75;
  } catch { return 75; }
}

function getAutoCompleteThreshold() {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'abbyy_auto_complete_threshold'").get();
    return row ? parseInt(row.value, 10) : 90;
  } catch { return 90; }
}

/**
 * POST /api/abbyy/bot/analyze
 *
 * Request body (sent by C# ABBYY script):
 * {
 *   ocr_text: string,          // full OCR text from ABBYY document
 *   document_name: string,     // filename, for logging
 *   existing_fields: {         // fields already recognized by ABBYY (may be empty/wrong)
 *     absender?: string,
 *     rechnungsnummer?: string,
 *     rechnungsdatum?: string,
 *     betrag_brutto?: string,
 *     iban?: string,
 *     ...
 *   }
 * }
 *
 * Response:
 * {
 *   success: true,
 *   fields: { ... },           // all fields to fill into ABBYY
 *   decision: "auto_complete" | "manual_review",
 *   doc_type: string,
 *   confidence: number,
 *   supplier_matched: boolean,
 *   supplier_name: string | null,
 *   ampel: "gruen" | "gelb" | "rot",
 *   reason: string             // human-readable explanation for decision
 * }
 */
router.post('/analyze', async (req, res) => {
  const { ocr_text, document_name, existing_fields = {} } = req.body;

  if (!ocr_text && !document_name) {
    return res.status(400).json({ success: false, error: 'ocr_text oder document_name erforderlich' });
  }

  try {
    // Step 1: AI analysis
    const aiResult = await analyzeDocument(ocr_text || '');

    // Step 2: Supplier matching
    let matchResult = { matched: false, supplier_id: null, supplier_name: null, score: 0 };
    if (aiResult.sender) {
      try { matchResult = matchSupplier(aiResult.sender); } catch (_) {}
    }

    // Step 3: Merge AI fields with existing ABBYY fields
    // AI wins for empty ABBYY fields; keep ABBYY value if AI has nothing
    const extractedFields = aiResult.extracted_fields || {};
    const mergedFields = mergeFields(existing_fields, extractedFields, aiResult);

    // Step 4: Decision
    const threshold = getConfidenceThreshold();
    const autoThreshold = getAutoCompleteThreshold();
    const knownTypes = ['Rechnung', 'Mahnung', 'Behördenbescheid'];
    const isKnownType = knownTypes.includes(aiResult.doc_type);
    const hasRequiredFields = !!(mergedFields.rechnungsnummer && mergedFields.rechnungsdatum && mergedFields.betrag_brutto);

    let decision = 'manual_review';
    let reason = '';

    if (!isKnownType) {
      reason = `Dokumenttyp "${aiResult.doc_type}" nicht verarbeitbar`;
    } else if (aiResult.confidence < threshold) {
      reason = `Konfidenz ${aiResult.confidence}% unter Schwellenwert ${threshold}%`;
    } else if (!matchResult.matched) {
      reason = `Lieferant "${aiResult.sender || 'unbekannt'}" nicht in Lieferantenliste`;
    } else if (!hasRequiredFields) {
      const missing = ['rechnungsnummer', 'rechnungsdatum', 'betrag_brutto']
        .filter(f => !mergedFields[f]).join(', ');
      reason = `Pflichtfelder fehlen: ${missing}`;
    } else if (aiResult.confidence >= autoThreshold) {
      decision = 'auto_complete';
      reason = `Alle Bedingungen erfüllt (Konfidenz: ${aiResult.confidence}%, Lieferant: ${matchResult.supplier_name})`;
    } else {
      reason = `Konfidenz ${aiResult.confidence}% unter Auto-Abschluss-Schwelle ${autoThreshold}% – bitte prüfen`;
    }

    // Ampel
    let ampel = 'rot';
    if (isKnownType) {
      ampel = (aiResult.confidence >= threshold && matchResult.matched) ? 'gruen' : 'gelb';
    }

    res.json({
      success: true,
      fields: mergedFields,
      decision,
      doc_type: aiResult.doc_type,
      confidence: aiResult.confidence,
      supplier_matched: matchResult.matched,
      supplier_name: matchResult.supplier_name || null,
      ampel,
      reason,
    });
  } catch (err) {
    console.error('[AbbyyBot] Analyze error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/abbyy/bot/settings
 * Returns current bot settings for the C# script to read on startup.
 */
router.get('/settings', (req, res) => {
  try {
    const threshold = getConfidenceThreshold();
    const autoThreshold = getAutoCompleteThreshold();
    res.json({
      confidence_threshold: threshold,
      auto_complete_threshold: autoThreshold,
      version: '1.0.0',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/abbyy/bot/log
 * Receives log entries from the C# script (optional – for audit trail).
 */
router.post('/log', (req, res) => {
  const { document_name, action, details } = req.body;
  try {
    console.log(`[AbbyyBot] ${action} | ${document_name} | ${details}`);
    db.prepare(`
      INSERT INTO processing_log (id, document_id, step, status, message)
      VALUES (?, NULL, ?, 'info', ?)
    `).run(require('uuid').v4(), `abbyy_bot_${action}`, `[${document_name}] ${details}`);
  } catch (_) {}
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------

function mergeFields(abbyyFields, aiFields, aiResult) {
  const merged = {};

  // Map AI result fields to ABBYY field names
  const fieldMap = {
    absender:        aiResult.sender || aiFields.absender,
    absender_strasse: aiFields.absender_strasse || abbyyFields.absender_strasse,
    absender_plz:    aiFields.absender_plz || abbyyFields.absender_plz,
    absender_ort:    aiFields.absender_ort || abbyyFields.absender_ort,
    rechnungsnummer: aiFields.rechnungsnummer || abbyyFields.rechnungsnummer,
    rechnungsdatum:  aiFields.rechnungsdatum  || abbyyFields.rechnungsdatum,
    faelligkeitsdatum: aiFields.faelligkeitsdatum || abbyyFields.faelligkeitsdatum,
    betrag_brutto:   aiFields.betrag_brutto   || abbyyFields.betrag_brutto,
    betrag_netto:    aiFields.betrag_netto    || abbyyFields.betrag_netto,
    steuerbetrag:    aiFields.steuerbetrag    || abbyyFields.steuerbetrag,
    steuersatz:      aiFields.steuersatz      || abbyyFields.steuersatz,
    waehrung:        aiFields.waehrung        || abbyyFields.waehrung || 'EUR',
    iban:            aiFields.iban            || abbyyFields.iban,
    bic:             aiFields.bic             || abbyyFields.bic,
  };

  // Only include non-null values
  for (const [k, v] of Object.entries(fieldMap)) {
    if (v != null && String(v).trim() !== '') merged[k] = String(v).trim();
  }

  return merged;
}

module.exports = router;
