'use strict';

const Fuse = require('fuse.js');
const db = require('../database/db');

let _hotelCache = null;
let _hotelCacheTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

function loadHotelIndex() {
  const now = Date.now();
  if (_hotelCache && now - _hotelCacheTime < CACHE_TTL_MS) return _hotelCache;

  const rows = db.prepare('SELECT id, name, code, aliases FROM hotels').all();
  const entries = [];

  for (const row of rows) {
    let aliases = [];
    try { aliases = JSON.parse(row.aliases || '[]'); } catch {}

    entries.push({ hotel_id: row.id, hotel_name: row.name, hotel_code: row.code, search_name: row.name });
    for (const alias of aliases) {
      if (alias && alias.trim()) {
        entries.push({ hotel_id: row.id, hotel_name: row.name, hotel_code: row.code, search_name: alias.trim() });
      }
    }
  }

  _hotelCache = entries;
  _hotelCacheTime = now;
  return entries;
}

function invalidateHotelCache() {
  _hotelCache = null;
  _hotelCacheTime = 0;
}

/**
 * Versucht aus dem Dokumenttext zu ermitteln, für welches Hotel die Rechnung bestimmt ist.
 * Sucht nach Hotel-Namen und Aliases im Text (der Empfänger steht meist oben im Adressblock).
 */
function matchHotel(documentText) {
  if (!documentText) return null;

  const entries = loadHotelIndex();
  if (entries.length === 0) return null;

  // Nur die ersten 1500 Zeichen prüfen – Empfänger steht fast immer oben
  const searchText = documentText.slice(0, 1500).toLowerCase();

  // Exakte Suche zuerst
  for (const entry of entries) {
    if (searchText.includes(entry.search_name.toLowerCase())) {
      return { hotel_id: entry.hotel_id, hotel_name: entry.hotel_name, hotel_code: entry.hotel_code, score: 100 };
    }
  }

  // Fuzzy-Suche als Fallback
  const fuse = new Fuse(entries, {
    keys: ['search_name'],
    threshold: 0.35,
    includeScore: true,
    minMatchCharLength: 4,
    ignoreLocation: true,
  });

  // Suche mit den ersten 300 Zeichen (Adressblock)
  const snippet = documentText.slice(0, 300);
  const results = fuse.search(snippet);
  if (results.length === 0) return null;

  const best = results[0];
  const score = Math.round((1 - (best.score || 0)) * 100);
  if (score < 55) return null;

  return {
    hotel_id: best.item.hotel_id,
    hotel_name: best.item.hotel_name,
    hotel_code: best.item.hotel_code,
    score,
  };
}

module.exports = { matchHotel, invalidateHotelCache };
