'use strict';

require('dotenv').config();

// Globale Schutzschilde: Ein einzelner Fehler (z.B. in OCR oder KI-Analyse)
// darf niemals den gesamten Server beenden.
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION] Server läuft weiter:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION] Server läuft weiter:', reason);
});

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');

const { initializeSchema } = require('./database/schema');

const UPLOADS_PATH = process.env.UPLOADS_PATH || path.join(__dirname, '../../uploads');
const PORT = process.env.PORT || 3001;

const requiredDirs = [
  UPLOADS_PATH,
  path.join(UPLOADS_PATH, 'originals'),
  path.join(UPLOADS_PATH, 'processed'),
  path.join(UPLOADS_PATH, 'thumbnails'),
];

for (const dir of requiredDirs) {
  fs.mkdirSync(dir, { recursive: true });
}

// Schema MUSS vor dem Laden der Routen initialisiert sein,
// da die Routen-Module ihre SQL-Statements beim Laden vorbereiten.
initializeSchema();

// Hängengebliebene Dokumente lösen:
// Wenn der Server während einer Analyse beendet wurde, bleibt das Dokument
// sonst für immer auf "In Bearbeitung". Beim Start werden solche Dokumente
// automatisch neu in die Verarbeitung gegeben.
function recoverStuckDocuments() {
  try {
    const db = require('./database/db');
    const stuck = db.prepare(`
      SELECT id, original_name FROM documents
      WHERE status IN ('processing', 'pending')
    `).all();

    if (stuck.length === 0) return;

    console.log(`[Recovery] ${stuck.length} hängende(s) Dokument(e) gefunden – starte Analyse neu...`);
    const { processDocument } = require('./services/documentProcessor');

    for (const doc of stuck) {
      db.prepare("UPDATE documents SET status = 'pending' WHERE id = ?").run(doc.id);
      setImmediate(() => {
        processDocument(doc.id).catch((err) => {
          console.error(`[Recovery] Analyse von ${doc.original_name} fehlgeschlagen:`, err.message);
        });
      });
    }
  } catch (err) {
    console.error('[Recovery] Fehler beim Wiederanlauf:', err.message);
  }
}

// Watchdog: Dokumente, die länger als 15 Minuten "In Bearbeitung" sind,
// werden auf Fehler gesetzt, damit sie nie endlos hängen bleiben.
function startProcessingWatchdog() {
  const db = require('./database/db');
  setInterval(() => {
    try {
      // Maßgeblich ist der letzte Protokolleintrag: wenn seit über 15 Minuten
      // nichts mehr passiert ist, gilt die Verarbeitung als hängengeblieben.
      const result = db.prepare(`
        UPDATE documents SET
          status = 'error',
          ampel = 'rot',
          ai_reasoning = 'Analyse abgebrochen: Zeitüberschreitung (über 15 Minuten ohne Fortschritt). Bitte erneut analysieren.',
          processed_at = datetime('now')
        WHERE status = 'processing'
          AND COALESCE(
            (SELECT MAX(datetime(pl.created_at)) FROM processing_log pl WHERE pl.document_id = documents.id),
            datetime(created_at)
          ) < datetime('now', '-8 minutes')
      `).run();
      if (result.changes > 0) {
        console.warn(`[Watchdog] ${result.changes} hängende(s) Dokument(e) auf Fehler gesetzt.`);
      }
    } catch (err) {
      console.error('[Watchdog] Fehler:', err.message);
    }
  }, 60_000);
}

const documentsRouter = require('./routes/documents');
const analysisRouter = require('./routes/analysis');
const suppliersRouter = require('./routes/suppliers');
const settingsRouter = require('./routes/settings');
const abbyyRouter = require('./routes/abbyy');
const abbyyBotRouter = require('./routes/abbyyBot');
const reportsRouter = require('./routes/reports');

const app = express();

app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use('/uploads', express.static(UPLOADS_PATH));

// Frontend statisch ausliefern (eingebettet in die EXE)
const PUBLIC_PATH = path.join(__dirname, '../public');
if (fs.existsSync(PUBLIC_PATH)) {
  app.use(express.static(PUBLIC_PATH));
}

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    service: 'ABBYY Rechnungsvorfilterung',
  });
});

app.use('/api/documents', documentsRouter);
app.use('/api/analysis', analysisRouter);
app.use('/api/suppliers', suppliersRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/abbyy', abbyyRouter);
app.use('/api/abbyy/bot', abbyyBotRouter);
app.use('/api/reports', reportsRouter);

// SPA Fallback: alle nicht-API Routen → index.html
app.get('*', (req, res) => {
  const indexFile = path.join(__dirname, '../public/index.html');
  if (fs.existsSync(indexFile)) {
    res.sendFile(indexFile);
  } else {
    res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
  }
});

app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
});

app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

cron.schedule('0 6 * * *', async () => {
  console.log('[CRON] Running daily report generation at 06:00...');
  try {
    const db = require('./database/db');
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split('T')[0];

    const stats = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN ampel = 'gruen' THEN 1 ELSE 0 END) as gruen,
        SUM(CASE WHEN ampel = 'gelb' THEN 1 ELSE 0 END) as gelb,
        SUM(CASE WHEN ampel = 'rot' THEN 1 ELSE 0 END) as rot
      FROM documents
      WHERE date(created_at) = ?
    `).get(dateStr);

    console.log(`[CRON] Daily stats for ${dateStr}:`, stats);
  } catch (err) {
    console.error('[CRON] Daily report error:', err);
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`ABBYY Rechnungsvorfilterung Backend running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Uploads directory: ${UPLOADS_PATH}`);

  // Hängende Dokumente automatisch neu starten + Watchdog aktivieren
  recoverStuckDocuments();
  startProcessingWatchdog();

  // ABBYY-Autopilot starten (optional – läuft nur, wenn aktiviert und Dateien vorhanden)
  try {
    const autopilot = require('./services/abbyyAutopilot');
    autopilot.startScheduler();
  } catch (err) {
    // Kein Fehler wenn die Dateien noch nicht vorhanden sind
    if (!err.message.includes('Cannot find module')) {
      console.error('[Autopilot] Konnte nicht gestartet werden:', err.message);
    }
  }
});

module.exports = app;
