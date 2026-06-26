'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('../database/db');
const { processDocument } = require('../services/documentProcessor');

const router = express.Router();

const UPLOADS_PATH = process.env.UPLOADS_PATH || path.join(__dirname, '../../../uploads');
const ORIGINALS_PATH = path.join(UPLOADS_PATH, 'originals');

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.mkdirSync(ORIGINALS_PATH, { recursive: true });
    cb(null, ORIGINALS_PATH);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const id = uuidv4();
    cb(null, `${id}${ext}`);
  },
});

const fileFilter = (_req, file, cb) => {
  const allowed = ['.pdf', '.jpg', '.jpeg', '.png', '.tiff', '.tif', '.bmp'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`Dateityp nicht erlaubt: ${ext}. Erlaubt: ${allowed.join(', ')}`), false);
  }
};

const maxSizeSetting = db.prepare("SELECT value FROM settings WHERE key = 'max_file_size_mb'").get();
const maxSizeMB = maxSizeSetting ? parseInt(maxSizeSetting.value, 10) : 50;

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: maxSizeMB * 1024 * 1024 },
});

// GET /api/documents - list all documents with optional filters
router.get('/', (req, res) => {
  try {
    const { status, ampel, page = 1, limit = 50, search } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    let where = 'WHERE 1=1';
    const params = [];

    if (status && status !== 'all') {
      where += ' AND d.status = ?';
      params.push(status);
    }
    if (ampel && ampel !== 'all') {
      where += ' AND d.ampel = ?';
      params.push(ampel);
    }
    if (search) {
      where += ' AND (d.original_name LIKE ? OR d.sender LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    const total = db.prepare(`SELECT COUNT(*) as count FROM documents d ${where}`).get(...params);
    const rows = db.prepare(`
      SELECT d.*, s.name as supplier_name
      FROM documents d
      LEFT JOIN suppliers s ON d.sender_id = s.id
      ${where}
      ORDER BY d.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, parseInt(limit, 10), offset);

    res.json({
      data: rows,
      pagination: {
        total: total.count,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        pages: Math.ceil(total.count / parseInt(limit, 10)),
      },
    });
  } catch (err) {
    console.error('Error listing documents:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/documents/stats - aggregated stats
router.get('/stats', (req, res) => {
  try {
    const { from, to } = req.query;
    let where = 'WHERE 1=1';
    const params = [];

    if (from) {
      where += ' AND date(created_at) >= ?';
      params.push(from);
    }
    if (to) {
      where += ' AND date(created_at) <= ?';
      params.push(to);
    }

    const stats = db.prepare(`
      SELECT
        COUNT(*) as total,
        COALESCE(SUM(CASE WHEN ampel = 'gruen' THEN 1 ELSE 0 END), 0) as gruen,
        COALESCE(SUM(CASE WHEN ampel = 'gelb' THEN 1 ELSE 0 END), 0) as gelb,
        COALESCE(SUM(CASE WHEN ampel = 'rot' THEN 1 ELSE 0 END), 0) as rot,
        COALESCE(SUM(CASE WHEN status = 'processed' THEN 1 ELSE 0 END), 0) as processed,
        COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) as pending,
        COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0) as error,
        COALESCE(SUM(CASE WHEN status = 'forwarded' THEN 1 ELSE 0 END), 0) as forwarded,
        COALESCE(AVG(confidence), 0) as avg_confidence
      FROM documents ${where}
    `).get(...params);

    const today = new Date().toISOString().split('T')[0];
    const todayStats = db.prepare(`
      SELECT
        COUNT(*) as total,
        COALESCE(SUM(CASE WHEN ampel = 'gruen' THEN 1 ELSE 0 END), 0) as gruen,
        COALESCE(SUM(CASE WHEN ampel = 'gelb' THEN 1 ELSE 0 END), 0) as gelb,
        COALESCE(SUM(CASE WHEN ampel = 'rot' THEN 1 ELSE 0 END), 0) as rot,
        COALESCE(SUM(CASE WHEN status = 'processed' THEN 1 ELSE 0 END), 0) as processed,
        COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) as pending
      FROM documents WHERE date(created_at) = ?
    `).get(today);

    res.json({ overall: stats, today: todayStats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/documents/:id - get single document
router.get('/:id', (req, res) => {
  try {
    const doc = db.prepare(`
      SELECT d.*, s.name as supplier_name, s.aliases as supplier_aliases
      FROM documents d
      LEFT JOIN suppliers s ON d.sender_id = s.id
      WHERE d.id = ?
    `).get(req.params.id);

    if (!doc) {
      return res.status(404).json({ error: 'Dokument nicht gefunden' });
    }

    const logs = db.prepare(`
      SELECT * FROM processing_log WHERE document_id = ? ORDER BY created_at ASC
    `).all(req.params.id);

    const feedbacks = db.prepare(`
      SELECT * FROM feedback WHERE document_id = ? ORDER BY created_at DESC
    `).all(req.params.id);

    res.json({ ...doc, processing_logs: logs, feedbacks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/documents/upload - upload single document
router.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Keine Datei hochgeladen' });
  }

  const id = path.basename(req.file.filename, path.extname(req.file.filename));

  try {
    const doc = {
      id,
      filename: req.file.filename,
      original_name: req.file.originalname,
      file_path: req.file.path,
      file_type: path.extname(req.file.originalname).toLowerCase().replace('.', ''),
      status: 'pending',
    };

    db.prepare(`
      INSERT INTO documents (id, filename, original_name, file_path, file_type, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(doc.id, doc.filename, doc.original_name, doc.file_path, doc.file_type, doc.status);

    res.status(202).json({
      message: 'Dokument hochgeladen. Verarbeitung gestartet.',
      document: doc,
    });

    setImmediate(() => {
      processDocument(id).catch((err) => {
        console.error(`Processing failed for document ${id}:`, err);
      });
    });
  } catch (err) {
    fs.unlink(req.file.path, () => {});
    res.status(500).json({ error: err.message });
  }
});

