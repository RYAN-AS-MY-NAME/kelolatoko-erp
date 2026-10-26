// Koneksi database SQLite terpusat (modul bawaan Node.js: node:sqlite).
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const DB_FILE = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'erp.db');
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

const cache = new Map();
function stmt(sql) {
  let s = cache.get(sql);
  if (!s) { s = db.prepare(sql); cache.set(sql, s); }
  return s;
}
const clean = (params) => params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p));

const all = (sql, ...p) => stmt(sql).all(...clean(p));
const get = (sql, ...p) => stmt(sql).get(...clean(p));
const run = (sql, ...p) => {
  const r = stmt(sql).run(...clean(p));
  return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
};

// Transaksi atomik: bila satu langkah gagal, seluruh perubahan dibatalkan.
// Mendukung pemanggilan bersarang (service memanggil service lain).
let depth = 0;
function tx(fn) {
  if (depth > 0) {
    depth++;
    try { return fn(); } finally { depth--; }
  }
  db.exec('BEGIN');
  depth = 1;
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    depth = 0;
  }
}

// Nomor dokumen otomatis, contoh: PJ-20261026-004
function nextCode(prefix, table, date) {
  const stamp = `${prefix}-${date.replaceAll('-', '')}-`;
  const row = get(`SELECT code FROM ${table} WHERE code LIKE ? ORDER BY code DESC LIMIT 1`, stamp + '%');
  const n = row ? Number(row.code.slice(stamp.length)) + 1 : 1;
  return stamp + String(n).padStart(3, '0');
}

function logActivity(userId, action, detail = null) {
  run('INSERT INTO activity_logs(user_id, action, detail) VALUES (?,?,?)', userId, action, detail);
}

module.exports = { db, all, get, run, tx, nextCode, logActivity, DB_FILE };
