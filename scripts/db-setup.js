// Menyiapkan database di DATABASE_URL: membuat tabel lalu mengisi data contoh.
//   npm run db:setup   -> hanya berjalan bila database masih kosong
//   npm run seed       -> MENGHAPUS semua tabel aplikasi lalu mengisi ulang
// Data contoh dibuat dulu di PostgreSQL lokal sementara lalu disalin sekaligus,
// karena membuatnya langsung di Supabase butuh puluhan ribu query lewat internet.
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const { startLocalPg } = require('./local-pg');

try { process.loadEnvFile(); } catch { /* tanpa file .env */ }

const TABLES = [
  'users', 'activity_logs', 'categories', 'suppliers', 'customers', 'products', 'purchases', 'purchase_items',
  'batches', 'stock_movements', 'sales', 'sale_items', 'payments', 'accounts', 'journals', 'journal_lines',
  'expenses', 'employees', 'payrolls',
];
const BATCH = 500;

async function copyTable(rows, table, target) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  for (let i = 0; i < rows.length; i += BATCH) {
    const part = rows.slice(i, i + BATCH);
    const tuples = part.map((_, r) => `(${cols.map((__, c) => `$${r * cols.length + c + 1}`).join(',')})`);
    await target.query(`INSERT INTO ${table}(${cols.join(',')}) VALUES ${tuples.join(',')}`, part.flatMap((row) => cols.map((c) => row[c])));
  }
  if (cols.includes('id')) await target.query(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), (SELECT MAX(id) FROM ${table}))`);
}

async function main() {
  const targetUrl = process.env.DATABASE_URL;
  if (!targetUrl) throw new Error('DATABASE_URL belum diisi. Salin .env.example menjadi .env lalu isi connection string Supabase.');
  const reset = process.argv.includes('--reset');
  const schema = fs.readFileSync(path.join(__dirname, '..', 'src', 'schema.sql'), 'utf8');

  const local = await startLocalPg();
  try {
    process.env.DATABASE_URL = local.url;
    const db = require('../src/db');
    const target = new Client(db.pgConfig(targetUrl));
    await target.connect();
    try {
      const { rows: [{ found }] } = await target.query("SELECT to_regclass('public.users') IS NOT NULL AS found");
      if (found && !reset && (await target.query('SELECT 1 FROM users LIMIT 1')).rowCount) {
        throw new Error('Database sudah berisi data. Jalankan "npm run seed" bila memang ingin menghapus dan mengisi ulang.');
      }

      console.log('Membuat data contoh di PostgreSQL lokal...');
      await db.pool.query(schema);
      await require('../seed').seed();
      const data = {};
      for (const t of TABLES) data[t] = await db.all(`SELECT * FROM ${t} ORDER BY 1`);
      await db.pool.end();

      console.log('Menyalin ke database tujuan...');
      await target.query('BEGIN');
      await target.query(`DROP TABLE IF EXISTS ${[...TABLES, 'session'].join(',')} CASCADE`);
      await target.query(schema);
      for (const t of TABLES) await copyTable(data[t], t, target);
      await target.query('COMMIT');
      await target.query('ANALYZE'); // statistik baru agar query langsung cepat
      console.log(`Selesai: ${data.sales.length} penjualan, ${data.products.length} produk.`);
    } finally {
      await target.end();
    }
  } finally {
    await local.stop();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
