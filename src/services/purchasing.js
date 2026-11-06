// Modul Pembelian (Procure-to-Pay): PO -> penerimaan barang -> hutang -> pembayaran.
const { all, get, run, tx, nextCode, logActivity } = require('../db');
const { AppError, toInt, requireDate, addDays, isDate, rp } = require('../util');
const finance = require('./finance');
const inventory = require('./inventory');
const { ACC } = finance;

const STATUS_LABEL = {
  dipesan: ['Dipesan', 'info'],
  diterima: ['Diterima', 'success'],
  batal: ['Batal', 'danger'],
};

async function createPO({ supplierId, orderDate, dueDate = null, items, note = null }, userId) {
  requireDate(orderDate, 'Tanggal pesan');
  if (dueDate && !isDate(dueDate)) throw new AppError('Tanggal jatuh tempo tidak valid.');
  const supplier = await get('SELECT * FROM suppliers WHERE id=?', supplierId);
  if (!supplier) throw new AppError('Supplier wajib dipilih.');
  const clean = (items || []).filter((i) => i && String(i.productId || '').trim() !== '');
  if (!clean.length) throw new AppError('Minimal satu barang harus diisi.');
  return tx(async () => {
    const lines = [];
    for (const [idx, i] of clean.entries()) {
      const p = await get('SELECT * FROM products WHERE id=?', i.productId);
      if (!p) throw new AppError(`Barang pada baris ${idx + 1} tidak ditemukan.`);
      const qty = toInt(i.qty, `Jumlah ${p.name}`, { min: 1 });
      const unitCost = toInt(i.unitCost, `Harga beli ${p.name}`, { min: 0 });
      if (i.expiryDate && !isDate(i.expiryDate)) throw new AppError(`Tanggal kedaluwarsa ${p.name} tidak valid.`);
      if (i.expiryDate && i.expiryDate <= orderDate) throw new AppError(`Tanggal kedaluwarsa ${p.name} harus setelah tanggal pesan.`);
      lines.push({ p, qty, unitCost, expiryDate: i.expiryDate || null });
    }
    const total = lines.reduce((s, l) => s + l.qty * l.unitCost, 0);
    const code = await nextCode('PO', 'purchases', orderDate);
    const po = await run(
      'INSERT INTO purchases(code, supplier_id, order_date, due_date, status, total, note, user_id) VALUES (?,?,?,?,?,?,?,?)',
      code, supplier.id, orderDate, dueDate, 'dipesan', total, note, userId
    );
    for (const l of lines) {
      await run('INSERT INTO purchase_items(purchase_id, product_id, qty, unit_cost, expiry_date) VALUES (?,?,?,?,?)', po.id, l.p.id, l.qty, l.unitCost, l.expiryDate);
    }
    await logActivity(userId, 'Buat PO', `${code} ke ${supplier.name} ${rp(total)}`);
    return po.id;
  });
}

async function getPO(id) {
  const po = await get(
    `SELECT p.*, s.name AS supplier_name, s.phone AS supplier_phone, u.name AS user_name
       FROM purchases p JOIN suppliers s ON s.id=p.supplier_id LEFT JOIN users u ON u.id=p.user_id WHERE p.id=?`,
    id
  );
  if (!po) throw new AppError('Purchase order tidak ditemukan.', 404);
  po.items = await all(
    `SELECT i.*, pr.name, pr.sku, pr.unit FROM purchase_items i JOIN products pr ON pr.id=i.product_id WHERE i.purchase_id=? ORDER BY i.id`,
    id
  );
  po.payments = await all(`SELECT pay.*, u.name AS user_name FROM payments pay LEFT JOIN users u ON u.id=pay.user_id
                      WHERE pay.ref_type='purchase' AND pay.ref_id=? ORDER BY pay.date, pay.id`, id);
  return po;
}

async function cancelPO(id, userId) {
  return tx(async () => {
    const po = await getPO(id);
    if (po.status !== 'dipesan') throw new AppError('Hanya PO yang belum diterima yang bisa dibatalkan.');
    await run("UPDATE purchases SET status='batal' WHERE id=?", id);
    await logActivity(userId, 'Batalkan PO', po.code);
  });
}

