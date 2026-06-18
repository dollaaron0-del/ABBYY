'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const ExcelJS = require('exceljs');
const db = require('../database/db');

const router = express.Router();

const importStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const tmpDir = path.join(__dirname, '../../../uploads/tmp');
    fs.mkdirSync(tmpDir, { recursive: true });
    cb(null, tmpDir);
  },
  filename: (_req, file, cb) => {
    cb(null, `import_${Date.now()}${path.extname(file.originalname)}`);
  },
});

const importUpload = multer({
  storage: importStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.csv', '.xlsx', '.xls'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Nur CSV und Excel-Dateien erlaubt'), false);
    }
  },
});

// GET /api/suppliers - list all suppliers
router.get('/', (req, res) => {
  try {
    const { search, category, page = 1, limit = 100 } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    let where = 'WHERE 1=1';
    const params = [];

    if (search) {
      where += ' AND (name LIKE ? OR aliases LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    if (category) {
      where += ' AND category = ?';
      params.push(category);
    }

    const total = db.prepare(`SELECT COUNT(*) as count FROM suppliers ${where}`).get(...params);
    const rows = db.prepare(`
      SELECT * FROM suppliers ${where}
      ORDER BY name ASC
      LIMIT ? OFFSET ?
    `).all(...params, parseInt(limit, 10), offset);

    const suppliers = rows.map((s) => ({
      ...s,
      aliases: JSON.parse(s.aliases || '[]'),
    }));

    res.json({
      data: suppliers,
      pagination: {
        total: total.count,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        pages: Math.ceil(total.count / parseInt(limit, 10)),
      },
    });
  } catch (err) {
    console.error('Error listing suppliers:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/suppliers/:id
router.get('/:id', (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);
    if (!row) {
      return res.status(404).json({ error: 'Lieferant nicht gefunden' });
    }
    res.json({ ...row, aliases: JSON.parse(row.aliases || '[]') });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/suppliers - create supplier
router.post('/', (req, res) => {
  try {
    const { name, aliases = [], category } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name ist erforderlich' });
    }

    const existing = db.prepare('SELECT id FROM suppliers WHERE name = ?').get(name.trim());
    if (existing) {
      return res.status(409).json({ error: 'Lieferant mit diesem Namen existiert bereits' });
    }

    const id = uuidv4();
    const aliasesJson = JSON.stringify(Array.isArray(aliases) ? aliases : []);

    db.prepare(`
      INSERT INTO suppliers (id, name, aliases, category)
      VALUES (?, ?, ?, ?)
    `).run(id, name.trim(), aliasesJson, category || null);

    const created = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id);
    res.status(201).json({ ...created, aliases: JSON.parse(created.aliases) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/suppliers/:id - update supplier
router.put('/:id', (req, res) => {
  try {
    const { name, aliases, category } = req.body;

    const existing = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Lieferant nicht gefunden' });
    }

    if (name && name.trim() !== existing.name) {
      const duplicate = db.prepare('SELECT id FROM suppliers WHERE name = ? AND id != ?').get(name.trim(), req.params.id);
      if (duplicate) {
        return res.status(409).json({ error: 'Lieferant mit diesem Namen existiert bereits' });
      }
    }

    const newName = (name && name.trim()) || existing.name;
    const newAliases = aliases !== undefined ? JSON.stringify(Array.isArray(aliases) ? aliases : []) : existing.aliases;
    const newCategory = category !== undefined ? category : existing.category;

    db.prepare(`
      UPDATE suppliers
      SET name = ?, aliases = ?, category = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(newName, newAliases, newCategory, req.params.id);

    const updated = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);
    res.json({ ...updated, aliases: JSON.parse(updated.aliases) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/suppliers/:id
router.delete('/:id', (req, res) => {
  try {
    const existing = db.prepare('SELECT id FROM suppliers WHERE id = ?').get(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Lieferant nicht gefunden' });
    }

    db.prepare('UPDATE documents SET sender_id = NULL, sender_matched = 0 WHERE sender_id = ?').run(req.params.id);
    db.prepare('DELETE FROM suppliers WHERE id = ?').run(req.params.id);

    res.json({ message: 'Lieferant gelöscht' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/suppliers/categories - get unique categories
router.get('/meta/categories', (req, res) => {
  try {
    const rows = db.prepare('SELECT DISTINCT category FROM suppliers WHERE category IS NOT NULL ORDER BY category').all();
    res.json(rows.map((r) => r.category));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/suppliers/import - import from CSV or Excel
router.post('/import', importUpload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Keine Datei hochgeladen' });
  }

  const filePath = req.file.path;
  const ext = path.extname(req.file.originalname).toLowerCase();

  try {
    let rows = [];

    if (ext === '.csv') {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n').filter((l) => l.trim());
      const header = lines[0].split(';').map((h) => h.trim().toLowerCase());
      const nameIdx = header.indexOf('name') >= 0 ? header.indexOf('name') : 0;
      const aliasIdx = header.indexOf('aliases') >= 0 ? header.indexOf('aliases') : header.indexOf('aliase');
      const catIdx = header.indexOf('category') >= 0 ? header.indexOf('category') : header.indexOf('kategorie');

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(';').map((c) => c.trim().replace(/^"|"$/g, ''));
        if (!cols[nameIdx]) continue;
        const aliases = aliasIdx >= 0 && cols[aliasIdx]
          ? cols[aliasIdx].split(',').map((a) => a.trim()).filter(Boolean)
          : [];
        rows.push({
          name: cols[nameIdx],
          aliases,
          category: catIdx >= 0 ? cols[catIdx] : null,
        });
      }
    } else {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(filePath);
      const sheet = workbook.worksheets[0];
      const headerRow = sheet.getRow(1).values.slice(1).map((h) => String(h || '').trim().toLowerCase());
      const nameIdx = headerRow.indexOf('name') >= 0 ? headerRow.indexOf('name') : 0;
      const aliasIdx = headerRow.indexOf('aliases') >= 0 ? headerRow.indexOf('aliases') : headerRow.indexOf('aliase');
      const catIdx = headerRow.indexOf('category') >= 0 ? headerRow.indexOf('category') : headerRow.indexOf('kategorie');

      sheet.eachRow((row, rowNum) => {
        if (rowNum === 1) return;
        const vals = row.values.slice(1);
        const name = String(vals[nameIdx] || '').trim();
        if (!name) return;
        const aliasStr = aliasIdx >= 0 ? String(vals[aliasIdx] || '') : '';
        const aliases = aliasStr ? aliasStr.split(',').map((a) => a.trim()).filter(Boolean) : [];
        const category = catIdx >= 0 ? String(vals[catIdx] || '') || null : null;
        rows.push({ name, aliases, category });
      });
    }

    const insert = db.prepare(`
      INSERT INTO suppliers (id, name, aliases, category)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        aliases = excluded.aliases,
        category = excluded.category,
        updated_at = datetime('now')
    `);

    let imported = 0;
    let updated = 0;
    let errors = 0;
    const errorDetails = [];

    const runImport = db.transaction(() => {
      for (const row of rows) {
        try {
          const existing = db.prepare('SELECT id FROM suppliers WHERE name = ?').get(row.name);
          const id = existing ? existing.id : uuidv4();
          insert.run(id, row.name, JSON.stringify(row.aliases), row.category || null);
          if (existing) {
            updated++;
          } else {
            imported++;
          }
        } catch (err) {
          errors++;
          errorDetails.push({ name: row.name, error: err.message });
        }
      }
    });

    runImport();

    fs.unlink(filePath, () => {});

    res.json({
      message: `Import abgeschlossen: ${imported} neu, ${updated} aktualisiert, ${errors} Fehler`,
      imported,
      updated,
      errors,
      error_details: errorDetails,
    });
  } catch (err) {
    fs.unlink(filePath, () => {});
    console.error('Import error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/suppliers/export - export all suppliers as Excel
router.get('/export/excel', async (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM suppliers ORDER BY name').all();

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'ABBYY Rechnungsvorfilterung';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Lieferanten');
    sheet.columns = [
      { header: 'Name', key: 'name', width: 40 },
      { header: 'Aliases', key: 'aliases', width: 60 },
      { header: 'Kategorie', key: 'category', width: 25 },
      { header: 'Erstellt', key: 'created_at', width: 20 },
    ];

    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFD4A843' },
    };

    for (const row of rows) {
      const aliases = JSON.parse(row.aliases || '[]');
      sheet.addRow({
        name: row.name,
        aliases: aliases.join(', '),
        category: row.category || '',
        created_at: row.created_at,
      });
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="lieferanten_${new Date().toISOString().split('T')[0]}.xlsx"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
