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

  console.log('Database schema initialized successfully.');
}

module.exports = { initializeSchema };
