import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';

fs.mkdirSync(config.uploadDir, { recursive: true });

export const db = new DatabaseSync(config.dbFile);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
db.exec(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql'), 'utf8'));

const DEFAULT_SETTINGS = {
  plagiarism_threshold: '20',          // BR-003: institute-set similarity threshold (%)
  institutional_domain: 'lnmiit.ac.in', // FR-001: registration needs institutional credentials
  institute_name: 'The LNM Institute of Information Technology, Jaipur',
};
for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
  db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

const cache = new Map();
const stmt = sql => {
  let s = cache.get(sql);
  if (!s) { s = db.prepare(sql); cache.set(sql, s); }
  return s;
};

export const one = (sql, ...params) => stmt(sql).get(...params) ?? null;
export const all = (sql, ...params) => stmt(sql).all(...params);
export const run = (sql, ...params) => stmt(sql).run(...params);
export const insert = (sql, ...params) => Number(stmt(sql).run(...params).lastInsertRowid);

// NFR-008: all multi-step writes go through a single transaction so a failure never leaves partial data.
let depth = 0;
export function tx(fn) {
  if (depth > 0) return fn();
  depth++;
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    depth--;
  }
}

export const getSetting = key => one('SELECT value FROM settings WHERE key = ?', key)?.value;
export const setSetting = (key, value) =>
  run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, String(value));
