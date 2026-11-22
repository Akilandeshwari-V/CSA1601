// SQLite persistence using Node's built-in node:sqlite (Node 22.5+). No native add-ons to compile on Windows.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export function openDb(dir) {
  let file = ':memory:';
  if (dir !== ':memory:') { fs.mkdirSync(dir, { recursive: true }); file = path.join(dir, 'smartdmart.db'); }
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'analyst' CHECK (role IN ('admin','analyst')),
      pass_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_login TEXT
    );
    CREATE TABLE IF NOT EXISTS activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER, username TEXT, action TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', ip TEXT,
      at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS datasets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, csv TEXT NOT NULL, uploaded_by TEXT,
      rows_accepted INTEGER, rows_rejected INTEGER,
      active INTEGER NOT NULL DEFAULT 0,
      at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  // Migration for databases created before multi-dataset support.
  const have = new Set(db.prepare('PRAGMA table_info(datasets)').all().map((c) => c.name));
  for (const [col, ddl] of [['mapping', 'TEXT'], ['currency', "TEXT DEFAULT 'INR'"], ['date_order', "TEXT DEFAULT 'auto'"], ['source_columns', 'TEXT']]) {
    if (!have.has(col)) db.exec(`ALTER TABLE datasets ADD COLUMN ${col} ${ddl}`);
  }
  return db;
}
