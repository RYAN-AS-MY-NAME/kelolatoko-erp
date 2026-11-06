// Koneksi database PostgreSQL (Supabase) terpusat.
const { AsyncLocalStorage } = require('node:async_hooks');
const { Pool, types } = require('pg');
const { AppError } = require('./util');

try { process.loadEnvFile(); } catch { /* tanpa file .env: pakai environment variable yang ada */ }

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL belum diisi. Salin .env.example menjadi .env lalu isi connection string Supabase.');
}

// BIGINT dan NUMERIC (hasil COUNT/SUM) dikirim pg sebagai string; ubah ke number
// agar perhitungan di JavaScript tidak menjadi penggabungan teks.
types.setTypeParser(types.builtins.INT8, Number);
types.setTypeParser(types.builtins.NUMERIC, Number);

// sslmode di URL menimpa opsi ssl dan membuat pg menolak sertifikat Supabase,
// jadi dihapus dan koneksi TLS diatur di sini.
function pgConfig(url) {
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  return {
    connectionString: url.replace(/([?&])sslmode=[^&]*&?/, '$1').replace(/[?&]$/, ''),
    ssl: local ? false : { rejectUnauthorized: false },
  };
}

const pool = new Pool({
  ...pgConfig(process.env.DATABASE_URL),
  max: process.env.VERCEL ? 3 : 10,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 10000,
});
pool.on('error', (err) => console.error('Koneksi database terputus:', err.message));

// Koneksi transaksi yang sedang berjalan pada request ini (bila ada).
const txClient = new AsyncLocalStorage();

// Kode tetap memakai placeholder "?"; diubah ke gaya Postgres ($1, $2, ...).
const cache = new Map();
function toPg(sql) {
  let out = cache.get(sql);
  if (!out) {
    let i = 0;
    out = sql.replace(/\?/g, () => `$${++i}`);
    cache.set(sql, out);
  }
  return out;
}

async function query(sql, params) {
  const values = params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p));
  try {
    return await (txClient.getStore() || pool).query(toPg(sql), values);
  } catch (err) {
    // Nilai bukan angka atau terlalu besar, misalnya URL /sales/abc
    if (err.code === '22P02' || err.code === '22003') throw new AppError('Data tidak ditemukan.', 404);
    throw err;
  }
}

const all = async (sql, ...p) => (await query(sql, p)).rows;
const get = async (sql, ...p) => (await query(sql, p)).rows[0];
const run = async (sql, ...p) => {
  const isInsert = /^\s*INSERT/i.test(sql) && !/RETURNING/i.test(sql);
  const r = await query(isInsert ? `${sql} RETURNING id` : sql, p);
  return { changes: r.rowCount, id: r.rows[0]?.id };
};

// Transaksi atomik: bila satu langkah gagal, seluruh perubahan dibatalkan.
// Mendukung pemanggilan bersarang (service memanggil service lain).
// Kunci advisory membuat transaksi berjalan satu per satu, sehingga pemeriksaan
// stok, saldo kas, dan nomor dokumen aman saat dua kasir menyimpan bersamaan.
async function tx(fn) {
  if (txClient.getStore()) return fn();
  const client = await pool.connect();
  let failure;
  try {
    await client.query('BEGIN; SELECT pg_advisory_xact_lock(1)');
    const result = await txClient.run(client, fn);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch((e) => { failure = e; });
    throw err;
  } finally {
    client.release(failure);
  }
}

// Nomor dokumen otomatis, contoh: PJ-20261026-004
async function nextCode(prefix, table, date) {
  const stamp = `${prefix}-${date.replaceAll('-', '')}-`;
  const row = await get(`SELECT code FROM ${table} WHERE code LIKE ? ORDER BY code DESC LIMIT 1`, stamp + '%');
  const n = row ? Number(row.code.slice(stamp.length)) + 1 : 1;
  return stamp + String(n).padStart(3, '0');
}

async function logActivity(userId, action, detail = null) {
  await run('INSERT INTO activity_logs(user_id, action, detail) VALUES (?,?,?)', userId, action, detail);
}

module.exports = { pool, pgConfig, all, get, run, tx, nextCode, logActivity };
