'use strict';

const express = require('express');
const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const path = require('path');
const multer = require('multer');
const db = require('../database/db');

// Upload-Speicher für Import-Dateien
const importStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const d = path.join(__dirname, '../../../uploads/tmp');
    fs.mkdirSync(d, { recursive: true });
    cb(null, d);
  },
  filename: (_req, file, cb) => cb(null, `abbyy_import_${Date.now()}${path.extname(file.originalname)}`),
});
const importUpload = multer({
  storage: importStorage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.csv', '.xml', '.xlsx', '.xls', '.json'].includes(ext)) cb(null, true);
    else cb(new Error('Nur CSV, XML, Excel oder JSON erlaubt'), false);
  },
});

const router = express.Router();

function getAbbyySettings() {
  const rows = db.prepare("SELECT key, value FROM settings WHERE key IN ('abbyy_endpoint', 'abbyy_auth_token', 'abbyy_enabled')").all();
  const s = {};
  for (const row of rows) s[row.key] = row.value;
  return s;
}

// GET /api/abbyy/test - test ABBYY connection
router.get('/test', async (req, res) => {
  try {
    const settings = getAbbyySettings();

    if (!settings.abbyy_endpoint) {
      return res.status(400).json({ success: false, error: 'ABBYY-Endpunkt nicht konfiguriert' });
    }

    const testUrl = settings.abbyy_endpoint.replace(/\/$/, '') + '/health';

    const response = await axios.get(testUrl, {
      headers: settings.abbyy_auth_token
        ? { Authorization: `Bearer ${settings.abbyy_auth_token}` }
        : {},
      timeout: 10000,
    });

    res.json({
      success: true,
      status: response.status,
      message: 'Verbindung zu ABBYY erfolgreich',
      server_info: response.data,
    });
  } catch (err) {
    const status = err.response ? err.response.status : null;
    res.status(200).json({
      success: false,
      error: err.message,
      http_status: status,
      message: 'Verbindung zu ABBYY fehlgeschlagen',
    });
  }
});

