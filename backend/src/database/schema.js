'use strict';

const db = require('./db');

function initializeSchema() {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      doc_type TEXT,
      sender TEXT,
      sender_matched INTEGER DEFAULT 0,
      sender_id TEXT,
      confidence INTEGER DEFAULT 0,
      ai_suggestion TEXT,
      ai_reasoning TEXT,
      user_correction TEXT,
      ampel TEXT DEFAULT 'rot',
      processed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (sender_id) REFERENCES suppliers(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      aliases TEXT NOT NULL DEFAULT '[]',
      category TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      original_suggestion TEXT,
      corrected_value TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS processing_log (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      step TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
    CREATE INDEX IF NOT EXISTS idx_documents_ampel ON documents(ampel);
    CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents(created_at);
    CREATE INDEX IF NOT EXISTS idx_processing_log_document_id ON processing_log(document_id);
    CREATE INDEX IF NOT EXISTS idx_feedback_document_id ON feedback(document_id);
  `);

  const defaultSettings = [
    { key: 'ollama_host', value: 'http://127.0.0.1:11434' },
    { key: 'ollama_model', value: 'llama3.2' },
    { key: 'confidence_threshold', value: '75' },
    { key: 'abbyy_endpoint', value: '' },
    { key: 'abbyy_auth_token', value: '' },
    { key: 'abbyy_enabled', value: 'false' },
    // FlexiCapture-Autopilot (API-Anbindung – wird aktiv sobald Zugangsdaten eingetragen sind)
    { key: 'abbyy_api_url', value: '' },
    { key: 'abbyy_api_username', value: '' },
    { key: 'abbyy_api_password', value: '' },
    { key: 'abbyy_autopilot_enabled', value: 'false' },
    { key: 'abbyy_auto_complete_threshold', value: '90' },
    { key: 'abbyy_poll_interval_sec', value: '60' },
    { key: 'abbyy_simulation_mode', value: 'false' },
    { key: 'demo_mode', value: 'false' },
    { key: 'claude_api_enabled', value: 'false' },
    { key: 'claude_api_key', value: '' },
    { key: 'auto_forward_green', value: 'false' },
    { key: 'log_level', value: 'info' },
    { key: 'max_file_size_mb', value: '50' },
    { key: 'ocr_language', value: 'deu+eng' },
  ];

  const insertSetting = db.prepare(
    `INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`
  );

  const insertMany = db.transaction((settings) => {
    for (const s of settings) {
      insertSetting.run(s.key, s.value);
    }
  });

  insertMany(defaultSettings);

  // Add extracted_fields column if it doesn't exist yet (migration-safe)
  try {
    db.exec(`ALTER TABLE documents ADD COLUMN extracted_fields TEXT`);
  } catch (_) { /* column already exists */ }

  // Bot correction log – tracks what humans changed vs. what the bot suggested
  db.exec(`
    CREATE TABLE IF NOT EXISTS bot_corrections (
      id TEXT PRIMARY KEY,
      document_name TEXT,
      field_name TEXT NOT NULL,
      bot_value TEXT,
      human_value TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_bot_corrections_field ON bot_corrections(field_name);
    CREATE INDEX IF NOT EXISTS idx_bot_corrections_created ON bot_corrections(created_at);
  `);

  // Migration: add sender + document_id + region to bot_corrections for learning
  try { db.exec(`ALTER TABLE bot_corrections ADD COLUMN sender TEXT`); } catch (_) {}
  try { db.exec(`ALTER TABLE bot_corrections ADD COLUMN document_id TEXT`); } catch (_) {}
  try { db.exec(`ALTER TABLE bot_corrections ADD COLUMN region_x REAL`); } catch (_) {}
  try { db.exec(`ALTER TABLE bot_corrections ADD COLUMN region_y REAL`); } catch (_) {}
  try { db.exec(`ALTER TABLE bot_corrections ADD COLUMN region_w REAL`); } catch (_) {}
  try { db.exec(`ALTER TABLE bot_corrections ADD COLUMN region_h REAL`); } catch (_) {}
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_bot_corrections_sender ON bot_corrections(sender)`);
  } catch (_) {}
  // Feldherkünfte: welche Quelle hat welches extrahierte Feld geliefert
  try { db.exec(`ALTER TABLE documents ADD COLUMN field_sources TEXT`); } catch (_) {}

  // Migration: sender + sender_id in bot_corrections nachfüllen falls noch null
  // (betrifft alle Korrekturen die gespeichert wurden bevor doc.sender bekannt war)
  try {
    db.exec(`
      UPDATE bot_corrections
      SET
        sender = (
          SELECT replace(replace(replace(d.sender, char(10), ' '), char(13), ' '), '  ', ' ')
          FROM documents d WHERE d.id = bot_corrections.document_id
        ),
        sender_id = (
          SELECT d.sender_id FROM documents d WHERE d.id = bot_corrections.document_id
        )
      WHERE document_id IS NOT NULL
        AND (sender IS NULL OR sender = '' OR instr(sender, char(10)) > 0)
    `);
  } catch (_) {}

  // sender_id für stabile Lieferantenverknüpfung (unabhängig vom Absendertext)
  try { db.exec(`ALTER TABLE bot_corrections ADD COLUMN sender_id TEXT`); } catch (_) {}
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_bot_corrections_sender_id ON bot_corrections(sender_id)`);
  } catch (_) {}

  // Add field_corrections_applied column to documents (tracks how many learned corrections were auto-applied)
  try { db.exec(`ALTER TABLE documents ADD COLUMN learned_corrections_count INTEGER DEFAULT 0`); } catch (_) {}

  // Hotels / Kostenstellen-Tabelle
  db.exec(`
    CREATE TABLE IF NOT EXISTS hotels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      code TEXT NOT NULL,
      aliases TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_hotels_code ON hotels(code);
  `);

  // Lieferanten: Lieferantennummer, IBAN, USt-ID
  try { db.exec(`ALTER TABLE suppliers ADD COLUMN vendor_code TEXT`); } catch (_) {}
  try { db.exec(`ALTER TABLE suppliers ADD COLUMN iban TEXT`); } catch (_) {}
  try { db.exec(`ALTER TABLE suppliers ADD COLUMN ust_id TEXT`); } catch (_) {}

  // Dokumente: Hotel-Zuordnung
  try { db.exec(`ALTER TABLE documents ADD COLUMN hotel_id TEXT REFERENCES hotels(id)`); } catch (_) {}
  try { db.exec(`ALTER TABLE documents ADD COLUMN hotel_code TEXT`); } catch (_) {}
  try { db.exec(`ALTER TABLE documents ADD COLUMN hotel_name TEXT`); } catch (_) {}

  // ABBYY-Lernrückkanal: was wurde an ABBYY geschickt, welche Aufgaben-ID hat ABBYY vergeben
  try { db.exec(`ALTER TABLE documents ADD COLUMN abbyy_task_id TEXT`); } catch (_) {}
  try { db.exec(`ALTER TABLE documents ADD COLUMN abbyy_sent_fields TEXT`); } catch (_) {}
  try { db.exec(`ALTER TABLE documents ADD COLUMN abbyy_learned_at TEXT`); } catch (_) {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_documents_abbyy_task ON documents(abbyy_task_id)`); } catch (_) {}

  // Lieferanten-Sync Einstellungen
  const syncSettings = [
    { key: 'abbyy_vendor_sync_url', value: '' },
    { key: 'abbyy_vendor_sync_interval_hours', value: '0' },
    { key: 'abbyy_vendor_sync_last', value: '' },
  ];
  for (const s of syncSettings) {
    db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`).run(s.key, s.value);
  }

  // OCR-Sprache auf deu+eng aktualisieren falls noch auf alter Einstellung
  db.prepare(`UPDATE settings SET value = 'deu+eng' WHERE key = 'ocr_language' AND value = 'deu'`).run();

  console.log('Database schema initialized successfully.');
}

module.exports = { initializeSchema };
