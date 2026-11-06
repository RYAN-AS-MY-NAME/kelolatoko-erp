// Pengujian end-to-end: menjalankan server dengan PostgreSQL sementara lalu menguji
// alur bisnis lintas modul (pembelian -> stok -> penjualan -> keuangan -> laporan)
// dan penanganan kesalahan. Jalankan: npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { startLocalPg } = require('../scripts/local-pg');
const { today } = require('../src/util');

const PORT = 3999;
const BASE = `http://localhost:${PORT}`;

let server;
let db;
let local;
const cookies = {};

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try { await fetch(BASE + '/login'); return; } catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  throw new Error('Server tidak menyala');
}

async function login(role) {
  const r = await fetch(BASE + '/login', {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: role, password: role + '123' }),
  });
  assert.equal(r.status, 302, `login ${role}`);
  cookies[role] = r.headers.get('set-cookie').split(';')[0];
}

const form = (role, url, data) =>
  fetch(BASE + url, { method: 'POST', redirect: 'manual', headers: { cookie: cookies[role], 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(data) });

async function flashAfter(role, res) {
  const r = await fetch(BASE + (res.headers.get('location') || '/'), { headers: { cookie: cookies[role] } });
  const m = (await r.text()).match(/class="alert alert-(\w+)" role="alert">([^<]*)</);
  return m ? { type: m[1], msg: m[2] } : null;
}

const pos = (role, body) =>
  fetch(BASE + '/pos', { method: 'POST', headers: { cookie: cookies[role], 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });

const stock = async (pid) => (await db.get('SELECT COALESCE(SUM(qty_remaining),0) AS q FROM batches WHERE product_id=?', pid)).q;
const bal = (code) => require('../src/services/finance').balance(code);
const productId = async (sku) => (await db.get('SELECT id FROM products WHERE sku=?', sku)).id;

before(async () => {
  local = await startLocalPg();
  process.env.DATABASE_URL = local.url;
  db = require('../src/db');
  await db.pool.query(fs.readFileSync(path.join(__dirname, '..', 'src', 'schema.sql'), 'utf8'));
  await require('../seed').seed();
  server = spawn(process.execPath, ['--no-warnings', 'server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT }, stdio: 'ignore' });
  await waitForServer();
  for (const r of ['owner', 'kasir', 'gudang', 'keuangan']) await login(r);
});

after(async () => {
  server?.kill();
  await db?.pool.end();
  await local?.stop();
});

test('1. Login gagal menampilkan pesan error', async () => {
  const r = await fetch(BASE + '/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'username=owner&password=salah' });
  assert.equal(r.status, 401);
  assert.match(await r.text(), /Nama pengguna atau kata sandi salah/);
});

test('2. Hak akses: kasir tidak boleh membuka laporan keuangan & membuat PO', async () => {
  const r1 = await fetch(BASE + '/reports/profit-loss', { headers: { cookie: cookies.kasir } });
  assert.equal(r1.status, 403);
  const r2 = await form('kasir', '/purchases', { supplier_id: 1 });
  assert.equal(r2.status, 403);
});

test('3. Procure-to-Pay: PO -> terima barang -> stok & hutang bertambah -> bayar', async () => {
  const pid = await productId('GLA-1');
  const stockBefore = await stock(pid), hutangBefore = await bal('2101'), persediaanBefore = await bal('1301');

  let r = await form('gudang', '/purchases', {
    supplier_id: 1, order_date: today(), due_date: '',
    'product_id[]': pid, 'qty[]': 20, 'unit_cost[]': 17000, 'expiry_date[]': '',
  });
  assert.equal(r.status, 302);
  const poId = Number(r.headers.get('location').split('/').pop());
  assert.equal((await db.get('SELECT status FROM purchases WHERE id=?', poId)).status, 'dipesan');
  assert.equal(await stock(pid), stockBefore, 'stok belum berubah sebelum barang diterima');

  r = await form('gudang', `/purchases/${poId}/receive`, { pay_amount: 0 });
  assert.equal(r.status, 302);
  assert.equal(await stock(pid), stockBefore + 20, 'stok bertambah 20');
  assert.equal(await bal('2101'), hutangBefore + 340000, 'hutang bertambah 340.000');
  assert.equal(await bal('1301'), persediaanBefore + 340000, 'nilai persediaan bertambah');
  assert.equal((await db.get('SELECT buy_price FROM products WHERE id=?', pid)).buy_price, 17000, 'harga beli produk diperbarui');

  const kasBefore = await bal('1101');
  r = await form('keuangan', `/purchases/${poId}/pay`, { amount: 340000 });
  assert.equal(await bal('1101'), kasBefore - 340000, 'kas berkurang');
  assert.equal(await bal('2101'), hutangBefore, 'hutang kembali seperti semula');
});

test('4. Order-to-Cash: penjualan tunai mengurangi stok (FEFO), menambah kas, mencatat HPP', async () => {
  const pid = await productId('BRS-PRM-5');
  const stockBefore = await stock(pid), kasBefore = await bal('1101'), hppBefore = await bal('5101');
  const r = await pos('kasir', { items: [{ productId: pid, qty: 2 }], cashReceived: 200000 });
  assert.equal(r.status, 200);
  const { id } = await r.json();
  const sale = await db.get('SELECT * FROM sales WHERE id=?', id);
  assert.equal(sale.total, 150000);
  assert.equal(await stock(pid), stockBefore - 2);
  assert.equal(await bal('1101'), kasBefore + 150000);
  assert.equal(await bal('5101'), hppBefore + sale.cogs);
  assert.ok(sale.cogs > 0 && sale.cogs < sale.total, 'HPP diambil dari harga modal batch');
});

test('5. Penggajian: gaji dibayar dari kas dan tercatat sebagai beban gaji', async () => {
  const period = today().slice(0, 7);
  const expected = (await db.get('SELECT SUM(base_salary) s FROM employees WHERE active=1')).s;
  const kasBefore = await bal('1101'), gajiBefore = await bal('6101');
  const r = await form('keuangan', '/hr/payroll', { period });
  assert.equal(r.status, 302);
  assert.equal(await bal('1101'), kasBefore - expected, 'kas berkurang sebesar total gaji pokok');
  assert.equal(await bal('6101'), gajiBefore + expected, 'beban gaji bertambah');
  const again = await flashAfter('keuangan', await form('keuangan', '/hr/payroll', { period }));
  assert.match(again.msg, /sudah dibayar/, 'gaji tidak bisa dibayar dua kali');
});

test('6. Error: stok tidak cukup, uang kurang, keranjang kosong', async () => {
  const pid = await productId('BSK-KLG');
  let r = await pos('kasir', { items: [{ productId: pid, qty: 9999 }] });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /tidak cukup/);

  r = await pos('kasir', { items: [{ productId: pid, qty: 1 }], cashReceived: 1000 });
  assert.match((await r.json()).error, /kurang dari total/);

  r = await pos('kasir', { items: [] });
  assert.match((await r.json()).error, /Keranjang masih kosong/);
});

test('7. Barang kedaluwarsa tidak bisa dijual, lalu dihapus sebagai kerugian', async () => {
  const pid = await productId('SMB-340');
  let r = await pos('kasir', { items: [{ productId: pid, qty: 1 }] });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /kedaluwarsa/);

  const batch = await db.get('SELECT * FROM batches WHERE product_id=? AND qty_remaining>0', pid);
  const lossBefore = await bal('6105');
  r = await form('gudang', `/inventory/batches/${batch.id}/writeoff`, { qty: batch.qty_remaining, reason: 'Kedaluwarsa' });
  assert.equal(r.status, 302);
  assert.equal(await bal('6105'), lossBefore + batch.qty_remaining * batch.unit_cost, 'kerugian masuk beban');
});

test('8. Halaman fitur yang dipangkas sudah tidak ada', async () => {
  for (const url of ['/finance/journal', '/finance/receivables', '/reports/balance-sheet', '/inventory/opname', '/hr/attendance', '/logs', '/master/categories']) {
    const r = await fetch(BASE + url, { headers: { cookie: cookies.owner }, redirect: 'manual' });
    assert.equal(r.status, 404, url);
  }
});

test('9. Pengeluaran mengurangi kas; pengeluaran melebihi saldo ditolak', async () => {
  const kasBefore = await bal('1101');
  let r = await form('keuangan', '/finance/expenses', { date: today(), account: '6102', amount: 250000, description: 'Token listrik' });
  assert.equal(await bal('1101'), kasBefore - 250000);

  r = await form('keuangan', '/finance/expenses', { date: today(), account: '6199', amount: 999999999, description: 'Uji' });
  const flash = await flashAfter('keuangan', r);
  assert.equal(flash.type, 'error');
  assert.match(flash.msg, /Saldo kas tidak cukup/);
  assert.equal(await bal('1101'), kasBefore - 250000, 'kas tidak berubah karena transaksi ditolak');
});

test('10. Pembatalan penjualan mengembalikan stok dan membalik jurnal', async () => {
  const pid = await productId('MIE-GRG');
  let r = await pos('kasir', { items: [{ productId: pid, qty: 5 }] });
  const { id } = await r.json();
  const stockAfterSale = await stock(pid), kasAfterSale = await bal('1101');

  r = await form('kasir', `/sales/${id}/void`, { reason: 'uji' });
  assert.equal(r.status, 403, 'kasir tidak boleh membatalkan');

  r = await form('owner', `/sales/${id}/void`, { reason: 'Salah input' });
  assert.equal(await stock(pid), stockAfterSale + 5);
  assert.equal(await bal('1101'), kasAfterSale - 17500);
  assert.equal((await db.get('SELECT status FROM sales WHERE id=?', id)).status, 'batal');
});

test('11. Validasi master data: harga jual di bawah harga beli ditolak', async () => {
  const r = await form('gudang', '/master/products', { sku: 'UJI-1', name: 'Uji', category_id: 1, unit: 'pcs', buy_price: 10000, sell_price: 9000, min_stock: 1, active: 1 });
  assert.equal(r.status, 400);
  assert.match(await r.text(), /Harga jual tidak boleh di bawah harga beli/);
});

test('12. Integritas akhir: neraca seimbang & persediaan = nilai batch', async () => {
  const { balanceSheet } = require('../src/services/finance');
  const bs = await balanceSheet('2999-12-31');
  assert.ok(bs.balanced, `Aset ${bs.totalAssets} = Kewajiban+Modal ${bs.totalLiabilities + bs.totalEquity}`);
  const batchValue = (await db.get('SELECT SUM(qty_remaining*unit_cost) AS v FROM batches')).v;
  assert.equal(await bal('1301'), batchValue, 'saldo akun persediaan sama dengan nilai fisik batch');
});

test('13. Penjualan bersamaan: nomor nota unik dan stok tidak minus', async () => {
  const pid = await productId('KCP-520');
  const available = await stock(pid);
  const before = (await db.get('SELECT COUNT(*) AS n FROM sales')).n;
  const results = await Promise.all(Array.from({ length: 6 }, () => pos('kasir', { items: [{ productId: pid, qty: 1 }] })));
  const ok = results.filter((r) => r.status === 200).length;
  assert.equal(ok, Math.min(6, available), 'semua penjualan yang stoknya cukup berhasil');
  assert.equal(await stock(pid), available - ok);
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM sales')).n, before + ok);
});

test('14. ID bukan angka di URL menghasilkan 404, bukan error server', async () => {
  const r = await fetch(BASE + '/sales/abc', { headers: { cookie: cookies.owner } });
  assert.equal(r.status, 404);
});
