'use strict';

/**
 * abbyyLearning.js
 * ─────────────────────────────────────────────────────────
 * Lernt aus Korrekturen die der Nutzer DIREKT IN ABBYY macht.
 *
 * Ablauf:
 *   1. Dokument wird an ABBYY geschickt → gesendete Felder werden in
 *      documents.abbyy_sent_fields gespeichert
 *   2. Nutzer bearbeitet das Dokument in ABBYY und schließt es ab
 *   3. learnFromCompletedTasks() ruft die finalen Feldwerte aus ABBYY ab
 *   4. Vergleicht: gesendete Werte vs. finale Werte
 *   5. Jeder Unterschied = menschliche Korrektur → bot_corrections
 *   6. documents.abbyy_learned_at wird gesetzt (kein doppeltes Lernen)
 */

const { v4: uuidv4 } = require('uuid');
const db = require('../database/db');
const connector = require('./abbyyConnector');
const { invalidateSupplierCache } = require('./supplierMatchingService');

// Felder die beim Vergleich berücksichtigt werden
const LEARNABLE_FIELDS = [
  'absender', 'rechnungsnummer', 'rechnungsdatum', 'faelligkeitsdatum',
  'betrag_brutto', 'betrag_netto', 'steuerbetrag', 'steuersatz',
  'waehrung', 'iban', 'bic', 'ust_id',
  'absender_strasse', 'absender_plz', 'absender_ort', 'absender_land',
  'lieferantennummer', 'kostenstelle', 'hotel_name',
];

function safeParse(v) {
  if (!v) return {};
  try { return typeof v === 'string' ? JSON.parse(v) : v; } catch (_) { return {}; }
}

function normalizeVal(v) {
  if (v == null) return '';
  return String(v).trim();
}

/**
 * Vergleicht gesendete vs. finale Felder und gibt die Unterschiede zurück.
 * Ignoriert Leerzeichen-Unterschiede und Groß/Kleinschreibung bei Vergleichen.
 */
function diffFields(sentFields, finalFields) {
  const changes = [];
  for (const key of LEARNABLE_FIELDS) {
    const sent = normalizeVal(sentFields[key]);
    const final = normalizeVal(finalFields[key]);
    if (!final) continue; // leeres Endfeld ignorieren
    if (sent.toLowerCase() !== final.toLowerCase()) {
      changes.push({ field: key, bot_value: sent || null, human_value: final });
    }
  }
  return changes;
}

/**
 * Speichert Lernkorrekturen aus einem abgeschlossenen ABBYY-Dokument.
 * documentId   = unsere interne Dokument-ID
 * finalFields  = die finalen Feldwerte nach menschlicher Prüfung in ABBYY
 */
function storeAbbyyCorrections(documentId, finalFields) {
  const doc = db.prepare(`
    SELECT id, sender, sender_id, abbyy_sent_fields, original_name
    FROM documents WHERE id = ?
  `).get(documentId);
  if (!doc) return { saved: 0, changes: [] };

  const sentFields = safeParse(doc.abbyy_sent_fields);
  const changes = diffFields(sentFields, finalFields);

  if (changes.length === 0) {
    // Nichts geändert → trotzdem als "gelernt" markieren damit nicht nochmal geprüft wird
    db.prepare(`UPDATE documents SET abbyy_learned_at = datetime('now') WHERE id = ?`).run(documentId);
    return { saved: 0, changes: [] };
  }

  const insert = db.prepare(`
    INSERT INTO bot_corrections
      (id, document_name, field_name, bot_value, human_value, sender, sender_id, document_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const run = db.transaction(() => {
    for (const c of changes) {
      insert.run(
        uuidv4(),
        doc.original_name || documentId,
        c.field,
        c.bot_value,
        c.human_value,
        doc.sender || null,
        doc.sender_id || null,
        documentId,
      );
    }
  });
  run();

  // Als gelernt markieren + finale Felder als extracted_fields übernehmen
  db.prepare(`
    UPDATE documents
    SET abbyy_learned_at = datetime('now'),
        extracted_fields = ?
    WHERE id = ?
  `).run(JSON.stringify({ ...sentFields, ...finalFields }), documentId);

  console.log(`[AbbyyLearning] Dokument ${documentId}: ${changes.length} Korrekturen aus ABBYY gelernt`);
  return { saved: changes.length, changes };
}

/**
 * Ruft alle abgeschlossenen ABBYY-Aufgaben ab und lernt aus den Korrekturen.
 * Wird vom Autopiloten aufgerufen und kann auch manuell getriggert werden.
 */
async function learnFromCompletedTasks() {
  const cfg = connector.getConfig();
  if (!connector.isConfigured()) return { skipped: true, reason: 'ABBYY nicht konfiguriert' };

  const completedTasks = await connector.fetchCompletedTasks();
  if (completedTasks.length === 0) return { learned: 0, tasks: 0 };

  let totalSaved = 0;
  const details = [];

  for (const task of completedTasks) {
    try {
      // Im Live-Modus: finale Felder aus ABBYY holen falls nicht schon im Task
      let finalFields = task.finalFields || {};
      if (!cfg.simulation && Object.keys(finalFields).length === 0) {
        finalFields = await connector.fetchDocumentFields(task.documentId);
      }

      const result = storeAbbyyCorrections(task.documentId, finalFields);
      totalSaved += result.saved;

      if (result.saved > 0) {
        details.push({
          documentId: task.documentId,
          saved: result.saved,
          changes: result.changes.map((c) => `${c.field}: "${c.bot_value}" → "${c.human_value}"`),
        });
      }
    } catch (err) {
      console.warn(`[AbbyyLearning] Fehler bei Task ${task.taskId}:`, err.message);
    }
  }

  if (totalSaved > 0) {
    console.log(`[AbbyyLearning] ${totalSaved} Korrekturen aus ${details.length} ABBYY-Dokumenten gelernt`);
  }

  return { learned: totalSaved, tasks: completedTasks.length, details };
}

/**
 * Wird beim Weiterleiten an ABBYY aufgerufen: speichert die gesendeten Felder.
 * documentId    = unsere ID
 * sentFields    = die Felder die wir an ABBYY geschickt haben (extrahierte + korrigierte)
 * abbyyTaskId   = die Task-ID die ABBYY zurückgibt (optional)
 */
function recordSentToAbbyy(documentId, sentFields, abbyyTaskId = null) {
  try {
    db.prepare(`
      UPDATE documents
      SET abbyy_sent_fields = ?,
          abbyy_task_id = COALESCE(?, abbyy_task_id),
          abbyy_learned_at = NULL
      WHERE id = ?
    `).run(JSON.stringify(sentFields), abbyyTaskId, documentId);
  } catch (err) {
    console.warn('[AbbyyLearning] recordSentToAbbyy fehlgeschlagen:', err.message);
  }
}

module.exports = { learnFromCompletedTasks, storeAbbyyCorrections, recordSentToAbbyy };
