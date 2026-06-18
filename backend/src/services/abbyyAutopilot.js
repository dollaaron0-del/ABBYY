'use strict';

/**
 * ABBYY Autopilot
 * ---------------
 * Der eigentliche automatische Ablauf:
 *
 *   ABBYY (Task) → Felder lesen → KI prüft & korrigiert → zurückschreiben
 *     → wenn sicher genug: Task automatisch abschließen
 *     → sonst: zur manuellen Prüfung markieren
 *
 * Läuft nur, wenn abbyy_autopilot_enabled = true UND der Connector konfiguriert
 * ist (oder Simulationsmodus aktiv).
 */

const { v4: uuidv4 } = require('uuid');
const db = require('../database/db');
const connector = require('./abbyyConnector');

let running = false;

function log(documentId, step, status, message) {
  try {
    db.prepare(`
      INSERT INTO processing_log (id, document_id, step, status, message)
      VALUES (?, ?, ?, ?, ?)
    `).run(uuidv4(), documentId, step, status, message || null);
  } catch (_) { /* Logging darf den Ablauf nie stoppen */ }
}

/** Pflichtfelder, die für eine sichere automatische Freigabe vorhanden sein müssen. */
const REQUIRED_FIELDS = ['rechnungsnummer', 'rechnungsdatum', 'betrag_brutto'];

/**
 * Wert wirkt wie eine Nummer/Bezeichnung statt einer Firma?
 * (gleiche Logik wie im aiService, hier für die Korrektur genutzt)
 */
function looksLikeNumber(value) {
  if (!value) return true;
  const s = String(value).trim();
  const digits = (s.match(/\d/g) || []).length;
  const letters = (s.match(/[a-zäöüß]/gi) || []).length;
  if (letters === 0) return true;
  if (digits >= letters) return true;
  if (/(liefer|wefer)?schein|nummer|nr\.?|bestell|kunden|beleg/i.test(s) && digits > 0) return true;
  return false;
}

/**
 * Vergleicht ABBYY-Felder mit unseren KI-Feldern und korrigiert offensichtliche
 * Fehler. Gibt das korrigierte Feldobjekt + eine Liste der Korrekturen zurück.
 */
function correctFields(abbyyFields, aiFields) {
  const corrected = { ...abbyyFields };
  const corrections = [];

  const fieldsToCheck = [
    'absender', 'rechnungsnummer', 'rechnungsdatum', 'faelligkeitsdatum',
    'betrag_brutto', 'betrag_netto', 'steuerbetrag', 'steuersatz',
    'waehrung', 'iban', 'bic', 'absender_strasse', 'absender_plz',
    'absender_ort', 'absender_land',
  ];

  for (const key of fieldsToCheck) {
    const abbyyVal = abbyyFields ? abbyyFields[key] : null;
    const aiVal = aiFields ? aiFields[key] : null;

    // ABBYY-Feld leer, KI hat einen Wert → übernehmen
    if ((abbyyVal == null || String(abbyyVal).trim() === '') && aiVal != null) {
      corrected[key] = aiVal;
      corrections.push({ field: key, from: abbyyVal, to: aiVal, reason: 'ABBYY-Feld war leer' });
      continue;
    }

    // Absender wirkt wie eine Nummer → durch KI-Wert ersetzen, falls dieser eine Firma ist
    if (key === 'absender' && looksLikeNumber(abbyyVal) && aiVal && !looksLikeNumber(aiVal)) {
      corrected[key] = aiVal;
      corrections.push({ field: key, from: abbyyVal, to: aiVal, reason: 'ABBYY-Absender war keine Firma' });
    }
  }

  return { corrected, corrections };
}

/**
 * Entscheidet, ob ein Dokument automatisch abgeschlossen werden darf.
 */