// POST /api/abbyy/forward/:id - forward document to ABBYY
router.post('/forward/:id', async (req, res) => {
  try {
    const settings = getAbbyySettings();

    if (settings.abbyy_enabled !== 'true') {
      return res.status(400).json({ error: 'ABBYY-Integration ist nicht aktiviert' });
    }

    if (!settings.abbyy_endpoint) {
      return res.status(400).json({ error: 'ABBYY-Endpunkt nicht konfiguriert' });
    }

    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
    if (!doc) {
      return res.status(404).json({ error: 'Dokument nicht gefunden' });
    }

    if (!fs.existsSync(doc.file_path)) {
      return res.status(404).json({ error: 'Dokumentdatei nicht gefunden' });
    }

    // Lieferantennummer aus der Datenbank holen
    let vendorCode = null;
    if (doc.sender_id) {
      const supplier = db.prepare('SELECT vendor_code FROM suppliers WHERE id = ?').get(doc.sender_id);
      vendorCode = supplier ? supplier.vendor_code : null;
    }

    const form = new FormData();
    form.append('file', fs.createReadStream(doc.file_path), {
      filename: doc.original_name,
      contentType: getContentType(doc.file_type),
    });
    form.append('document_id', doc.id);
    form.append('doc_type', doc.doc_type || '');
    form.append('sender', doc.sender || '');
    form.append('confidence', String(doc.confidence || 0));
    form.append('ampel', doc.ampel || 'rot');

    // 3-stellige Nummern für ABBYY-Felder
    if (vendorCode) form.append('lieferantennummer', vendorCode);
    if (doc.hotel_code) form.append('kostenstelle', doc.hotel_code);
    if (doc.hotel_name) form.append('hotel_name', doc.hotel_name);

    // Forward all extracted invoice fields to ABBYY for pre-filling
    if (doc.extracted_fields) {
      try {
        const ef = typeof doc.extracted_fields === 'string'
          ? JSON.parse(doc.extracted_fields)
          : doc.extracted_fields;
        for (const [key, value] of Object.entries(ef)) {
          if (value != null) form.append(key, String(value));
        }
      } catch (_) {}
    }

    const uploadUrl = settings.abbyy_endpoint.replace(/\/$/, '') + '/documents/upload';

    const headers = {
      ...form.getHeaders(),
    };
    if (settings.abbyy_auth_token) {
      headers.Authorization = `Bearer ${settings.abbyy_auth_token}`;
    }

    const response = await axios.post(uploadUrl, form, {
      headers,
      timeout: 60000,
      maxContentLength: 100 * 1024 * 1024,
    });

    db.prepare(`UPDATE documents SET status = 'forwarded' WHERE id = ?`).run(req.params.id);

    // Gesendete Felder merken → damit wir später lernen können was ABBYY-Nutzer geändert hat
    try {
      const { recordSentToAbbyy } = require('../services/abbyyLearning');
      let sentFields = {};
      if (doc.extracted_fields) {
        sentFields = typeof doc.extracted_fields === 'string'
          ? JSON.parse(doc.extracted_fields) : doc.extracted_fields;
      }
      if (vendorCode) sentFields.lieferantennummer = vendorCode;
      if (doc.hotel_code) sentFields.kostenstelle = doc.hotel_code;
      if (doc.hotel_name) sentFields.hotel_name = doc.hotel_name;
      // Task-ID aus ABBYY-Antwort auslesen falls vorhanden
      const abbyyTaskId = response.data && (response.data.taskId || response.data.task_id || response.data.id) || null;
      recordSentToAbbyy(doc.id, sentFields, abbyyTaskId ? String(abbyyTaskId) : null);
    } catch (_) {}

    const logId = require('uuid').v4();
    db.prepare(`
      INSERT INTO processing_log (id, document_id, step, status, message)
      VALUES (?, ?, 'abbyy_forward', 'success', ?)
    `).run(logId, doc.id, `An ABBYY weitergeleitet. Response: ${response.status}`);

    res.json({
      success: true,
      message: 'Dokument erfolgreich an ABBYY weitergeleitet',
      abbyy_response: response.data,
    });
  } catch (err) {
    console.error('ABBYY forward error:', err);

    const logId = require('uuid').v4();
    try {
      db.prepare(`
        INSERT INTO processing_log (id, document_id, step, status, message)
        VALUES (?, ?, 'abbyy_forward', 'error', ?)
      `).run(logId, req.params.id, err.message);
    } catch (_) {}

    res.status(500).json({
      success: false,
      error: err.message,
      http_status: err.response ? err.response.status : null,
    });
  }
});

