'use strict';

const express = require('express');
const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const path = require('path');
const db = require('../database/db');

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

    db.prepare(`
      UPDATE documents SET status = 'forwarded' WHERE id = ?
    `).run(req.params.id);

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
