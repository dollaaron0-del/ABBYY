'use strict';

const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '../../../data/database.sqlite');

let instance = null;

function getDb() {
  if (!instance) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

    // better-sqlite3 liefert für Node.js 18 fertige Windows-Binaries mit,
    // keine Kompilierung nötig.
    const Database = require('better-sqlite3');
    instance = new Database(DB_PATH);
    instance.pragma('journal_mode = WAL');
    instance.pragma('foreign_keys = ON');
    instance.pragma('synchronous = NORMAL');
  }
  return instance;
}

module.exports = getDb();
