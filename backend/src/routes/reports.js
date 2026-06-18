'use strict';

const express = require('express');
const ExcelJS = require('exceljs');
const db = require('../database/db');

const router = express.Router();

// GET /api/reports/summary - summary stats for a date range
router.get('/summary', (req, res) => {
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

    const overall = db.prepare(`
      SELECT
        COUNT(*) as total,
        COALESCE(SUM(CASE WHEN ampel = 'gruen' THEN 1 ELSE 0 END), 0) as gruen,
        COALESCE(SUM(CASE WHEN ampel = 'gelb' THEN 1 ELSE 0 END), 0) as gelb,
        COALESCE(SUM(CASE WHEN ampel = 'rot' THEN 1 ELSE 0 END), 0) as rot,
        COALESCE(SUM(CASE WHEN status = 'processed' THEN 1 ELSE 0 END), 0) as processed,
        COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) as pending,
        COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0) as errors,
        COALESCE(SUM(CASE WHEN status = 'forwarded' THEN 1 ELSE 0 END), 0) as forwarded,
        COALESCE(SUM(CASE WHEN user_correction IS NOT NULL THEN 1 ELSE 0 END), 0) as corrected,
        COALESCE(ROUND(AVG(CASE WHEN confidence > 0 THEN confidence END), 1), 0) as avg_confidence,
        COALESCE(SUM(CASE WHEN doc_type = 'Rechnung' THEN 1 ELSE 0 END), 0) as type_rechnung,
        COALESCE(SUM(CASE WHEN doc_type = 'Mahnung' THEN 1 ELSE 0 END), 0) as type_mahnung,
        COALESCE(SUM(CASE WHEN doc_type = 'Behördenbescheid' THEN 1 ELSE 0 END), 0) as type_behoerde,
        COALESCE(SUM(CASE WHEN doc_type = 'Unleserlich' THEN 1 ELSE 0 END), 0) as type_unleserlich,
        COALESCE(SUM(CASE WHEN doc_type = 'Sonstiges' THEN 1 ELSE 0 END), 0) as type_sonstiges
      FROM documents ${where}
    `).get(...params);

    const byDay = db.prepare(`
      SELECT
        date(created_at) as day,
        COUNT(*) as total,
        COALESCE(SUM(CASE WHEN ampel = 'gruen' THEN 1 ELSE 0 END), 0) as gruen,
        COALESCE(SUM(CASE WHEN ampel = 'gelb' THEN 1 ELSE 0 END), 0) as gelb,
        COALESCE(SUM(CASE WHEN ampel = 'rot' THEN 1 ELSE 0 END), 0) as rot
      FROM documents ${where}
      GROUP BY date(created_at)
      ORDER BY day ASC
    `).all(...params);

    const topSenders = db.prepare(`
      SELECT sender, COUNT(*) as count
      FROM documents
      ${where} AND sender IS NOT NULL
      GROUP BY sender
      ORDER BY count DESC
      LIMIT 10
    `).all(...params);

    res.json({ overall, by_day: byDay, top_senders: topSenders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reports/processing-log - get processing log
router.get('/processing-log', (req, res) => {
  try {
    const { from, to, status, step, page = 1, limit = 100 } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    let where = 'WHERE 1=1';
    const params = [];

    if (from) {
      where += ' AND date(pl.created_at) >= ?';
      params.push(from);
    }
    if (to) {
      where += ' AND date(pl.created_at) <= ?';
      params.push(to);
    }
    if (status) {
      where += ' AND pl.status = ?';
      params.push(status);
    }
    if (step) {
      where += ' AND pl.step = ?';
      params.push(step);
    }

    const total = db.prepare(`
      SELECT COUNT(*) as count FROM processing_log pl ${where}
    `).get(...params);

    const rows = db.prepare(`
      SELECT pl.*, d.original_name, d.ampel
      FROM processing_log pl
      LEFT JOIN documents d ON pl.document_id = d.id
      ${where}
      ORDER BY pl.created_at DESC
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
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reports/feedback - feedback statistics
router.get('/feedback', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT
        f.*,
        d.original_name,
        d.doc_type,
        d.sender
      FROM feedback f
      LEFT JOIN documents d ON f.document_id = d.id
      ORDER BY f.created_at DESC
      LIMIT 500
    `).all();

    const stats = db.prepare(`
      SELECT
        COUNT(*) as total_corrections,
        COUNT(DISTINCT document_id) as corrected_documents
      FROM feedback
    `).get();

    res.json({ data: rows, stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reports/export - export to Excel
router.get('/export', async (req, res) => {
  try {
    const { from, to } = req.query;

    let where = 'WHERE 1=1';
    const params = [];

    if (from) {
      where += ' AND date(d.created_at) >= ?';
      params.push(from);
    }
    if (to) {
      where += ' AND date(d.created_at) <= ?';
      params.push(to);
    }

    const documents = db.prepare(`
      SELECT
        d.*,
        s.name as supplier_name
      FROM documents d
      LEFT JOIN suppliers s ON d.sender_id = s.id
      ${where}
      ORDER BY d.created_at DESC
    `).all(...params);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'ABBYY Rechnungsvorfilterung - Althoff Hotels & Resorts';
    workbook.created = new Date();

    // Summary sheet
    const summarySheet = workbook.addWorksheet('Zusammenfassung');
    summarySheet.addRow(['ABBYY Rechnungsvorfilterung - Bericht']);
    summarySheet.addRow(['Althoff Hotels & Resorts']);
    summarySheet.addRow([]);
    summarySheet.addRow(['Zeitraum:', `${from || 'Alle'} bis ${to || 'Heute'}`]);
    summarySheet.addRow(['Exportiert am:', new Date().toLocaleString('de-DE')]);
    summarySheet.addRow([]);

    const totals = {
      total: documents.length,
      gruen: documents.filter((d) => d.ampel === 'gruen').length,
      gelb: documents.filter((d) => d.ampel === 'gelb').length,
      rot: documents.filter((d) => d.ampel === 'rot').length,
      forwarded: documents.filter((d) => d.status === 'forwarded').length,
    };

    summarySheet.addRow(['Gesamt Dokumente:', totals.total]);
    summarySheet.addRow(['Grün (auto-verarbeitet):', totals.gruen]);
    summarySheet.addRow(['Gelb (manuelle Prüfung):', totals.gelb]);
    summarySheet.addRow(['Rot (Fehler/Unleserlich):', totals.rot]);
    summarySheet.addRow(['An ABBYY weitergeleitet:', totals.forwarded]);

    summarySheet.getRow(1).font = { bold: true, size: 14 };
    summarySheet.getRow(2).font = { bold: true };
    summarySheet.getColumn(1).width = 35;
    summarySheet.getColumn(2).width = 20;

    // Documents sheet
    const docSheet = workbook.addWorksheet('Dokumente');
    docSheet.columns = [
      { header: 'Datum', key: 'created_at', width: 20 },
      { header: 'Dateiname', key: 'original_name', width: 40 },
      { header: 'Dokumenttyp', key: 'doc_type', width: 20 },
      { header: 'Absender', key: 'sender', width: 30 },
      { header: 'Lieferant', key: 'supplier_name', width: 30 },
      { header: 'Lieferant gematcht', key: 'sender_matched', width: 20 },
      { header: 'Ampel', key: 'ampel', width: 12 },
      { header: 'Konfidenz (%)', key: 'confidence', width: 15 },
      { header: 'Status', key: 'status', width: 15 },
      { header: 'Korrektur', key: 'user_correction', width: 20 },
      { header: 'KI-Begründung', key: 'ai_reasoning', width: 50 },
      { header: 'Verarbeitet am', key: 'processed_at', width: 20 },
    ];

    docSheet.getRow(1).font = { bold: true };
    docSheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1A3A5C' },
    };
    docSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    for (const doc of documents) {
      const row = docSheet.addRow({
        ...doc,
        sender_matched: doc.sender_matched ? 'Ja' : 'Nein',
      });

      // Color rows by ampel
      let fillColor = null;
      if (doc.ampel === 'gruen') fillColor = 'FFD4EDDA';
      else if (doc.ampel === 'gelb') fillColor = 'FFFFF3CD';
      else if (doc.ampel === 'rot') fillColor = 'FFF8D7DA';

      if (fillColor) {
        row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillColor } };
      }
    }

    docSheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: docSheet.columns.length },
    };

    const dateStr = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="bericht_${dateStr}.xlsx"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Export error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
