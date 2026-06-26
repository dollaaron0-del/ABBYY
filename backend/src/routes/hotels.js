'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../database/db');
const { invalidateHotelCache } = require('../services/hotelMatchingService');

const router = express.Router();

// GET /api/hotels
router.get('/', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM hotels ORDER BY name ASC').all();
    res.json(rows.map((h) => ({ ...h, aliases: JSON.parse(h.aliases || '[]') })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/hotels/:id
router.get('/:id', (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM hotels WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Hotel nicht gefunden' });
    res.json({ ...row, aliases: JSON.parse(row.aliases || '[]') });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/hotels
router.post('/', (req, res) => {
  try {
    const { name, code, aliases = [] } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name ist erforderlich' });
    if (!code || !String(code).trim()) return res.status(400).json({ error: 'Kostenstellen-Code ist erforderlich' });

    const existing = db.prepare('SELECT id FROM hotels WHERE name = ?').get(name.trim());
    if (existing) return res.status(409).json({ error: 'Hotel mit diesem Namen existiert bereits' });

    const id = uuidv4();
    db.prepare('INSERT INTO hotels (id, name, code, aliases) VALUES (?, ?, ?, ?)').run(
      id, name.trim(), String(code).trim(), JSON.stringify(Array.isArray(aliases) ? aliases : [])
    );
    invalidateHotelCache();

    const created = db.prepare('SELECT * FROM hotels WHERE id = ?').get(id);
    res.status(201).json({ ...created, aliases: JSON.parse(created.aliases) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/hotels/:id
router.put('/:id', (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM hotels WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Hotel nicht gefunden' });

    const { name, code, aliases } = req.body;
    const newName = (name && name.trim()) || row.name;
    const newCode = code !== undefined ? String(code).trim() : row.code;
    const newAliases = aliases !== undefined ? JSON.stringify(Array.isArray(aliases) ? aliases : []) : row.aliases;

    db.prepare(`UPDATE hotels SET name = ?, code = ?, aliases = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(newName, newCode, newAliases, req.params.id);
    invalidateHotelCache();

    const updated = db.prepare('SELECT * FROM hotels WHERE id = ?').get(req.params.id);
    res.json({ ...updated, aliases: JSON.parse(updated.aliases) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/hotels/:id
router.delete('/:id', (req, res) => {
  try {
    const row = db.prepare('SELECT id FROM hotels WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Hotel nicht gefunden' });

    db.prepare('UPDATE documents SET hotel_id = NULL, hotel_code = NULL, hotel_name = NULL WHERE hotel_id = ?').run(req.params.id);
    db.prepare('DELETE FROM hotels WHERE id = ?').run(req.params.id);
    invalidateHotelCache();

    res.json({ message: 'Hotel gelöscht' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
