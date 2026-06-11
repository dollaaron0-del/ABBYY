'use strict';

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '../../../data/database.sqlite');

let instance = null;

function getDb() {
  if (!instance) {
    instance = new Database(DB_PATH, {
      verbose: process.env.NODE_ENV === 'development' ? console.log : null,
    });

    instance.pragma('journal_mode = WAL');
    instance.pragma('foreign_keys = ON');
    instance.pragma('synchronous = NORMAL');
  }
  return instance;
}

module.exports = getDb();
