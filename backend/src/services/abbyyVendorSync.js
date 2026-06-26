'use strict';

/**
 * Lieferanten-Sync aus ABBYY / ERP-System
 * ----------------------------------------
 * Unterstützt drei Quellen:
 *   1. HTTP/REST-Endpunkt  → GET, erwartet JSON-Array oder { items: [...] }
 *   2. Lokale Datei / Netzlaufwerk  → CSV (;-getrennt) oder Excel (.xlsx/.xls)
 *   3. ABBYY FlexiCapture REST API  → versucht automatisch bekannte Pfade
 *
 * Jeder Datensatz kann enthalten:
 *   name (Pflicht), vendor_code / lieferantennummer / kreditorennummer,
 *   iban, ust_id / ustid / vat_id, category / kategorie, aliases
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const ExcelJS = require('exceljs');
const { v4: uuidv4 } = require('uuid');
const db = require('../database/db');
const { invalidateSupplierCache } = require('./supplierMatchingService');

// ──────────────────────────────────────────────────────────
// Normalisierung: verschiedene Spaltennamen → einheitliches Objekt
// ──────────────────────────────────────────────────────────
function normalizeRow(raw) {
  // Alle Keys auf Kleinbuchstaben, Leerzeichen → _
  const r = {};
  for (const [k, v] of Object.entries(raw)) {
    r[k.toLowerCase().replace(/\s+/g, '_')] = v == null ? null : String(v).trim();
  }

  const name =
    r.name || r.firmenname || r.lieferant || r.kreditor || r.vendor_name || null;
  if (!name) return null;

  return {
    name,
    vendor_code:
      r.vendor_code || r.lieferantennummer || r.lieferanten_nr ||
      r.kreditorennummer || r.kred_nr || r.liefnr || null,
    iban: (r.iban || '').replace(/\s+/g, '').toUpperCase() || null,
    ust_id:
      r.ust_id || r.ustid || r.umsatzsteuer_id || r.vat_id || r.vat || null,
    category:
      r.category || r.kategorie || r.gruppe || null,
    aliases: r.aliases
      ? r.aliases.split(',').map((a) => a.trim()).filter(Boolean)
      : [],
  };
}

// ──────────────────────────────────────────────────────────
// CSV-Parser (Semikolon oder Komma, erste Zeile = Header)
// ──────────────────────────────────────────────────────────
function parseCsv(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  const sep = lines[0].includes(';') ? ';' : ',';
  const headers = lines[0].split(sep).map((h) => h.replace(/^"|"$/g, '').trim());

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(sep).map((c) => c.replace(/^"|"$/g, '').trim());
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = cols[idx] || null; });
    const norm = normalizeRow(obj);
    if (norm) rows.push(norm);
  }
  return rows;
}

// ──────────────────────────────────────────────────────────
// Excel-Parser
// ──────────────────────────────────────────────────────────
async function parseExcel(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.worksheets[0];

  const headerRow = sheet.getRow(1).values.slice(1);
  const headers = headerRow.map((h) => String(h || '').trim());

  const rows = [];
  sheet.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    const vals = row.values.slice(1);
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = vals[idx] != null ? String(vals[idx]).trim() : null; });
    const norm = normalizeRow(obj);
    if (norm) rows.push(norm);
  });
  return rows;
}

// ──────────────────────────────────────────────────────────
// JSON-Antwort normalisieren (REST-Endpunkt)
// ──────────────────────────────────────────────────────────
function parseJsonResponse(data) {
  // Array direkt
  if (Array.isArray(data)) return data.map(normalizeRow).filter(Boolean);
  // { items: [...] } oder { data: [...] } oder { vendors: [...] }
  const list = data.items || data.data || data.vendors || data.suppliers || data.records || null;
  if (Array.isArray(list)) return list.map(normalizeRow).filter(Boolean);
  return [];
}

// ──────────────────────────────────────────────────────────
// Sync-Einstellungen aus DB lesen
// ──────────────────────────────────────────────────────────
function getSyncSettings() {
  const keys = [
    'abbyy_vendor_sync_url',
    'abbyy_vendor_sync_interval_hours',
    'abbyy_vendor_sync_last',
    'abbyy_api_url',
    'abbyy_api_username',
    'abbyy_api_password',
  ];
  const rows = db.prepare(`SELECT key, value FROM settings WHERE key IN (${keys.map(() => '?').join(',')})`)
    .all(...keys);
  const s = {};
  for (const r of rows) s[r.key] = r.value;
  return s;
}

// ──────────────────────────────────────────────────────────
// Lieferanten in DB einfügen / aktualisieren
// ──────────────────────────────────────────────────────────
function upsertSuppliers(rows) {
  const stmt = db.prepare(`
    INSERT INTO suppliers (id, name, aliases, category, iban, vendor_code, ust_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      aliases      = CASE WHEN excluded.aliases != '[]'     THEN excluded.aliases     ELSE suppliers.aliases END,
      category     = COALESCE(excluded.category,     suppliers.category),
      iban         = COALESCE(excluded.iban,         suppliers.iban),
      vendor_code  = COALESCE(excluded.vendor_code,  suppliers.vendor_code),
      ust_id       = COALESCE(excluded.ust_id,       suppliers.ust_id),
      updated_at   = datetime('now')
  `);

  let imported = 0, updated = 0, errors = 0;
  const errorDetails = [];

  const run = db.transaction(() => {
    for (const row of rows) {
      try {
        const existing = db.prepare('SELECT id FROM suppliers WHERE name = ?').get(row.name);
        const id = existing ? existing.id : uuidv4();
        stmt.run(
          id, row.name,
          JSON.stringify(row.aliases || []),
          row.category || null,
          row.iban || null,
          row.vendor_code || null,
          row.ust_id || null,
        );
        if (existing) updated++; else imported++;
      } catch (err) {
        errors++;
        errorDetails.push({ name: row.name, error: err.message });
      }
    }
  });

  run();
  invalidateSupplierCache();
  return { imported, updated, errors, errorDetails, total: rows.length };
}

// ──────────────────────────────────────────────────────────
// ABBYY FlexiCapture: automatische Endpunkt-Suche
// ──────────────────────────────────────────────────────────
async function tryAbbyyVendorEndpoints(apiUrl, authHeaders) {
  const candidates = [
    '/api/v1/vendors',
    '/api/v1/suppliers',
    '/api/v1/lookup/vendors',
    '/api/v1/lookup/suppliers',
    '/api/v1/lookup-lists/vendors',
    '/api/v1/databases/vendors/records',
    '/api/v1/resources/vendors',
  ];

  for (const ep of candidates) {
    try {
      const res = await axios.get(apiUrl + ep, { headers: authHeaders, timeout: 8000 });
      if (res.status === 200 && res.data) {
        const rows = parseJsonResponse(res.data);
        if (rows.length > 0) {
          console.log(`[VendorSync] ABBYY-Endpunkt gefunden: ${ep} (${rows.length} Einträge)`);
          return rows;
        }
      }
    } catch (_) {
      // Endpunkt nicht vorhanden oder Fehler → nächsten versuchen
    }
  }
  return null;
}

// ──────────────────────────────────────────────────────────
// Haupt-Sync-Funktion
// ──────────────────────────────────────────────────────────
async function syncSuppliers(options = {}) {
  const s = getSyncSettings();
  const syncUrl = options.url || s.abbyy_vendor_sync_url || '';

  let rows = [];
  let source = '';

  // ── 1. Konfigurierten URL/Pfad nutzen ──────────────────
  if (syncUrl) {
    if (syncUrl.startsWith('http://') || syncUrl.startsWith('https://')) {
      // HTTP-Endpunkt
      const res = await axios.get(syncUrl, { timeout: 30000 });
      const ct = (res.headers['content-type'] || '').toLowerCase();
      if (ct.includes('json')) {
        rows = parseJsonResponse(res.data);
      } else {
        // CSV als Text
        rows = parseCsv(typeof res.data === 'string' ? res.data : JSON.stringify(res.data));
      }
      source = `HTTP: ${syncUrl}`;
    } else {
      // Lokale Datei / Netzlaufwerk
      const absPath = path.resolve(syncUrl);
      if (!fs.existsSync(absPath)) {
        throw new Error(`Datei nicht gefunden: ${absPath}`);
      }
      const ext = path.extname(absPath).toLowerCase();
      if (ext === '.csv') {
        rows = parseCsv(fs.readFileSync(absPath, 'utf-8'));
      } else if (['.xlsx', '.xls'].includes(ext)) {
        rows = await parseExcel(absPath);
      } else {
        throw new Error(`Nicht unterstütztes Dateiformat: ${ext}`);
      }
      source = `Datei: ${absPath}`;
    }
  }

  // ── 2. Fallback: ABBYY REST API direkt abfragen ────────
  if (rows.length === 0 && s.abbyy_api_url) {
    const token = s.abbyy_api_username
      ? Buffer.from(`${s.abbyy_api_username}:${s.abbyy_api_password || ''}`).toString('base64')
      : null;
    const authHeaders = token ? { Authorization: `Basic ${token}` } : {};
    const abbyyRows = await tryAbbyyVendorEndpoints(
      s.abbyy_api_url.replace(/\/$/, ''),
      authHeaders,
    );
    if (abbyyRows && abbyyRows.length > 0) {
      rows = abbyyRows;
      source = `ABBYY API: ${s.abbyy_api_url}`;
    }
  }

  if (rows.length === 0) {
    throw new Error(
      'Keine Lieferantendaten gefunden. Bitte "Lieferanten-Sync URL" in den Einstellungen konfigurieren ' +
      '(HTTP-Endpunkt oder Pfad zu Excel/CSV auf dem Netzlaufwerk).'
    );
  }

  const stats = upsertSuppliers(rows);

  // Letzten Sync-Zeitstempel speichern
  db.prepare(`
    INSERT INTO settings (key, value) VALUES ('abbyy_vendor_sync_last', datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = datetime('now'), updated_at = datetime('now')
  `).run();

  console.log(`[VendorSync] ✓ ${stats.imported} neu, ${stats.updated} aktualisiert, ${stats.errors} Fehler (Quelle: ${source})`);

  return {
    ...stats,
    source,
    message: `${stats.imported} neu importiert, ${stats.updated} aktualisiert, ${stats.errors} Fehler`,
  };
}

// ──────────────────────────────────────────────────────────
// Auto-Sync: wird vom Autopiloten aufgerufen
// ──────────────────────────────────────────────────────────
async function autoSyncIfDue() {
  const s = getSyncSettings();
  const intervalHours = parseFloat(s.abbyy_vendor_sync_interval_hours || '0');
  if (!intervalHours || intervalHours <= 0) return null;

  const lastStr = s.abbyy_vendor_sync_last;
  if (lastStr) {
    const last = new Date(lastStr);
    const diffHours = (Date.now() - last.getTime()) / 3_600_000;
    if (diffHours < intervalHours) return null; // noch nicht fällig
  }

  try {
    return await syncSuppliers();
  } catch (err) {
    console.warn('[VendorSync] Auto-Sync fehlgeschlagen:', err.message);
    return null;
  }
}

module.exports = { syncSuppliers, autoSyncIfDue, upsertSuppliers };
