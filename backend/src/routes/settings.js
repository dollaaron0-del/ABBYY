'use strict';

const express = require('express');
const db = require('../database/db');

const router = express.Router();

// GET /api/settings - get all settings
router.get('/', (req, res) => {
  try {
    const rows = db.prepare('SELECT key, value, updated_at FROM settings ORDER BY key').all();
    const settings = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }
    // Mask sensitive values
    if (settings.abbyy_auth_token && settings.abbyy_auth_token.length > 4) {
      settings.abbyy_auth_token_masked = '••••' + settings.abbyy_auth_token.slice(-4);
    }
    if (settings.claude_api_key && settings.claude_api_key.length > 4) {
      settings.claude_api_key_masked = '••••' + settings.claude_api_key.slice(-4);
    }
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/settings/:key - get single setting
router.get('/:key', (req, res) => {
  try {
    const row = db.prepare('SELECT key, value, updated_at FROM settings WHERE key = ?').get(req.params.key);
    if (!row) {
      return res.status(404).json({ error: `Einstellung nicht gefunden: ${req.params.key}` });
    }
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/settings - update multiple settings at once
router.put('/', (req, res) => {
  try {
    const updates = req.body;

    if (typeof updates !== 'object' || Array.isArray(updates)) {
      return res.status(400).json({ error: 'Body muss ein Objekt mit Schlüssel-Wert-Paaren sein' });
    }

    const ALLOWED_KEYS = new Set([
      'ollama_host',
      'ollama_model',
      'confidence_threshold',
      'abbyy_endpoint',
      'abbyy_auth_token',
      'abbyy_enabled',
      'demo_mode',
      'claude_api_enabled',
      'claude_api_key',
      'auto_forward_green',
      'log_level',
      'max_file_size_mb',
      'ocr_language',
    ]);

    const upsert = db.prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);

    const runUpdates = db.transaction(() => {
      for (const [key, value] of Object.entries(updates)) {
        if (!ALLOWED_KEYS.has(key)) {
          throw new Error(`Unbekannter Einstellungsschlüssel: ${key}`);
        }
        upsert.run(key, String(value));
      }
    });

    runUpdates();

    const rows = db.prepare('SELECT key, value, updated_at FROM settings ORDER BY key').all();
    const settings = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }
    res.json({ message: 'Einstellungen gespeichert', settings });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/settings/:key - update single setting
router.put('/:key', (req, res) => {
  try {
    const { value } = req.body;

    if (value === undefined) {
      return res.status(400).json({ error: 'Wert ist erforderlich' });
    }

    db.prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(req.params.key, String(value));

    const updated = db.prepare('SELECT key, value, updated_at FROM settings WHERE key = ?').get(req.params.key);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
