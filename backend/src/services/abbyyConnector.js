'use strict';

/**
 * ABBYY FlexiCapture Connector
 * ----------------------------
 * Verbindet das Programm mit ABBYY FlexiCapture, um:
 *   1. offene Verifizierungs-Aufgaben (Tasks) abzuholen
 *   2. die von ABBYY extrahierten Feldwerte zu lesen
 *   3. korrigierte Feldwerte zurückzuschreiben
 *   4. die Aufgabe abzuschließen ("Task abschließen")
 *
 * WICHTIG: Die genauen API-Endpunkte von ABBYY FlexiCapture werden über die
 * Einstellungen konfiguriert (abbyy_api_url, Benutzer, Passwort). Solange diese
 * leer sind, ist der Connector inaktiv. Sobald die IT die API-Zugangsdaten
 * liefert, müssen ggf. nur die Pfade unten (ENDPOINTS) an eure FlexiCapture-
 * Version angepasst werden – die restliche Logik bleibt gleich.
 *
 * Für Tests OHNE echte API gibt es den Simulationsmodus (abbyy_simulation_mode):
 * dann werden lokale Dokumente aus der eigenen Datenbank als "ABBYY-Aufgaben"
 * behandelt, damit der gesamte Ablauf schon jetzt sichtbar funktioniert.
 */

const axios = require('axios');
const db = require('../database/db');

// Standard-Endpunkte für ABBYY FlexiCapture 12 (bei Bedarf anpassen).
// Diese Pfade werden an abbyy_api_url angehängt.
const ENDPOINTS = {
  ping: '/api/v1/server/version',
  pendingTasks: '/api/v1/tasks?stage=Verification&state=Pending',
  documentFields: (docId) => `/api/v1/documents/${docId}/fields`,
  updateFields: (docId) => `/api/v1/documents/${docId}/fields`,
  completeTask: (taskId) => `/api/v1/tasks/${taskId}/complete`,
};

function getConfig() {
  const rows = db.prepare(`
    SELECT key, value FROM settings WHERE key IN (
      'abbyy_api_url', 'abbyy_api_username', 'abbyy_api_password',
      'abbyy_autopilot_enabled', 'abbyy_auto_complete_threshold',
      'abbyy_poll_interval_sec', 'abbyy_simulation_mode'
    )
  `).all();
  const s = {};
  for (const r of rows) s[r.key] = r.value;
  return {
    apiUrl: (s.abbyy_api_url || '').replace(/\/$/, ''),
    username: s.abbyy_api_username || '',
    password: s.abbyy_api_password || '',
    autopilotEnabled: s.abbyy_autopilot_enabled === 'true',
    autoCompleteThreshold: parseInt(s.abbyy_auto_complete_threshold || '90', 10),
    pollIntervalSec: parseInt(s.abbyy_poll_interval_sec || '60', 10),
    simulation: s.abbyy_simulation_mode === 'true',
  };
}

function authHeaders(cfg) {
  if (!cfg.username) return {};
  const token = Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64');
  return { Authorization: `Basic ${token}` };
}

function isConfigured() {
  const cfg = getConfig();
  return cfg.simulation || (!!cfg.apiUrl && !!cfg.username);
}

/**
 * Verbindung zu ABBYY testen.
 */
async function testConnection() {
  const cfg = getConfig();
  if (cfg.simulation) {
    return { success: true, mode: 'simulation', message: 'Simulationsmodus aktiv (keine echte ABBYY-Verbindung)' };
  }
  if (!cfg.apiUrl) {
    return { success: false, message: 'Keine ABBYY-API-URL konfiguriert' };
  }
  try {
    const res = await axios.get(cfg.apiUrl + ENDPOINTS.ping, {
      headers: authHeaders(cfg),
      timeout: 10000,
    });
    return { success: true, mode: 'live', server: res.data };
  } catch (err) {
    return {
      success: false,
      message: err.message,
      http_status: err.response ? err.response.status : null,
    };
  }
}

/**
 * Offene Verifizierungs-Aufgaben von ABBYY holen.
 * Liefert ein Array von { taskId, documentId, fields }.
 */
async function fetchPendingTasks() {
  const cfg = getConfig();

  if (cfg.simulation) {
    // Simulation: behandle lokale, noch nicht weitergeleitete Dokumente als ABBYY-Aufgaben.
    const docs = db.prepare(`
      SELECT id, sender, doc_type, confidence, extracted_fields
      FROM documents
      WHERE status = 'processed' AND ampel IN ('gelb','gruen')
      ORDER BY created_at DESC LIMIT 20
    `).all();
    return docs.map((d) => ({
      taskId: `sim-${d.id}`,
      documentId: d.id,
      simulated: true,
      fields: safeParse(d.extracted_fields) || {},
    }));
  }

  if (!cfg.apiUrl) return [];

  const res = await axios.get(cfg.apiUrl + ENDPOINTS.pendingTasks, {
    headers: authHeaders(cfg),
    timeout: 20000,
  });
  // Erwartetes Format ggf. an eure FlexiCapture-Version anpassen
  const tasks = res.data.tasks || res.data || [];
  return tasks.map((t) => ({
    taskId: t.id || t.taskId,
    documentId: t.documentId || t.document_id,
    fields: t.fields || {},
  }));
}

/**
 * Von ABBYY extrahierte Feldwerte eines Dokuments lesen.
 */
async function fetchDocumentFields(documentId) {
  const cfg = getConfig();
  if (cfg.simulation) {
    const row = db.prepare('SELECT extracted_fields FROM documents WHERE id = ?').get(documentId);
    return safeParse(row && row.extracted_fields) || {};
  }
  const res = await axios.get(cfg.apiUrl + ENDPOINTS.documentFields(documentId), {
    headers: authHeaders(cfg),
    timeout: 20000,
  });
  return res.data.fields || res.data || {};
}

/**
 * Korrigierte Feldwerte zurück an ABBYY schreiben.
 */
async function updateDocumentFields(documentId, fields) {
  const cfg = getConfig();
  if (cfg.simulation) {
    db.prepare('UPDATE documents SET extracted_fields = ? WHERE id = ?')
      .run(JSON.stringify(fields), documentId);
    return { success: true, simulated: true };
  }
  const res = await axios.put(
    cfg.apiUrl + ENDPOINTS.updateFields(documentId),
    { fields },
    { headers: { ...authHeaders(cfg), 'Content-Type': 'application/json' }, timeout: 20000 }
  );
  return { success: true, data: res.data };
}

/**
 * Aufgabe in ABBYY abschließen ("Task abschließen").
 */
async function completeTask(taskId, documentId) {
  const cfg = getConfig();
  if (cfg.simulation) {
    db.prepare("UPDATE documents SET status = 'forwarded' WHERE id = ?").run(documentId);
    return { success: true, simulated: true };
  }
  const res = await axios.post(
    cfg.apiUrl + ENDPOINTS.completeTask(taskId),
    {},
    { headers: authHeaders(cfg), timeout: 20000 }
  );
  return { success: true, data: res.data };
}

function safeParse(str) {
  if (!str) return null;
  try { return typeof str === 'string' ? JSON.parse(str) : str; } catch (_) { return null; }
}

module.exports = {
  getConfig,
  isConfigured,
  testConnection,
  fetchPendingTasks,
  fetchDocumentFields,
  updateDocumentFields,
  completeTask,
  ENDPOINTS,
};
