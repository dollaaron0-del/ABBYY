'use strict';

const express = require('express');
const db = require('../database/db');
const { processDocument } = require('../services/documentProcessor');
const { analyzeWithOllama } = require('../services/aiService');
const { extractText } = require('../services/ocrService');

const router = express.Router();

// POST /api/analysis/trigger/:id - trigger analysis for a single document
router.post('/trigger/:id', async (req, res) => {
  try {
    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);

    if (!doc) {
      return res.status(404).json({ error: 'Dokument nicht gefunden' });
    }

    db.prepare(`UPDATE documents SET status = 'pending' WHERE id = ?`).run(req.params.id);
    db.prepare(`DELETE FROM processing_log WHERE document_id = ?`).run(req.params.id);

    res.json({ message: 'Analyse gestartet', document_id: req.params.id });

    setImmediate(() => {
      processDocument(req.params.id).catch((err) => {
        console.error(`Re-analysis failed for ${req.params.id}:`, err);
      });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/analysis/trigger-batch - trigger analysis for multiple documents
router.post('/trigger-batch', async (req, res) => {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Keine IDs angegeben' });
    }

    const placeholders = ids.map(() => '?').join(',');
    const docs = db.prepare(`SELECT id FROM documents WHERE id IN (${placeholders})`).all(...ids);

    if (docs.length === 0) {
      return res.status(404).json({ error: 'Keine Dokumente gefunden' });
    }

    for (const doc of docs) {
      db.prepare(`UPDATE documents SET status = 'pending' WHERE id = ?`).run(doc.id);
      db.prepare(`DELETE FROM processing_log WHERE document_id = ?`).run(doc.id);
    }

    res.json({
      message: `Analyse für ${docs.length} Dokumente gestartet`,
      queued: docs.map((d) => d.id),
    });

    for (const doc of docs) {
      setImmediate(() => {
        processDocument(doc.id).catch((err) => {
          console.error(`Re-analysis failed for ${doc.id}:`, err);
        });
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/analysis/ocr/:id - run OCR only on a document
router.post('/ocr/:id', async (req, res) => {
  try {
    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);

    if (!doc) {
      return res.status(404).json({ error: 'Dokument nicht gefunden' });
    }

    const { text, confidence } = await extractText(doc.file_path, doc.file_type);

    res.json({
      document_id: req.params.id,
      ocr_text: text,
      ocr_confidence: confidence,
      char_count: text.length,
    });
  } catch (err) {
    console.error('OCR error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/analysis/ai-test - test AI with arbitrary text
router.post('/ai-test', async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: 'Kein Text angegeben' });
    }

    const result = await analyzeWithOllama(text);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analysis/status/:id - get processing status
router.get('/status/:id', (req, res) => {
  try {
    const doc = db.prepare('SELECT id, status, ampel, confidence, doc_type, sender, processed_at FROM documents WHERE id = ?').get(req.params.id);

    if (!doc) {
      return res.status(404).json({ error: 'Dokument nicht gefunden' });
    }

    const logs = db.prepare(`
      SELECT step, status, message, created_at FROM processing_log
      WHERE document_id = ?
      ORDER BY created_at ASC
    `).all(req.params.id);

    res.json({ ...doc, logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analysis/ollama/models - get available Ollama models
router.get('/ollama/models', async (req, res) => {
  try {
    const { getOllamaModels } = require('../services/aiService');
    const models = await getOllamaModels();
    res.json({ models });
  } catch (err) {
    res.status(500).json({ error: err.message, models: [] });
  }
});

// GET /api/analysis/ollama/health - check Ollama health
router.get('/ollama/health', async (req, res) => {
  try {
    const axios = require('axios');
    const db = require('../database/db');
    const row = db.prepare("SELECT value FROM settings WHERE key = 'ollama_host'").get();
    const host = row ? row.value : 'http://127.0.0.1:11434';

    const response = await axios.get(`${host}/api/tags`, { timeout: 5000 });
    res.json({ status: 'ok', host, models_count: (response.data.models || []).length });
  } catch (err) {
    res.status(200).json({ status: 'error', error: err.message });
  }
});

module.exports = router;