// Penerimaan barang: stok bertambah (batch baru), harga beli produk diperbarui,
// dan hutang ke supplier tercatat otomatis di jurnal.
async function receivePO(id, { date, expiries = {}, payAmount = 0 }, userId) {
  requireDate(date, 'Tanggal terima');
  return tx(async () => {
    const po = await getPO(id);
    if (po.status !== 'dipesan') throw new AppError(`PO berstatus "${po.status}" tidak bisa diterima.`);
    if (date < po.order_date) throw new AppError('Tanggal terima tidak boleh sebelum tanggal pesan.');
    for (const it of po.items) {
      const exp = expiries[it.id] !== undefined ? expiries[it.id] || null : it.expiry_date;
      if (exp && !isDate(exp)) throw new AppError(`Tanggal kedaluwarsa ${it.name} tidak valid.`);
      if (exp && exp <= date) throw new AppError(`Barang ${it.name} sudah/akan kedaluwarsa saat diterima. Tolak barang ini ke supplier.`);
      if (exp !== it.expiry_date) await run('UPDATE purchase_items SET expiry_date=? WHERE id=?', exp, it.id);
      await inventory.addBatch({
        productId: it.product_id, qty: it.qty, unitCost: it.unit_cost, expiryDate: exp, date,
        purchaseId: po.id, refType: 'purchase', refId: po.id, note: po.code, userId,
      });
      await run('UPDATE products SET buy_price=? WHERE id=?', it.unit_cost, it.product_id);
    }
    const dueDate = po.due_date || addDays(date, 14);
    await run("UPDATE purchases SET status='diterima', received_date=?, due_date=? WHERE id=?", date, dueDate, po.id);
    await finance.postJournal({
      date, description: `Penerimaan barang ${po.code} dari ${po.supplier_name}`, refType: 'purchase', refId: po.id,
      lines: [{ account: ACC.PERSEDIAAN, debit: po.total }, { account: ACC.HUTANG, credit: po.total }],
    });
    await logActivity(userId, 'Terima barang', `${po.code} (${po.items.length} item)`);
    const pay = Number(payAmount) || 0;
    if (pay > 0) await payPO(po.id, { amount: pay, date, note: 'Dibayar saat barang diterima' }, userId);
  });
}

async function payPO(id, { amount, date, note = null }, userId) {
  requireDate(date, 'Tanggal bayar');
  amount = toInt(amount, 'Jumlah bayar', { min: 1 });
  return tx(async () => {
    const po = await getPO(id);
    if (po.status !== 'diterima') throw new AppError('Hanya PO yang barangnya sudah diterima yang bisa dibayar.');
    const remaining = po.total - po.paid;
    if (remaining <= 0) throw new AppError('Hutang PO ini sudah lunas.');
    if (amount > remaining) throw new AppError(`Jumlah bayar melebihi sisa hutang (${rp(remaining)}).`);
    await finance.ensureCash(amount);
    const pay = await run(
      "INSERT INTO payments(date, ref_type, ref_id, amount, note, user_id) VALUES (?, 'purchase', ?, ?, ?, ?)",
      date, po.id, amount, note, userId
    );
    await run('UPDATE purchases SET paid = paid + ? WHERE id=?', amount, po.id);
    await finance.postJournal({
      date, description: `Bayar hutang ${po.code} ke ${po.supplier_name}`, refType: 'purchase_payment', refId: pay.id,
      lines: [{ account: ACC.HUTANG, debit: amount }, { account: ACC.KAS, credit: amount }],
    });
    await logActivity(userId, 'Bayar hutang supplier', `${po.code} ${rp(amount)}`);
  });
}

// PO otomatis: barang yang stoknya di bawah minimum dikelompokkan per supplier
// menjadi PO, jumlahnya dihitung dari rata-rata penjualan (±2 minggu).
async function generateReorder(date, userId) {
  const low = (await inventory.productOverview(date)).filter((p) => p.suggestQty > 0 && p.supplier_id);
  if (!low.length) throw new AppError('Tidak ada barang yang perlu dipesan ulang. Semua stok di atas batas minimum.');
  const pending = new Set(
    (await all("SELECT DISTINCT i.product_id FROM purchase_items i JOIN purchases p ON p.id=i.purchase_id WHERE p.status = 'dipesan'"))
      .map((r) => r.product_id)
  );
  const bySupplier = new Map();
  for (const p of low.filter((x) => !pending.has(x.id))) {
    if (!bySupplier.has(p.supplier_id)) bySupplier.set(p.supplier_id, []);
    bySupplier.get(p.supplier_id).push({ productId: p.id, qty: p.suggestQty, unitCost: p.buy_price });
  }
  if (!bySupplier.size) throw new AppError('Semua barang yang menipis sudah ada di PO yang belum diterima.');
  return tx(async () => {
    const ids = [];
    for (const [supplierId, items] of bySupplier) {
      ids.push(await createPO({ supplierId, orderDate: date, items, note: 'Dibuat otomatis dari stok menipis' }, userId));
    }
    return ids;
  });
}

module.exports = { STATUS_LABEL, createPO, getPO, cancelPO, receivePO, payPO, generateReorder };
