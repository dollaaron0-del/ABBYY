'use strict';

const Fuse = require('fuse.js');
const db = require('../database/db');

let _indexCache = null;
let _indexCacheTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 Minuten

/**
 * Load all suppliers from DB and flatten aliases into a searchable list.
 * Result is cached for 5 minutes to avoid repeated DB reads on every match.
 */
function loadSupplierIndex() {
  const now = Date.now();
  if (_indexCache && now - _indexCacheTime < CACHE_TTL_MS) {
    return _indexCache;
  }

  const rows = db.prepare('SELECT id, name, aliases, category FROM suppliers').all();
  const entries = [];

  for (const row of rows) {
    let aliases = [];
    try {
      aliases = JSON.parse(row.aliases || '[]');
    } catch {
      aliases = [];
    }

    entries.push({
      supplier_id: row.id,
      supplier_name: row.name,
      search_name: row.name,
      category: row.category,
      is_alias: false,
    });

    for (const alias of aliases) {
      if (alias && alias.trim()) {
        entries.push({
          supplier_id: row.id,
          supplier_name: row.name,
          search_name: alias.trim(),
          category: row.category,
          is_alias: true,
        });
      }
    }
  }

  _indexCache = entries;
  _indexCacheTime = now;
  return entries;
}

/**
 * Cache invalidieren – aufrufen wenn Lieferanten geändert werden.
 */
function invalidateSupplierCache() {
  _indexCache = null;
  _indexCacheTime = 0;
}

/**
 * Normalize a string for better matching:
 * - lowercase
 * - remove common legal suffixes (GmbH, AG, etc.)
 * - remove special characters
 * - trim whitespace
 */
function normalizeForMatching(str) {
  if (!str) return '';

  return str
    .toLowerCase()
    .replace(/\b(gmbh|ag|kg|kgaa|ohg|gbr|ug|e\.v\.|ev|se|plc|ltd|inc|s\.a\.|gmbh\s*&\s*co\.\s*kg)\b/gi, '')
    .replace(/[&+]/g, ' und ')
    .replace(/[^\w\sÀ-ÿ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Exakter Abgleich über IBAN oder USt-ID – gibt 100% Konfidenz wenn gefunden.
 */
function matchSupplierByIdentifier(iban, ustId) {
  if (iban) {
    const normalizedIban = iban.replace(/\s/g, '').toUpperCase();
    const row = db.prepare(`SELECT id, name, vendor_code FROM suppliers WHERE replace(upper(iban),' ','') = ?`).get(normalizedIban);
    if (row) return { matched: true, supplier_id: row.id, supplier_name: row.name, vendor_code: row.vendor_code || null, score: 100, match_method: 'iban' };
  }
  if (ustId) {
    const normalizedUstId = ustId.replace(/\s/g, '').toUpperCase();
    const row = db.prepare(`SELECT id, name, vendor_code FROM suppliers WHERE replace(upper(ust_id),' ','') = ?`).get(normalizedUstId);
    if (row) return { matched: true, supplier_id: row.id, supplier_name: row.name, vendor_code: row.vendor_code || null, score: 100, match_method: 'ust_id' };
  }
  return null;
}

/**
 * Match a sender name against the supplier list using fuzzy matching.
 * @param {string} senderName - extracted sender name from AI
 * @param {string|null} iban - extracted IBAN for exact matching
 * @param {string|null} ustId - extracted USt-ID for exact matching
 * @returns {{ matched: boolean, supplier_id: string|null, supplier_name: string|null, vendor_code: string|null, score: number, match_method: string }}
 */
function matchSupplier(senderName, iban = null, ustId = null) {
  // Zuerst exakter Abgleich über IBAN / USt-ID (100% sicher)
  const exactMatch = matchSupplierByIdentifier(iban, ustId);
  if (exactMatch) {
    console.log(`[Matching] Exakter Treffer via ${exactMatch.match_method.toUpperCase()}: ${exactMatch.supplier_name}`);
    return exactMatch;
  }

  if (!senderName || !senderName.trim()) {
    return { matched: false, supplier_id: null, supplier_name: null, vendor_code: null, score: 0 };
  }

  const entries = loadSupplierIndex();

  if (entries.length === 0) {
    return { matched: false, supplier_id: null, supplier_name: null, vendor_code: null, score: 0 };
  }

  // Try exact match first (case-insensitive)
  const normalizedSender = normalizeForMatching(senderName);
  for (const entry of entries) {
    if (normalizeForMatching(entry.search_name) === normalizedSender) {
      const sup = db.prepare('SELECT vendor_code FROM suppliers WHERE id = ?').get(entry.supplier_id);
      return {
        matched: true,
        supplier_id: entry.supplier_id,
        supplier_name: entry.supplier_name,
        vendor_code: sup ? sup.vendor_code : null,
        score: 100,
        match_method: 'name_exact',
      };
    }
  }

  // Fuzzy match using Fuse.js
  const fuse = new Fuse(entries, {
    keys: ['search_name'],
    threshold: 0.4,
    includeScore: true,
    minMatchCharLength: 3,
    ignoreLocation: true,
    useExtendedSearch: false,
  });

  const results = fuse.search(senderName);

  if (results.length === 0) {
    return { matched: false, supplier_id: null, supplier_name: null, vendor_code: null, score: 0 };
  }

  const best = results[0];
  const score = Math.round((1 - (best.score || 0)) * 100);

  if (score < 60) {
    return { matched: false, supplier_id: null, supplier_name: null, vendor_code: null, score };
  }

  const sup = db.prepare('SELECT vendor_code FROM suppliers WHERE id = ?').get(best.item.supplier_id);
  return {
    matched: true,
    supplier_id: best.item.supplier_id,
    supplier_name: best.item.supplier_name,
    vendor_code: sup ? sup.vendor_code : null,
    score,
    match_method: 'name_fuzzy',
  };
}

/**
 * Find the best matching suppliers (up to 5) for a given sender name.
 * Useful for suggesting corrections in the UI.
 */
function findCandidates(senderName, limit = 5) {
  if (!senderName || !senderName.trim()) return [];

  const entries = loadSupplierIndex();
  if (entries.length === 0) return [];

  const fuse = new Fuse(entries, {
    keys: ['search_name'],
    threshold: 0.6,
    includeScore: true,
    minMatchCharLength: 2,
    ignoreLocation: true,
  });

  const results = fuse.search(senderName, { limit });

  return results.map((r) => ({
    supplier_id: r.item.supplier_id,
    supplier_name: r.item.supplier_name,
    matched_via: r.item.is_alias ? `Alias: ${r.item.search_name}` : 'Name',
    score: Math.round((1 - (r.score || 0)) * 100),
  }));
}

module.exports = { matchSupplier, findCandidates, normalizeForMatching, invalidateSupplierCache };
