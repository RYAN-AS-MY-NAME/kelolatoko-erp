// Modul Penjualan (Order-to-Cash): kasir -> stok berkurang (FEFO) -> kas bertambah -> jurnal.
const { all, get, run, tx, nextCode, logActivity } = require('../db');
const { AppError, toInt, requireDate, rp } = require('../util');
const finance = require('./finance');
const inventory = require('./inventory');
const { ACC } = finance;
const { MOVE } = inventory;

async function createSale({ date, customerId = null, items, cashReceived = null, note = null }, userId) {
  requireDate(date);
  if (!Array.isArray(items) || !items.length) throw new AppError('Keranjang masih kosong.');

  const merged = new Map();
  for (const it of items) {
    const pid = toInt(it.productId, 'Produk');
    const qty = toInt(it.qty, 'Jumlah barang', { min: 1 });
    merged.set(pid, (merged.get(pid) || 0) + qty);
  }

  return tx(async () => {
    const lines = [];
    let total = 0;
    for (const [pid, qty] of merged) {
      const p = await get('SELECT * FROM products WHERE id=? AND active=1', pid);
      if (!p) throw new AppError('Produk tidak ditemukan atau sudah nonaktif.');
      lines.push({ p, qty, price: p.sell_price }); // harga selalu diambil dari master produk
      total += qty * p.sell_price;
    }
    if (total <= 0) throw new AppError('Total transaksi harus lebih dari 0.');

    let customer = null;
    if (customerId) {
      customer = await get('SELECT * FROM customers WHERE id=?', customerId);
      if (!customer) throw new AppError('Pelanggan tidak ditemukan.');
    }
    const cash = cashReceived === null || cashReceived === '' ? total : toInt(cashReceived, 'Uang diterima', { min: 0 });
    if (cash < total) throw new AppError(`Uang diterima (${rp(cash)}) kurang dari total belanja (${rp(total)}).`);

    const code = await nextCode('PJ', 'sales', date);
    const s = await run(
      `INSERT INTO sales(code, date, customer_id, total, cash_received, status, note, user_id)
       VALUES (?,?,?,?,?, 'selesai', ?, ?)`,
      code, date, customer?.id ?? null, total, cash, note, userId
    );

    let cogs = 0;
    for (const l of lines) {
      const c = await inventory.consume({ productId: l.p.id, qty: l.qty, date, type: MOVE.SALE, refType: 'sale', refId: s.id, userId, note: code, sellableOnly: true });
      cogs += c;
      await run('INSERT INTO sale_items(sale_id, product_id, qty, price, cogs) VALUES (?,?,?,?,?)', s.id, l.p.id, l.qty, l.price, c);
    }
    await run('UPDATE sales SET cogs=? WHERE id=?', cogs, s.id);

    await finance.postJournal({
      date,
      description: `Penjualan ${code}` + (customer ? ` – ${customer.name}` : ''),
      refType: 'sale',
      refId: s.id,
      lines: [
        { account: ACC.KAS, debit: total },
        { account: ACC.PENJUALAN, credit: total },
        { account: ACC.HPP, debit: cogs },
        { account: ACC.PERSEDIAAN, credit: cogs },
      ],
    });
    await logActivity(userId, 'Penjualan', `${code} ${rp(total)}`);
    return s.id;
  });
}

async function getSale(id) {
  const s = await get(
    `SELECT s.*, c.name AS customer_name, c.phone AS customer_phone, u.name AS cashier
       FROM sales s LEFT JOIN customers c ON c.id=s.customer_id LEFT JOIN users u ON u.id=s.user_id WHERE s.id=?`,
    id
  );
  if (!s) throw new AppError('Transaksi tidak ditemukan.', 404);
  s.items = await all('SELECT si.*, p.name, p.sku, p.unit FROM sale_items si JOIN products p ON p.id=si.product_id WHERE si.sale_id=? ORDER BY si.id', id);
  return s;
}

// Pembatalan transaksi: stok dikembalikan ke batch asal, uang dikembalikan, jurnal dibalik.
async function voidSale(id, { reason, date }, userId) {
  requireDate(date);
  reason = String(reason || '').trim();
  if (!reason) throw new AppError('Alasan pembatalan wajib diisi.');
  return tx(async () => {
    const s = await getSale(id);
    if (s.status === 'batal') throw new AppError('Transaksi sudah dibatalkan sebelumnya.');
    await finance.ensureCash(s.total);
    const moves = await all("SELECT * FROM stock_movements WHERE ref_type='sale' AND ref_id=? AND type=?", s.id, MOVE.SALE);
    for (const m of moves) {
      await run('UPDATE batches SET qty_remaining = qty_remaining + ? WHERE id=?', -m.qty, m.batch_id);
      await run(
        'INSERT INTO stock_movements(date, product_id, batch_id, type, qty, unit_cost, ref_type, ref_id, note, user_id) VALUES (?,?,?,?,?,?,?,?,?,?)',
        date, m.product_id, m.batch_id, MOVE.VOID, -m.qty, m.unit_cost, 'sale_void', s.id, `Batal ${s.code}: ${reason}`, userId
      );
    }
    await run("UPDATE sales SET status='batal', note=? WHERE id=?", `Dibatalkan: ${reason}`, s.id);
    await finance.postJournal({
      date, description: `Pembatalan ${s.code}: ${reason}`, refType: 'sale_void', refId: s.id,
      lines: [
        { account: ACC.PENJUALAN, debit: s.total },
        { account: ACC.KAS, credit: s.total },
        { account: ACC.PERSEDIAAN, debit: s.cogs },
        { account: ACC.HPP, credit: s.cogs },
      ],
    });
    await logActivity(userId, 'Batalkan penjualan', `${s.code}: ${reason}`);
  });
}

module.exports = { createSale, getSale, voidSale };