// POST /api/documents/upload-batch - batch upload
router.post('/upload-batch', upload.array('files', 50), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'Keine Dateien hochgeladen' });
  }

  const results = [];
  const insertDoc = db.prepare(`
    INSERT INTO documents (id, filename, original_name, file_path, file_type, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const file of req.files) {
    const id = path.basename(file.filename, path.extname(file.filename));
    const doc = {
      id,
      filename: file.filename,
      original_name: file.originalname,
      file_path: file.path,
      file_type: path.extname(file.originalname).toLowerCase().replace('.', ''),
      status: 'pending',
    };

    try {
      insertDoc.run(doc.id, doc.filename, doc.original_name, doc.file_path, doc.file_type, doc.status);
      results.push({ id, filename: file.originalname, status: 'queued' });

      setImmediate(() => {
        processDocument(id).catch((err) => {
          console.error(`Processing failed for document ${id}:`, err);
        });
      });
    } catch (err) {
      results.push({ filename: file.originalname, status: 'error', error: err.message });
      fs.unlink(file.path, () => {});
    }
  }

  res.status(202).json({
    message: `${results.filter((r) => r.status === 'queued').length} Dokumente hochgeladen und in Verarbeitung.`,
    results,
  });
});

// GET /api/documents/:id/preview-image - render page 1 as PNG (images: passthrough, PDFs: via pdftoppm)
router.get('/:id/preview-image', async (req, res) => {
  try {
    const doc = db.prepare('SELECT file_path, file_type, original_name FROM documents WHERE id = ?').get(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Dokument nicht gefunden' });
    if (!fs.existsSync(doc.file_path)) return res.status(404).json({ error: 'Datei nicht gefunden' });

    const { getPreviewImagePath } = require('../services/ocrService');
    const { imgPath, isTemp } = await getPreviewImagePath(doc.file_path, doc.file_type);

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=3600');

    const stream = fs.createReadStream(imgPath);
    stream.pipe(res);
    stream.on('end', () => {
      if (isTemp) fs.unlink(imgPath, () => {});
    });
    stream.on('error', () => {
      if (isTemp) fs.unlink(imgPath, () => {});
      if (!res.headersSent) res.status(500).json({ error: 'Fehler beim Lesen der Vorschau' });
    });
  } catch (err) {
    console.error('preview-image error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/documents/:id/ocr-region - OCR a selected region; optionally save as field correction
router.post('/:id/ocr-region', async (req, res) => {
  try {
    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Dokument nicht gefunden' });
    if (!fs.existsSync(doc.file_path)) return res.status(404).json({ error: 'Datei nicht gefunden' });

    const { x, y, w, h, field_name, save } = req.body;
    if (x == null || y == null || w == null || h == null) {
      return res.status(400).json({ error: 'x, y, w, h sind erforderlich' });
    }

    const { extractRegion } = require('../services/ocrService');
    const region = { x: parseFloat(x), y: parseFloat(y), w: parseFloat(w), h: parseFloat(h) };
    const ocrResult = await extractRegion(doc.file_path, doc.file_type, region);

    // Optionally save as a field correction with region for learning
    if (save && field_name && ocrResult.text) {
      let current = {};
      try {
        if (doc.extracted_fields) {
          current = typeof doc.extracted_fields === 'string'
            ? JSON.parse(doc.extracted_fields) : doc.extracted_fields;
        }
      } catch (_) {}

      const merged = { ...current, [field_name]: ocrResult.text };
      db.prepare('UPDATE documents SET extracted_fields = ? WHERE id = ?')
        .run(JSON.stringify(merged), doc.id);

      db.prepare(`
        INSERT INTO bot_corrections (id, document_name, field_name, bot_value, human_value, sender, sender_id, document_id, region_x, region_y, region_w, region_h)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        uuidv4(),
        doc.original_name,
        field_name,
        current[field_name] != null ? String(current[field_name]) : null,
        ocrResult.text,
        doc.sender || null,
        doc.sender_id || null,
        doc.id,
        region.x, region.y, region.w, region.h
      );
    }

    res.json({ text: ocrResult.text, confidence: ocrResult.confidence });
  } catch (err) {
    console.error('ocr-region error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/documents/:id/fields - save corrected extracted fields + log for learning
router.put('/:id/fields', (req, res) => {
  try {
    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Dokument nicht gefunden' });

    const { fields } = req.body;
    if (!fields || typeof fields !== 'object') {
      return res.status(400).json({ error: 'fields-Objekt erforderlich' });
    }

    let current = {};
    try {
      if (doc.extracted_fields) {
        current = typeof doc.extracted_fields === 'string'
          ? JSON.parse(doc.extracted_fields)
          : doc.extracted_fields;
      }
    } catch (_) {}

    const merged = { ...current, ...fields };
    db.prepare('UPDATE documents SET extracted_fields = ? WHERE id = ?')
      .run(JSON.stringify(merged), req.params.id);

    // field_sources aktualisieren: geänderte Felder als "manuell" markieren
    let currentSources = {};
    try { currentSources = doc.field_sources ? (typeof doc.field_sources === 'string' ? JSON.parse(doc.field_sources) : doc.field_sources) : {}; } catch (_) {}
    for (const [field, value] of Object.entries(fields)) {
      if (typeof value === 'object' && value !== null) continue;
      const oldVal = current[field] != null ? String(current[field]) : null;
      const newVal = value != null ? String(value) : null;
      if (oldVal !== newVal && newVal !== null && newVal !== '') currentSources[field] = 'manuell';
    }
    db.prepare('UPDATE documents SET field_sources = ? WHERE id = ?').run(JSON.stringify(currentSources), req.params.id);

    // Besten verfügbaren Absendernamen für Lernzwecke ermitteln.
    // Priorität: 1. Neu eingetragener absender/lieferant_name in diesem Speichervorgang
    //            2. Bestehender doc.sender
    // Zeilenumbrüche und Adressteile (nach erstem Komma + PLZ) werden entfernt.
    function cleanSender(raw) {
      if (!raw) return null;
      let s = String(raw).replace(/[\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim();
      // Wenn voll Adresse (z.B. "Firma GmbH, Musterstr. 1, 12345 Stadt") → nur Firmenteil
      const addrMatch = s.match(/^(.+?),\s*\d{5}/);
      if (addrMatch) s = addrMatch[1].trim();
      return s.slice(0, 120) || null;
    }
    const newSenderFromFields = fields.absender || fields.lieferant_name || null;
    const effectiveSender = cleanSender(newSenderFromFields) || cleanSender(doc.sender);

    // Log each changed primitive field into bot_corrections for learning
    // Arrays/objects (e.g. positionen) are stored in extracted_fields but not logged here
    const insertCorrection = db.prepare(`
      INSERT INTO bot_corrections (id, document_name, field_name, bot_value, human_value, sender, sender_id, document_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const runInserts = db.transaction(() => {
      for (const [field, value] of Object.entries(fields)) {
        if (typeof value === 'object' && value !== null) continue; // skip arrays/objects
        const oldVal = current[field] != null ? String(current[field]) : null;
        const newVal = value != null ? String(value) : null;
        if (oldVal !== newVal && newVal !== null && newVal !== '') {
          insertCorrection.run(
            uuidv4(),
            doc.original_name,
            field,
            oldVal,
            newVal,
            effectiveSender,
            doc.sender_id || null,
            doc.id
          );
        }
      }
    });
    runInserts();

    res.json({ success: true, extracted_fields: merged });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/documents/:id/corrections - get field correction history for this document's sender
router.get('/:id/corrections', (req, res) => {
  try {
    const doc = db.prepare('SELECT sender FROM documents WHERE id = ?').get(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Dokument nicht gefunden' });

    const corrections = db.prepare(`
      SELECT field_name, human_value, COUNT(*) as count
      FROM bot_corrections
      WHERE sender = ? AND human_value IS NOT NULL AND human_value != ''
      GROUP BY field_name, human_value
      ORDER BY count DESC, field_name ASC
    `).all(doc.sender || '__none__');

    res.json({ sender: doc.sender, corrections });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/documents/:id - update document (user correction)
router.patch('/:id', (req, res) => {
  try {
    const { user_correction, doc_type, sender, ampel, status } = req.body;
    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);

    if (!doc) {
      return res.status(404).json({ error: 'Dokument nicht gefunden' });
    }

    const updates = [];
    const params = [];

    if (user_correction !== undefined) {
      updates.push('user_correction = ?');
      params.push(user_correction);
    }
    if (doc_type !== undefined) {
      updates.push('doc_type = ?');
      params.push(doc_type);
    }
    if (sender !== undefined) {
      updates.push('sender = ?');
      params.push(sender);
    }
    if (ampel !== undefined) {
      updates.push('ampel = ?');
      params.push(ampel);
    }
    if (status !== undefined) {
      updates.push('status = ?');
      params.push(status);
    }

    // Auto-Alias: Wenn Absender korrigiert wird, alten KI-Wert als Alias speichern
    if (sender !== undefined && doc.sender && doc.sender !== sender && sender.trim()) {
      const { matchSupplier } = require('../services/supplierMatchingService');
      const match = matchSupplier(sender);

      if (match.matched) {
        updates.push('sender_id = ?');
        params.push(match.supplier_id);
        updates.push('sender_matched = ?');
        params.push(1);

        const oldSender = doc.sender.trim();
        const supplierRow = db.prepare('SELECT aliases, name FROM suppliers WHERE id = ?').get(match.supplier_id);
        if (supplierRow && oldSender.toLowerCase() !== supplierRow.name.toLowerCase()) {
          let aliases = [];
          try { aliases = JSON.parse(supplierRow.aliases || '[]'); } catch {}
          const alreadyExists = aliases.some((a) => a.toLowerCase() === oldSender.toLowerCase());
          if (!alreadyExists) {
            aliases.push(oldSender);
            db.prepare('UPDATE suppliers SET aliases = ? WHERE id = ?')
              .run(JSON.stringify(aliases), match.supplier_id);
            console.log(`[Auto-Alias] "${oldSender}" → "${supplierRow.name}"`);
          }
        }
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Keine Felder zum Aktualisieren angegeben' });
    }

    params.push(req.params.id);
    db.prepare(`UPDATE documents SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    if (user_correction) {
      const feedbackId = uuidv4();
      db.prepare(`
        INSERT INTO feedback (id, document_id, original_suggestion, corrected_value)
        VALUES (?, ?, ?, ?)
      `).run(feedbackId, req.params.id, doc.ai_suggestion, user_correction);
    }

    const updated = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/documents/:id
router.delete('/:id', (req, res) => {
  try {
    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);

    if (!doc) {
      return res.status(404).json({ error: 'Dokument nicht gefunden' });
    }

    db.prepare('DELETE FROM processing_log WHERE document_id = ?').run(req.params.id);
    db.prepare('DELETE FROM feedback WHERE document_id = ?').run(req.params.id);
    db.prepare('DELETE FROM documents WHERE id = ?').run(req.params.id);

    if (doc.file_path && fs.existsSync(doc.file_path)) {
      fs.unlink(doc.file_path, (err) => {
        if (err) console.error('Error deleting file:', err);
      });
    }

    res.json({ message: 'Dokument gelöscht' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
