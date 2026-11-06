// Mengisi database dengan data contoh "AMART" selama 45 hari terakhir.
// Semua transaksi historis dibuat lewat service yang sama dengan aplikasi,
// sehingga stok, jurnal, hutang, dan piutang saling konsisten.
// Dijalankan lewat scripts/db-setup.js (npm run db:setup / npm run seed).

async function seed() {
  const { run, get, all } = require('./src/db');
  const { hashPassword } = require('./src/auth');
  const { today, addDays } = require('./src/util');
  const finance = require('./src/services/finance');
  const inventory = require('./src/services/inventory');
  const purchasing = require('./src/services/purchasing');
  const sales = require('./src/services/sales');
  const hr = require('./src/services/hr');
  const { ACC } = finance;

  // PRNG deterministik agar data contoh selalu sama
  let s = 20261026;
  const rand = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const pick = (xs) => xs[Math.floor(rand() * xs.length)];
  const between = (a, b) => a + Math.floor(rand() * (b - a + 1));

  await finance.seedAccounts();

  const users = [
    ['owner', 'owner123', 'Pak Hendra (Pemilik)', 'owner'],
    ['kasir', 'kasir123', 'Andi Saputra', 'kasir'],
    ['gudang', 'gudang123', 'Budi Santoso', 'gudang'],
    ['keuangan', 'keuangan123', 'Citra Lestari', 'keuangan'],
  ];
  for (const [u, p, n, r] of users) await run('INSERT INTO users(username, password_hash, name, role) VALUES (?,?,?,?)', u, hashPassword(p), n, r);
  const OWNER = 1;

  const categories = ['Beras & Tepung', 'Minyak & Gula', 'Mi & Makanan Instan', 'Minuman', 'Bumbu Dapur', 'Telur & Susu', 'Kebutuhan Rumah Tangga', 'Makanan Ringan'];
  for (const c of categories) await run('INSERT INTO categories(name) VALUES (?)', c);
  const cat = async (name) => (await get('SELECT id FROM categories WHERE name=?', name)).id;

  const suppliers = [
    ['CV Sumber Pangan Makmur', '0812-3456-7801', 'Jl. Pasar Induk No. 12'],
    ['UD Sinar Grosir', '0813-2233-4455', 'Jl. Raya Timur No. 45'],
    ['PT Segar Minuman Nusantara', '0821-9988-7766', 'Kawasan Industri Blok C-7'],
    ['Peternakan Telur Barokah', '0857-1122-3344', 'Desa Sukamaju RT 03'],
  ];
  for (const sp of suppliers) await run('INSERT INTO suppliers(name, phone, address) VALUES (?,?,?)', ...sp);

  // [sku, nama, kategori, supplier, satuan, beli, jual, min, umur simpan (hari, null = tidak ada), bobot laku]
  const products = [
    ['BRS-PRM-5', 'Beras Premium 5 kg', 'Beras & Tepung', 1, 'karung', 68000, 75000, 8, null, 6],
    ['BRS-MED-5', 'Beras Medium 5 kg', 'Beras & Tepung', 1, 'karung', 60000, 66000, 8, null, 5],
    ['TPG-1', 'Tepung Terigu 1 kg', 'Beras & Tepung', 1, 'bks', 11000, 13000, 10, 180, 3],
    ['GLA-1', 'Gula Pasir 1 kg', 'Minyak & Gula', 1, 'bks', 16500, 18500, 15, 365, 7],
    ['MYK-2L', 'Minyak Goreng 2 L', 'Minyak & Gula', 2, 'pouch', 34000, 38000, 10, 365, 6],
    ['MYK-1L', 'Minyak Goreng 1 L', 'Minyak & Gula', 2, 'pouch', 17500, 19500, 12, 365, 6],
    ['MIE-GRG', 'Mi Instan Goreng', 'Mi & Makanan Instan', 2, 'bks', 3000, 3500, 40, 240, 14],
    ['MIE-KUA', 'Mi Instan Kuah Ayam', 'Mi & Makanan Instan', 2, 'bks', 2800, 3300, 40, 240, 12],
    ['SRD-155', 'Sarden Kaleng 155 g', 'Mi & Makanan Instan', 2, 'kaleng', 9000, 11000, 6, 720, 2],
    ['AIR-600', 'Air Mineral 600 ml', 'Minuman', 3, 'btl', 2500, 3500, 48, 365, 12],
    ['KOP-SCH', 'Kopi Sachet (1 renceng)', 'Minuman', 3, 'renceng', 12000, 14000, 10, 365, 6],
    ['TEH-25', 'Teh Celup isi 25', 'Minuman', 3, 'kotak', 6500, 8000, 8, 365, 4],
    ['SRP-460', 'Sirup Botol 460 ml', 'Minuman', 3, 'btl', 18000, 22000, 4, 365, 0],
    ['KCP-520', 'Kecap Manis 520 ml', 'Bumbu Dapur', 2, 'btl', 21000, 24000, 6, 365, 3],
    ['GRM-250', 'Garam Beryodium 250 g', 'Bumbu Dapur', 1, 'bks', 2500, 3500, 15, 720, 3],
    ['SMB-340', 'Saus Sambal 340 ml', 'Bumbu Dapur', 2, 'btl', 9500, 12000, 5, 50, 1],
    ['TLR-1', 'Telur Ayam 1 kg', 'Telur & Susu', 4, 'kg', 27000, 30000, 10, 14, 8],
    ['SKM-370', 'Susu Kental Manis 370 g', 'Telur & Susu', 2, 'kaleng', 11500, 13500, 8, 300, 3],
    ['DTG-800', 'Deterjen Bubuk 800 g', 'Kebutuhan Rumah Tangga', 2, 'bks', 19000, 22500, 6, null, 3],
    ['SBN-780', 'Sabun Cuci Piring 780 ml', 'Kebutuhan Rumah Tangga', 2, 'pouch', 13000, 15500, 6, null, 3],
    ['LPG-3', 'Gas LPG 3 kg (isi ulang)', 'Kebutuhan Rumah Tangga', 1, 'tabung', 18000, 22000, 8, null, 5],
    ['BSK-KLG', 'Biskuit Kaleng Premium', 'Makanan Ringan', 2, 'kaleng', 55000, 65000, 3, 365, 0],
    ['KRP-SNK', 'Kerupuk Bawang 250 g', 'Makanan Ringan', 1, 'bks', 8000, 10000, 5, 120, 2],
  ];
  for (const p of products) {
    // stok minimum ≈ kebutuhan ±4 hari penjualan
    const minStock = Math.max(p[7], Math.ceil(p[9] * 2.2 * 4));
    await run(
      'INSERT INTO products(sku, name, category_id, supplier_id, unit, buy_price, sell_price, min_stock) VALUES (?,?,?,?,?,?,?,?)',
      p[0], p[1], await cat(p[2]), p[3], p[4], p[5], p[6], minStock
    );
  }
  const prodRows = await all('SELECT * FROM products ORDER BY id');
  const meta = Object.fromEntries(products.map((p) => [p[0], { shelf: p[8], weight: p[9] }]));

  const customers = [
    ['Bu Sari (Warung Makan)', '0812-1111-2222', 'Gg. Melati No. 3'],
    ['Pak Joko (Toko Kelontong)', '0813-3333-4444', 'Jl. Kenanga No. 8'],
    ['Bu Rina', '0856-5555-6666', 'Perum Griya Asri B-12'],
    ['Mas Dedi (Kos-kosan)', '0877-7777-8888', 'Jl. Mawar No. 21'],
  ];
  for (const c of customers) await run('INSERT INTO customers(name, phone, address) VALUES (?,?,?)', ...c);

  const START = addDays(today(), -45);
  const employees = [
    ['Andi Saputra', 'Kasir', '0812-4000-1001', 2100000, addDays(START, -400)],
    ['Budi Santoso', 'Staf Gudang', '0812-4000-1002', 2100000, addDays(START, -300)],
    ['Citra Lestari', 'Admin Keuangan', '0812-4000-1003', 2400000, addDays(START, -200)],
  ];
  for (const e of employees) await run('INSERT INTO employees(name, position, phone, base_salary, join_date) VALUES (?,?,?,?,?)', ...e);

  // ---------- Riwayat transaksi ----------
  await finance.recordCapital({ date: START, amount: 35000000, description: 'Modal awal usaha' }, OWNER);

  const expiryFor = (sku, date) => (meta[sku].shelf ? addDays(date, meta[sku].shelf) : null);
  const receiveAll = async (ids, date, payRatio) => {
    for (const id of ids) {
      const po = await purchasing.getPO(id);
      const expiries = Object.fromEntries(po.items.map((it) => [it.id, expiryFor(it.sku, date)]));
      // bayar sesuai kemampuan kas (sisakan Rp 2 juta), sisanya menjadi hutang
      const affordable = Math.max(await finance.balance(ACC.KAS) - 2000000, 0);
      const want = Math.round(po.total * payRatio);
      const payAmount = want <= affordable ? want : Math.floor(affordable / 1000) * 1000;
      await purchasing.receivePO(id, { date, expiries, payAmount }, OWNER);
    }
  };

  // Stok awal: semua barang dibeli pada hari pertama
  const bySupplier = {};
  for (const p of prodRows) {
    const qty = p.sku === 'SMB-340' ? 12 : p.sku === 'BSK-KLG' ? 15 : p.sku === 'SRP-460' ? 20 : p.min_stock * 2;
    (bySupplier[p.supplier_id] ||= []).push({ productId: p.id, qty, unitCost: p.buy_price });
  }
  const initialPOs = [];
  for (const [sid, items] of Object.entries(bySupplier)) {
    initialPOs.push(await purchasing.createPO({ supplierId: Number(sid), orderDate: START, items, note: 'Stok awal' }, OWNER));
  }
  await receiveAll(initialPOs, START, 0.6);

  const sellable = prodRows.filter((p) => meta[p.sku].weight > 0);
  const weighted = sellable.flatMap((p) => Array(meta[p.sku].weight).fill(p));

  for (let day = 1; day <= 45; day++) {
    const date = addDays(START, day);
    const dow = new Date(date + 'T00:00:00').getDay();

    // Restok berkala setiap 2 hari berdasarkan PO otomatis
    if (day % 2 === 0) {
      try {
        const ids = await purchasing.generateReorder(date, OWNER);
        await receiveAll(ids, date, rand() < 0.5 ? 1 : 0.5);
      } catch (e) { if (!e.expose) throw e; }
    }

    // Penjualan harian
    const trx = between(dow === 0 || dow === 6 ? 40 : 30, dow === 0 || dow === 6 ? 50 : 38);
    for (let t = 0; t < trx; t++) {
      const items = [];
      for (let k = between(1, 4); k > 0; k--) items.push({ productId: pick(weighted).id, qty: between(1, 3) });
      try {
        await sales.createSale({ date, items, customerId: rand() < 0.15 ? pick([1, 2, 3, 4]) : null }, pick([OWNER, 2]));
      } catch (e) { if (!e.expose) throw e; }
    }

    // Pelunasan hutang supplier yang jatuh tempo
    for (const po of await all("SELECT id, total-paid AS rem FROM purchases WHERE status='diterima' AND total>paid AND due_date <= ?", addDays(date, 2))) {
      try { await purchasing.payPO(po.id, { amount: po.rem, date, note: 'Pelunasan jatuh tempo' }, OWNER); } catch (e) { if (!e.expose) throw e; }
    }

    // Pengeluaran operasional
    const exp = async (account, amount, description) => {
      try { await finance.recordExpense({ date, account, amount, description }, OWNER); } catch (e) { if (!e.expose) throw e; }
    };
    if (day % 7 === 3) await exp(ACC.PERLENGKAPAN, between(8, 15) * 10000, 'Kantong plastik & kertas nota');
    if (day % 5 === 2) await exp(ACC.TRANSPORT, between(5, 10) * 10000, 'Bensin motor ambil barang');
    if (day % 9 === 4) await exp(ACC.PRIVE, between(3, 8) * 100000, 'Diambil pemilik untuk keperluan rumah');
    if (date.endsWith('-05')) await exp(ACC.LISTRIK, 650000, 'Token listrik & tagihan air');
    if (date.endsWith('-01')) await exp(ACC.SEWA, 1500000, 'Sewa kios bulanan');
    // Gaji dibayar di hari terakhir bulan berjalan, untuk periode bulan itu sendiri
    if (addDays(date, 1).endsWith('-01')) {
      try { await hr.payPayroll(date.slice(0, 7), date, OWNER); } catch (e) { if (!e.expose) throw e; }
    }
  }

  // Satu batch saus sambal lama sengaja dibiarkan kedaluwarsa untuk demo penghapusan stok
  const smb = prodRows.find((p) => p.sku === 'SMB-340');
  await run('UPDATE batches SET expiry_date=? WHERE product_id=? AND qty_remaining>0', addDays(today(), -3), smb.id);
}

module.exports = { seed };