// POST /api/abbyy/forward-batch - forward multiple documents to ABBYY
router.post('/forward-batch', async (req, res) => {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Keine IDs angegeben' });
    }

    const settings = getAbbyySettings();
    if (settings.abbyy_enabled !== 'true') {
      return res.status(400).json({ error: 'ABBYY-Integration ist nicht aktiviert' });
    }

    const results = [];

    for (const id of ids) {
      try {
        const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
        if (!doc || !fs.existsSync(doc.file_path)) {
          results.push({ id, success: false, error: 'Nicht gefunden' });
          continue;
        }

        let batchVendorCode = null;
        if (doc.sender_id) {
          const batchSupplier = db.prepare('SELECT vendor_code FROM suppliers WHERE id = ?').get(doc.sender_id);
          batchVendorCode = batchSupplier ? batchSupplier.vendor_code : null;
        }

        const form = new FormData();
        form.append('file', fs.createReadStream(doc.file_path), {
          filename: doc.original_name,
          contentType: getContentType(doc.file_type),
        });
        form.append('document_id', doc.id);
        form.append('doc_type', doc.doc_type || '');
        form.append('sender', doc.sender || '');
        form.append('confidence', String(doc.confidence || 0));
        form.append('ampel', doc.ampel || 'rot');
        if (batchVendorCode) form.append('lieferantennummer', batchVendorCode);
        if (doc.hotel_code) form.append('kostenstelle', doc.hotel_code);
        if (doc.hotel_name) form.append('hotel_name', doc.hotel_name);

        const uploadUrl = settings.abbyy_endpoint.replace(/\/$/, '') + '/documents/upload';
        const headers = { ...form.getHeaders() };
        if (settings.abbyy_auth_token) {
          headers.Authorization = `Bearer ${settings.abbyy_auth_token}`;
        }

        await axios.post(uploadUrl, form, { headers, timeout: 60000 });
        db.prepare("UPDATE documents SET status = 'forwarded' WHERE id = ?").run(id);
        results.push({ id, success: true });
      } catch (err) {
        results.push({ id, success: false, error: err.message });
      }
    }

    res.json({
      message: `${results.filter((r) => r.success).length} von ${ids.length} Dokumenten weitergeleitet`,
      results,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Lookup-Endpunkte für ABBYY FlexiCapture Datenbank-Auswahl ---
// ABBYY kann diese Endpunkte als REST-Lookup-Quelle nutzen.
// Konfiguration in ABBYY: Lookup-Quelle → REST API → URL = http://localhost:3001/api/abbyy/lookup/...

// GET /api/abbyy/lookup/suppliers?q=Hofbr&limit=20
// Liefert Lieferanten im Format, das ABBYY für Dropdown-Listen erwartet.
router.get('/lookup/suppliers', (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);

    let rows;
    if (q) {
      rows = db.prepare(`
        SELECT id, name, vendor_code, iban, ust_id, category
        FROM suppliers
        WHERE name LIKE ? OR aliases LIKE ? OR vendor_code LIKE ?
        ORDER BY name ASC LIMIT ?
      `).all(`%${q}%`, `%${q}%`, `%${q}%`, limit);
    } else {
      rows = db.prepare(`
        SELECT id, name, vendor_code, iban, ust_id, category
        FROM suppliers ORDER BY name ASC LIMIT ?
      `).all(limit);
    }

    // Format: Liste für ABBYY-Lookup (Feld-ID + Anzeigename + Metadaten)
    res.json({
      total: rows.length,
      items: rows.map((s) => ({
        id: s.id,
        display: s.vendor_code ? `[${s.vendor_code}] ${s.name}` : s.name,
        name: s.name,
        vendor_code: s.vendor_code || '',
        iban: s.iban || '',
        ust_id: s.ust_id || '',
        category: s.category || '',
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/abbyy/lookup/hotels?q=Schaum&limit=20
// Liefert Hotels/Kostenstellen für ABBYY-Dropdown.
router.get('/lookup/hotels', (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);

    let rows;
    if (q) {
      rows = db.prepare(`
        SELECT id, name, code, aliases FROM hotels
        WHERE name LIKE ? OR code LIKE ? OR aliases LIKE ?
        ORDER BY name ASC LIMIT ?
      `).all(`%${q}%`, `%${q}%`, `%${q}%`, limit);
    } else {
      rows = db.prepare('SELECT id, name, code, aliases FROM hotels ORDER BY name ASC LIMIT ?').all(limit);
    }

    res.json({
      total: rows.length,
      items: rows.map((h) => ({
        id: h.id,
        display: `[${h.code}] ${h.name}`,
        name: h.name,
        code: h.code,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/abbyy/lookup/supplier-by-code/:code
// Einzelnen Lieferanten per 3-stelliger Nummer abrufen.
router.get('/lookup/supplier-by-code/:code', (req, res) => {
  try {
    const row = db.prepare('SELECT id, name, vendor_code, iban, ust_id FROM suppliers WHERE vendor_code = ?').get(req.params.code);
    if (!row) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json({ id: row.id, name: row.name, vendor_code: row.vendor_code, iban: row.iban || '', ust_id: row.ust_id || '' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/abbyy/lookup/hotel-by-code/:code
// Einzelnes Hotel per 3-stelligem Kostenstellen-Code abrufen.
router.get('/lookup/hotel-by-code/:code', (req, res) => {
  try {
    const row = db.prepare('SELECT id, name, code FROM hotels WHERE code = ?').get(req.params.code);
    if (!row) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json({ id: row.id, name: row.name, code: row.code });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Aus ABBYY-Korrekturen lernen ────────────────────────────────────────────

/**
 * POST /api/abbyy/webhook/task-completed
 * ABBYY ruft diesen Endpunkt auf wenn ein Nutzer eine Aufgabe in ABBYY abschließt.
 * Konfiguration in ABBYY: Post-Processing Script → POST http://localhost:3001/api/abbyy/webhook/task-completed
 *
 * Body-Format (ABBYY schickt):
 *   { "documentId": "...", "taskId": "...", "fields": { "rechnungsnummer": "...", ... } }
 */
router.post('/webhook/task-completed', async (req, res) => {
  try {
    const { documentId, taskId, fields } = req.body || {};
    if (!documentId && !taskId) {
      return res.status(400).json({ error: 'documentId oder taskId erforderlich' });
    }

    // Dokument über unsere ID oder ABBYY-Task-ID finden
    const doc = documentId
      ? db.prepare('SELECT id FROM documents WHERE id = ? OR abbyy_task_id = ?').get(documentId, documentId)
      : db.prepare('SELECT id FROM documents WHERE abbyy_task_id = ?').get(taskId);

    if (!doc) {
      return res.status(404).json({ error: 'Dokument nicht in unserer Datenbank' });
    }

    // Falls fields nicht im Webhook mitgeliefert → aus ABBYY nachholen
    let finalFields = fields || {};
    if (Object.keys(finalFields).length === 0) {
      try {
        const { fetchDocumentFields } = require('../services/abbyyConnector');
        finalFields = await fetchDocumentFields(documentId || doc.id);
      } catch (_) {}
    }

    const { storeAbbyyCorrections } = require('../services/abbyyLearning');
    const result = storeAbbyyCorrections(doc.id, finalFields);

    console.log(`[Webhook] Task abgeschlossen für Dokument ${doc.id}: ${result.saved} Korrekturen gelernt`);
    res.json({ success: true, learned: result.saved, changes: result.changes });
  } catch (err) {
    console.error('[Webhook] task-completed Fehler:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/abbyy/learn-from-completed
 * Manuell auslösen: Alle abgeschlossenen ABBYY-Aufgaben abrufen und daraus lernen.
 * Wird auch vom Autopiloten periodisch aufgerufen.
 */
router.post('/learn-from-completed', async (req, res) => {
  try {
    const { learnFromCompletedTasks } = require('../services/abbyyLearning');
    const result = await learnFromCompletedTasks();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/abbyy/learn-from-completed/status
 * Wie viele Dokumente warten noch auf Lern-Abgleich?
 */
router.get('/learn-from-completed/status', (req, res) => {
  try {
    const pending = db.prepare(`
      SELECT COUNT(*) as n FROM documents
      WHERE abbyy_sent_fields IS NOT NULL AND abbyy_learned_at IS NULL AND status = 'forwarded'
    `).get();
    const learned = db.prepare(`
      SELECT COUNT(*) as n FROM documents WHERE abbyy_learned_at IS NOT NULL
    `).get();
    const totalCorrections = db.prepare(`
      SELECT COUNT(*) as n FROM bot_corrections WHERE document_id IN (
        SELECT id FROM documents WHERE abbyy_learned_at IS NOT NULL
      )
    `).get();
    res.json({
      pending_learning: pending.n,
      documents_learned: learned.n,
      corrections_from_abbyy: totalCorrections.n,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Lieferanten-Sync aus ABBYY / ERP ---

// POST /api/abbyy/sync-suppliers
// Importiert Lieferanten automatisch aus dem konfigurierten Endpunkt.
// Optional: { url: "..." } im Body überschreibt die gespeicherte Einstellung einmalig.
router.post('/sync-suppliers', async (req, res) => {
  try {
    const { syncSuppliers } = require('../services/abbyyVendorSync');
    const result = await syncSuppliers({ url: req.body && req.body.url ? req.body.url : undefined });
    res.json({
      success: true,
      ...result,
    });
  } catch (err) {
    console.error('[VendorSync] Fehler:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
});

// GET /api/abbyy/sync-suppliers/status - letzter Sync-Zeitstempel + Lieferantenanzahl
router.get('/sync-suppliers/status', (req, res) => {
  try {
    const last = db.prepare("SELECT value FROM settings WHERE key = 'abbyy_vendor_sync_last'").get();
    const url = db.prepare("SELECT value FROM settings WHERE key = 'abbyy_vendor_sync_url'").get();
    const interval = db.prepare("SELECT value FROM settings WHERE key = 'abbyy_vendor_sync_interval_hours'").get();
    const count = db.prepare('SELECT COUNT(*) as n FROM suppliers').get();
    res.json({
      last_sync: last ? last.value : null,
      sync_url: url ? url.value : '',
      interval_hours: interval ? parseFloat(interval.value || '0') : 0,
      total_suppliers: count.n,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- FlexiCapture Autopilot ---
// Lazy requires: falls die Dateien noch nicht vorhanden sind (ältere Installation),
// schlägt nur der einzelne Route-Aufruf fehl – der Server startet trotzdem.
function getConnector() {
  return require('../services/abbyyConnector');
}
function getAutopilot() {
  return require('../services/abbyyAutopilot');
}

// GET /api/abbyy/autopilot/status
router.get('/autopilot/status', (req, res) => {
  try {
    const cfg = getConnector().getConfig();
    res.json({
      configured: getConnector().isConfigured(),
      enabled: cfg.autopilotEnabled,
      simulation: cfg.simulation,
      auto_complete_threshold: cfg.autoCompleteThreshold,
      poll_interval_sec: cfg.pollIntervalSec,
      has_api_url: !!cfg.apiUrl,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/abbyy/autopilot/test
router.get('/autopilot/test', async (req, res) => {
  try {
    const result = await getConnector().testConnection();
    res.json(result);
  } catch (err) {
    res.status(200).json({ success: false, message: err.message });
  }
});

// POST /api/abbyy/autopilot/run
router.post('/autopilot/run', async (req, res) => {
  try {
    const summary = await getAutopilot().runCycle();
    res.json({ message: 'Autopilot-Durchlauf abgeschlossen', summary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── ABBYY Export-Datei als Lernmaterial importieren ─────────────────────────
//
// POST /api/abbyy/import-training
// Nimmt eine CSV- oder XML-Exportdatei aus ABBYY und speichert die Feldwerte
// als Lernkorrekturen (bot_corrections), ohne dass die Rechnungen nochmal
// manuell bearbeitet werden müssen.
//
// Unterstützte ABBYY Export-Formate:
//   CSV:  DocumentName;Absender;Rechnungsnummer;Betrag;IBAN;...
//   XML:  ABBYY FlexiCapture Standard-Export-XML
//   JSON: [{ document_name: "...", fields: { absender: "...", ... } }]
//
// ABBYY-Export einrichten: Projekt → Export → "Datenbankexport" oder
//   "Textdatei-Export" → Felder auswählen → Zieldatei konfigurieren
//   (Netzlaufwerk das wir per "Auto-Import" überwachen können)

router.post('/import-training', importUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine Datei hochgeladen' });

  const filePath = req.file.path;
  const ext = path.extname(req.file.originalname).toLowerCase();

  try {
    const ExcelJS = require('exceljs');
    const { v4: uuidv4 } = require('uuid');
    const { storeAbbyyCorrections } = require('../services/abbyyLearning');

    // ── Feld-Mapping: ABBYY-Exportnamen → unsere internen Feldnamen ──────────
    const FIELD_MAP = {
      // Absender / Lieferant
      'absender': 'absender', 'lieferant': 'absender', 'vendor': 'absender',
      'lieferant_name': 'absender', 'vendor_name': 'absender',
      // Rechnung
      'rechnungsnummer': 'rechnungsnummer', 'invoice_number': 'rechnungsnummer',
      'rechnungsnr': 'rechnungsnummer', 'belegnummer': 'rechnungsnummer',
      'rechnungsdatum': 'rechnungsdatum', 'invoice_date': 'rechnungsdatum', 'datum': 'rechnungsdatum',
      'faelligkeitsdatum': 'faelligkeitsdatum', 'due_date': 'faelligkeitsdatum', 'zahlungsziel': 'faelligkeitsdatum',
      // Beträge
      'betrag_brutto': 'betrag_brutto', 'brutto': 'betrag_brutto', 'gesamtbetrag': 'betrag_brutto',
      'total': 'betrag_brutto', 'betrag': 'betrag_brutto', 'amount': 'betrag_brutto',
      'betrag_netto': 'betrag_netto', 'netto': 'betrag_netto',
      'steuerbetrag': 'steuerbetrag', 'mwst': 'steuerbetrag', 'tax': 'steuerbetrag',
      'steuersatz': 'steuersatz', 'mwst_satz': 'steuersatz',
      'waehrung': 'waehrung', 'currency': 'waehrung',
      // Bankdaten
      'iban': 'iban', 'bic': 'bic',
      // Lieferanten-IDs
      'lieferantennummer': 'lieferantennummer', 'vendor_code': 'lieferantennummer',
      'kreditorennummer': 'lieferantennummer',
      'ust_id': 'ust_id', 'ustid': 'ust_id', 'vat_id': 'ust_id',
      // Hotel / Kostenstelle
      'kostenstelle': 'kostenstelle', 'hotel': 'hotel_name', 'hotel_name': 'hotel_name',
    };

    function mapFields(rawObj) {
      const mapped = {};
      for (const [k, v] of Object.entries(rawObj)) {
        const key = k.toLowerCase().trim().replace(/[\s\-]/g, '_');
        const target = FIELD_MAP[key];
        if (target && v != null && String(v).trim()) {
          mapped[target] = String(v).trim();
        }
      }
      return mapped;
    }

    // ── Datei parsen ──────────────────────────────────────────────────────────
    let records = []; // [{ documentName, sender, fields }]

    if (ext === '.json') {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const arr = Array.isArray(raw) ? raw : (raw.records || raw.documents || raw.items || []);
      for (const item of arr) {
        const docName = item.document_name || item.DocumentName || item.filename || item.name || '(unbekannt)';
        const sender = item.sender || item.absender || item.vendor || null;
        const fields = mapFields(item.fields || item);
        records.push({ documentName: String(docName), sender: sender ? String(sender).trim() : null, fields });
      }
    } else if (ext === '.csv') {
      const text = fs.readFileSync(filePath, 'utf-8');
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length < 2) throw new Error('CSV hat keine Datenzeilen');
      const sep = lines[0].includes(';') ? ';' : ',';
      const headers = lines[0].split(sep).map(h => h.replace(/^"|"$/g, '').trim());
      // Erste Spalte: Dokumentname (DocumentName, Dateiname, Name)
      const nameIdx = ['documentname','document_name','dateiname','filename','name','dokument']
        .map(n => headers.findIndex(h => h.toLowerCase() === n)).find(i => i >= 0) ?? 0;
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(sep).map(c => c.replace(/^"|"$/g, '').trim());
        const obj = {};
        headers.forEach((h, idx) => { if (cols[idx]) obj[h] = cols[idx]; });
        const fields = mapFields(obj);
        const docName = cols[nameIdx] || `Zeile ${i}`;
        records.push({ documentName: docName, sender: fields.absender || null, fields });
      }
    } else if (ext === '.xml') {
      const xmlText = fs.readFileSync(filePath, 'utf-8');
      // ABBYY Standard-Export-XML: <Document><Field Name="Absender">...</Field></Document>
      const docBlocks = [...xmlText.matchAll(/<(?:Document|document|Task|task|Record|record)[^>]*>([\s\S]*?)<\/(?:Document|document|Task|task|Record|record)>/g)];
      for (const block of docBlocks) {
        const content = block[1];
        const nameMatch = content.match(/(?:DocumentName|document_name|FileName|filename)[^>]*>([^<]+)</i);
        const docName = nameMatch ? nameMatch[1].trim() : '(unbekannt)';
        const obj = {};
        for (const fm of content.matchAll(/<(?:Field|field)\s+[Nn]ame="([^"]+)"[^>]*>([^<]*)<\/(?:Field|field)>/g)) {
          obj[fm[1]] = fm[2];
        }
        // Alternativ: <Feldname>Wert</Feldname>
        if (Object.keys(obj).length === 0) {
          for (const fm of content.matchAll(/<([A-Za-z_][A-Za-z0-9_]*)>([^<]+)<\/\1>/g)) {
            obj[fm[1]] = fm[2];
          }
        }
        const fields = mapFields(obj);
        records.push({ documentName: docName, sender: fields.absender || null, fields });
      }
    } else if (['.xlsx', '.xls'].includes(ext)) {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(filePath);
      const sheet = workbook.worksheets[0];
      const headers = sheet.getRow(1).values.slice(1).map(h => String(h || '').trim());
      const nameIdx = ['documentname','document_name','dateiname','filename','name']
        .map(n => headers.findIndex(h => h.toLowerCase() === n)).find(i => i >= 0) ?? 0;
      sheet.eachRow((row, rn) => {
        if (rn === 1) return;
        const vals = row.values.slice(1);
        const obj = {};
        headers.forEach((h, idx) => { if (vals[idx] != null) obj[h] = String(vals[idx]).trim(); });
        const fields = mapFields(obj);
        const docName = String(vals[nameIdx] || `Zeile ${rn}`);
        records.push({ documentName: docName, sender: fields.absender || null, fields });
      });
    }

    if (records.length === 0) throw new Error('Keine Datensätze in der Datei gefunden');

    // ── Für jeden Datensatz Lernkorrekturen speichern ────────────────────────
    const insert = db.prepare(`
      INSERT INTO bot_corrections
        (id, document_name, field_name, bot_value, human_value, sender, sender_id, document_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
    `);

    let saved = 0;
    let skipped = 0;

    const run = db.transaction(() => {
      for (const rec of records) {
        // Lieferant per IBAN oder Name suchen um sender_id zu setzen
        let senderId = null;
        if (rec.fields.iban) {
          const sup = db.prepare('SELECT id FROM suppliers WHERE iban = ?').get(rec.fields.iban);
          if (sup) senderId = sup.id;
        }
        if (!senderId && rec.sender) {
          const sup = db.prepare('SELECT id FROM suppliers WHERE name = ? OR aliases LIKE ?')
            .get(rec.sender, `%${rec.sender}%`);
          if (sup) senderId = sup.id;
        }

        const senderText = rec.sender || rec.fields.absender || null;

        for (const [fieldName, humanValue] of Object.entries(rec.fields)) {
          if (!humanValue || !humanValue.trim()) continue;
          try {
            insert.run(uuidv4(), rec.documentName, fieldName, null, humanValue, senderText, senderId || null);
            saved++;
          } catch (_) { skipped++; }
        }
      }
    });
    run();

    fs.unlink(filePath, () => {});

    res.json({
      success: true,
      message: `${saved} Lernkorrekturen aus ${records.length} Dokumenten importiert`,
      records: records.length,
      saved,
      skipped,
    });

  } catch (err) {
    fs.unlink(filePath, () => {});
    console.error('[TrainingImport] Fehler:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// GET /api/abbyy/import-training/template
// Gibt eine Vorlage-CSV zurück die zeigt welche Spalten erwartet werden
router.get('/import-training/template', (_req, res) => {
  const csv = [
    'DocumentName;Absender;Rechnungsnummer;Rechnungsdatum;Betrag_Brutto;Waehrung;IBAN;Lieferantennummer;Kostenstelle',
    'Rechnung_Muster_GmbH_2024.pdf;Muster GmbH;RE-2024-001;15.01.2024;1190.00;EUR;DE12345678901234567890;10042;101',
    'Beispiel_AG_Rechnung.pdf;Beispiel AG;2024-00123;20.01.2024;595.00;EUR;DE98765432109876543210;10043;102',
  ].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="abbyy_export_vorlage.csv"');
  res.send('﻿' + csv); // BOM für Excel
});

function getContentType(fileType) {
  const types = {
    pdf: 'application/pdf',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    tiff: 'image/tiff',
    tif: 'image/tiff',
    bmp: 'image/bmp',
  };
  return types[fileType] || 'application/octet-stream';
}

module.exports = router;
