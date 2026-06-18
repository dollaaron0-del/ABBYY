'use strict';

const Fuse = require('fuse.js');
const db = require('../database/db');

/**
 * Load all suppliers from DB and flatten aliases into a searchable list.
 */
function loadSupplierIndex() {
  const rows = db.prepare('SELECT id, name, aliases, category FROM suppliers').all();
  const entries = [];

  for (const row of rows) {
    let aliases = [];
    try {
      aliases = JSON.parse(row.aliases || '[]');
    } catch {
      aliases = [];
    }

    // Main entry for the canonical name
    entries.push({
      supplier_id: row.id,
      supplier_name: row.name,
      search_name: row.name,
      category: row.category,
      is_alias: false,
    });

    // Entries for each alias
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

  return entries;
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
 * Match a sender name against the supplier list using fuzzy matching.
 * @param {string} senderName - extracted sender name from AI
 * @returns {{ matched: boolean, supplier_id: string|null, supplier_name: string|null, score: number }}
 */
function matchSupplier(senderName) {
  if (!senderName || !senderName.trim()) {
    return { matched: false, supplier_id: null, supplier_name: null, score: 0 };
  }

  const entries = loadSupplierIndex();

  if (entries.length === 0) {
    return { matched: false, supplier_id: null, supplier_name: null, score: 0 };
  }

  // Try exact match first (case-insensitive)
  const normalizedSender = normalizeForMatching(senderName);
  for (const entry of entries) {
    if (normalizeForMatching(entry.search_name) === normalizedSender) {
      return {
        matched: true,
        supplier_id: entry.supplier_id,
        supplier_name: entry.supplier_name,
        score: 100,
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
    return { matched: false, supplier_id: null, supplier_name: null, score: 0 };
  }

  const best = results[0];
  // Fuse.js score: 0 = perfect, 1 = worst. Convert to 0-100 scale where 100 = perfect.
  const score = Math.round((1 - (best.score || 0)) * 100);

  // Require a minimum score of 60 to consider it a match
  if (score < 60) {
    return { matched: false, supplier_id: null, supplier_name: null, score };
  }

  return {
    matched: true,
    supplier_id: best.item.supplier_id,
    supplier_name: best.item.supplier_name,
    score,
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

module.exports = { matchSupplier, findCandidates, normalizeForMatching };