function decide(doc, fields, threshold) {
  const knownTypes = ['Rechnung', 'Mahnung', 'Behördenbescheid'];
  const reasons = [];

  if (!knownTypes.includes(doc.doc_type)) {
    reasons.push(`Dokumenttyp "${doc.doc_type}" nicht eindeutig`);
  }
  if ((doc.confidence || 0) < threshold) {
    reasons.push(`Konfidenz ${doc.confidence || 0}% unter Schwelle ${threshold}%`);
  }
  if (!doc.sender_matched) {
    reasons.push('Lieferant nicht in der Lieferantenliste');
  }
  for (const req of REQUIRED_FIELDS) {
    if (fields[req] == null || String(fields[req]).trim() === '') {
      reasons.push(`Pflichtfeld "${req}" fehlt`);
    }
  }

  return { autoComplete: reasons.length === 0, reasons };
}

/**
 * Ein Durchlauf: offene ABBYY-Aufgaben abarbeiten.
 */
async function runCycle() {
  if (running) return { skipped: true };
  const cfg = connector.getConfig();

  if (!cfg.autopilotEnabled) return { disabled: true };
  if (!connector.isConfigured()) return { notConfigured: true };

  running = true;
  const summary = { processed: 0, autoCompleted: 0, manual: 0, errors: 0 };

  try {
    const tasks = await connector.fetchPendingTasks();

    for (const task of tasks) {
      summary.processed++;
      try {
        const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(task.documentId);
        if (!doc) continue;

        // 1. ABBYY-Felder + unsere KI-Felder
        const abbyyFields = task.fields || (await connector.fetchDocumentFields(task.documentId));
        let aiFields = {};
        try { aiFields = doc.extracted_fields ? JSON.parse(doc.extracted_fields) : {}; } catch (_) {}

        // 2. Korrigieren
        const { corrected, corrections } = correctFields(abbyyFields, aiFields);

        if (corrections.length > 0) {
          await connector.updateDocumentFields(task.documentId, corrected);
          db.prepare('UPDATE documents SET extracted_fields = ? WHERE id = ?')
            .run(JSON.stringify(corrected), task.documentId);
          log(task.documentId, 'abbyy_correct', 'success',
            `${corrections.length} Feld(er) korrigiert: ` +
            corrections.map((c) => `${c.field} (${c.reason})`).join(', '));
        }

        // 3. Entscheiden
        const decision = decide(doc, corrected, cfg.autoCompleteThreshold);

        if (decision.autoComplete) {
          await connector.completeTask(task.taskId, task.documentId);
          db.prepare("UPDATE documents SET status = 'forwarded' WHERE id = ?").run(task.documentId);
          log(task.documentId, 'abbyy_autocomplete', 'success',
            `Automatisch abgeschlossen (Konfidenz ${doc.confidence}%, alle Pflichtfelder vorhanden)`);
          summary.autoCompleted++;
        } else {
          db.prepare("UPDATE documents SET status = 'processed', ampel = 'gelb' WHERE id = ?").run(task.documentId);
          log(task.documentId, 'abbyy_manual', 'info',
            'Manuelle Prüfung nötig: ' + decision.reasons.join('; '));
          summary.manual++;
        }
      } catch (err) {
        summary.errors++;
        log(task.documentId, 'abbyy_autopilot', 'error', `Autopilot-Fehler: ${err.message}`);
      }
    }
  } catch (err) {
    console.error('[Autopilot] Fehler beim Abruf der ABBYY-Aufgaben:', err.message);
    summary.fetchError = err.message;
  } finally {
    running = false;
  }

  if (summary.processed > 0) {
    console.log('[Autopilot] Durchlauf:', JSON.stringify(summary));
  }
  return summary;
}

let timer = null;

/**
 * Startet den periodischen Autopilot-Poller (nur intern aufrufen).
 */
function startScheduler() {
  if (timer) clearInterval(timer);
  const cfg = connector.getConfig();
  const intervalMs = Math.max(15, cfg.pollIntervalSec) * 1000;
  timer = setInterval(() => {
    runCycle().catch((err) => console.error('[Autopilot] Cycle-Fehler:', err.message));
  }, intervalMs);
  console.log(`[Autopilot] Scheduler gestartet (alle ${cfg.pollIntervalSec}s).`);
}

module.exports = { runCycle, startScheduler, decide, correctFields, looksLikeNumber };
