// Modul Persediaan: stok per batch, FEFO, kedaluwarsa, stok opname, analisis stok mati.
const { all, get, run, tx, logActivity } = require('../db');
const { AppError, toInt, requireDate, addDays, daysBetween, rp } = require('../util');
const finance = require('./finance');
const { ACC } = finance;

const MOVE = {
  IN: 'MASUK_PEMBELIAN',
  SALE: 'KELUAR_PENJUALAN',
  VOID: 'BATAL_PENJUALAN',
  ADJ: 'PENYESUAIAN_OPNAME',
  WRITEOFF: 'RUSAK_KEDALUWARSA',
};

const MOVE_LABEL = {
  [MOVE.IN]: 'Masuk (Pembelian)',
  [MOVE.SALE]: 'Keluar (Penjualan)',
  [MOVE.VOID]: 'Kembali (Batal Jual)',
  [MOVE.ADJ]: 'Penyesuaian Opname',
  [MOVE.WRITEOFF]: 'Rusak / Kedaluwarsa',
};

const DEAD_STOCK_DAYS = 30; // tidak terjual selama 30 hari = stok mati

function addBatch({ productId, qty, unitCost, expiryDate = null, date, purchaseId = null, type = MOVE.IN, refType = null, refId = null, note = null, userId = null }) {
  const b = run(
    'INSERT INTO batches(product_id, purchase_id, qty_in, qty_remaining, unit_cost, expiry_date, received_date) VALUES (?,?,?,?,?,?,?)',
    productId, purchaseId, qty, qty, unitCost, expiryDate || null, date
  );
  run(
    'INSERT INTO stock_movements(date, product_id, batch_id, type, qty, unit_cost, ref_type, ref_id, note, user_id) VALUES (?,?,?,?,?,?,?,?,?,?)',
    date, productId, b.id, type, qty, unitCost, refType, refId, note, userId
  );
  return b.id;
}

const stockOf = (productId) => get('SELECT COALESCE(SUM(qty_remaining),0) AS q FROM batches WHERE product_id=?', productId).q;

// Mengurangi stok dengan metode FEFO (First Expired, First Out).
// sellableOnly = true: batch yang sudah kedaluwarsa tidak boleh dijual.
// Mengembalikan total HPP (nilai modal barang yang keluar).
function consume({ productId, qty, date, type, refType, refId, userId, note = null, sellableOnly = false }) {
  const batches = all(
    `SELECT * FROM batches WHERE product_id=? AND qty_remaining>0
       AND (? = 0 OR expiry_date IS NULL OR expiry_date >= ?)
     ORDER BY expiry_date IS NULL, expiry_date, received_date, id`,
    productId, sellableOnly ? 1 : 0, date
  );
  const available = batches.reduce((s, b) => s + b.qty_remaining, 0);
  if (available < qty) {
    const p = get('SELECT name, unit FROM products WHERE id=?', productId);
    const expired = sellableOnly ? stockOf(productId) - available : 0;
    throw new AppError(
      `Stok "${p.name}" tidak cukup. Tersedia ${available} ${p.unit}` +
      (expired > 0 ? ` (+${expired} ${p.unit} kedaluwarsa, tidak boleh dijual)` : '') +
      `, diminta ${qty} ${p.unit}.`
    );
  }
  let left = qty;
  let cost = 0;
  for (const b of batches) {
    if (left === 0) break;
    const take = Math.min(left, b.qty_remaining);
    run('UPDATE batches SET qty_remaining = qty_remaining - ? WHERE id=?', take, b.id);
    run(
      'INSERT INTO stock_movements(date, product_id, batch_id, type, qty, unit_cost, ref_type, ref_id, note, user_id) VALUES (?,?,?,?,?,?,?,?,?,?)',
      date, productId, b.id, type, -take, b.unit_cost, refType, refId, note, userId
    );
    cost += take * b.unit_cost;
    left -= take;
  }
  return cost;
}

// Penghapusan barang rusak / kedaluwarsa: stok berkurang, kerugian masuk laporan laba rugi.
function writeOff({ batchId, qty, reason, date }, userId) {
  requireDate(date);
  qty = toInt(qty, 'Jumlah', { min: 1 });
  reason = String(reason || '').trim() || 'Kedaluwarsa';
  return tx(() => {
    const b = get('SELECT b.*, p.name, p.unit FROM batches b JOIN products p ON p.id=b.product_id WHERE b.id=?', batchId);
    if (!b) throw new AppError('Batch tidak ditemukan.', 404);
    if (qty > b.qty_remaining) throw new AppError(`Jumlah melebihi sisa batch (${b.qty_remaining} ${b.unit}).`);
    run('UPDATE batches SET qty_remaining = qty_remaining - ? WHERE id=?', qty, b.id);
    run(
      'INSERT INTO stock_movements(date, product_id, batch_id, type, qty, unit_cost, ref_type, ref_id, note, user_id) VALUES (?,?,?,?,?,?,?,?,?,?)',
      date, b.product_id, b.id, MOVE.WRITEOFF, -qty, b.unit_cost, 'writeoff', b.id, reason, userId
    );
    const value = qty * b.unit_cost;
    finance.postJournal({
      date,
      description: `Penghapusan stok ${qty} ${b.unit} ${b.name} (${reason})`,
      refType: 'writeoff',
      refId: b.id,
      lines: [{ account: ACC.KERUGIAN_STOK, debit: value }, { account: ACC.PERSEDIAAN, credit: value }],
    });
    logActivity(userId, 'Hapus stok', `${b.name} ${qty} ${b.unit} – ${rp(value)}`);
    return value;
  });
}

// Stok opname: menyamakan stok sistem dengan hitungan fisik.
function stockOpname({ productId, physicalQty, note, date }, userId) {
  requireDate(date);
  physicalQty = toInt(physicalQty, 'Jumlah fisik', { min: 0 });
  return tx(() => {
    const p = get('SELECT * FROM products WHERE id=?', productId);
    if (!p) throw new AppError('Produk tidak ditemukan.', 404);
    const systemQty = stockOf(p.id);
    const diff = physicalQty - systemQty;
    const o = run(
      'INSERT INTO stock_opnames(date, product_id, system_qty, physical_qty, difference, note, user_id) VALUES (?,?,?,?,?,?,?)',
      date, p.id, systemQty, physicalQty, diff, note || null, userId
    );
    let value = 0;
    if (diff < 0) {
      value = consume({ productId: p.id, qty: -diff, date, type: MOVE.ADJ, refType: 'opname', refId: o.id, userId, note: note || 'Selisih kurang' });
      finance.postJournal({
        date, description: `Opname ${p.name}: selisih kurang ${-diff} ${p.unit}`, refType: 'opname', refId: o.id,
        lines: [{ account: ACC.KERUGIAN_STOK, debit: value }, { account: ACC.PERSEDIAAN, credit: value }],
      });
    } else if (diff > 0) {
      value = diff * p.buy_price;
      addBatch({ productId: p.id, qty: diff, unitCost: p.buy_price, date, type: MOVE.ADJ, refType: 'opname', refId: o.id, note: note || 'Selisih lebih', userId });
      finance.postJournal({
        date, description: `Opname ${p.name}: selisih lebih ${diff} ${p.unit}`, refType: 'opname', refId: o.id,
        lines: [{ account: ACC.PERSEDIAAN, debit: value }, { account: ACC.PENDAPATAN_LAIN, credit: value }],
      });
    }
    run('UPDATE stock_opnames SET value=? WHERE id=?', diff < 0 ? -value : value, o.id);
    logActivity(userId, 'Stok opname', `${p.name}: sistem ${systemQty}, fisik ${physicalQty}`);
    return { diff, value };
  });
}

// Ringkasan semua produk + analisis kesehatan stok.
function productOverview(date) {
  const since = addDays(date, -DEAD_STOCK_DAYS);
  const rows = all(
    `SELECT p.*, c.name AS category, s.name AS supplier,
       COALESCE((SELECT SUM(qty_remaining) FROM batches b WHERE b.product_id=p.id),0) AS stock,
       COALESCE((SELECT SUM(qty_remaining*unit_cost) FROM batches b WHERE b.product_id=p.id),0) AS value,
       COALESCE((SELECT SUM(qty_remaining) FROM batches b WHERE b.product_id=p.id AND b.expiry_date < ?),0) AS expired_qty,
       (SELECT MIN(expiry_date) FROM batches b WHERE b.product_id=p.id AND b.qty_remaining>0 AND b.expiry_date >= ?) AS next_expiry,
       (SELECT MIN(received_date) FROM batches b WHERE b.product_id=p.id AND b.qty_remaining>0) AS oldest_stock,
       (SELECT MAX(sa.date) FROM sale_items si JOIN sales sa ON sa.id=si.sale_id
          WHERE si.product_id=p.id AND sa.status='selesai') AS last_sale,
       COALESCE((SELECT SUM(si.qty) FROM sale_items si JOIN sales sa ON sa.id=si.sale_id
          WHERE si.product_id=p.id AND sa.status='selesai' AND sa.date > ? AND sa.date <= ?),0) AS sold_30,
       COALESCE((SELECT SUM(si.cogs) FROM sale_items si JOIN sales sa ON sa.id=si.sale_id
          WHERE si.product_id=p.id AND sa.status='selesai' AND sa.date > ? AND sa.date <= ?),0) AS cogs_30
     FROM products p
     LEFT JOIN categories c ON c.id=p.category_id
     LEFT JOIN suppliers s ON s.id=p.supplier_id
     WHERE p.active=1
     ORDER BY p.name`,
    date, date, since, date, since, date
  );
  return rows.map((p) => {
    const daily = p.sold_30 / DEAD_STOCK_DAYS;
    const daysLeft = daily > 0 ? Math.floor(p.stock / daily) : null;
    const turnover = p.value > 0 ? p.cogs_30 / p.value : 0;
    const idleDays = p.last_sale ? daysBetween(p.last_sale, date) : p.oldest_stock ? daysBetween(p.oldest_stock, date) : 0;
    let status = 'aman';
    if (p.stock <= 0) status = 'habis';
    else if (p.stock <= p.min_stock) status = 'menipis';
    else if (p.sold_30 === 0 && idleDays >= DEAD_STOCK_DAYS) status = 'mati';
    else if (daysLeft !== null && daysLeft > 60) status = 'lambat';
    let suggestQty = 0;
    if (p.stock <= p.min_stock) {
      const target = Math.max(p.min_stock * 2, Math.ceil(daily * 14)); // cukup ±2 minggu
      suggestQty = Math.max(target - p.stock, 1);
    }
    return { ...p, daily, daysLeft, turnover, idleDays, status, suggestQty };
  });
}

const STATUS_LABEL = {
  habis: ['Habis', 'danger'],
  menipis: ['Menipis', 'warning'],
  mati: ['Stok Mati', 'dark'],
  lambat: ['Lambat Laku', 'info'],
  aman: ['Aman', 'success'],
};

function expiringBatches(date, days = 30) {
  return all(
    `SELECT b.*, p.name, p.unit, p.sku FROM batches b JOIN products p ON p.id=b.product_id
      WHERE b.qty_remaining>0 AND b.expiry_date IS NOT NULL AND b.expiry_date <= ?
      ORDER BY b.expiry_date`,
    addDays(date, days)
  ).map((b) => ({ ...b, daysToExpiry: daysBetween(date, b.expiry_date), value: b.qty_remaining * b.unit_cost }));
}

function stockCard(productId) {
  let saldo = 0;
  return all(
    `SELECT m.*, u.name AS user_name FROM stock_movements m LEFT JOIN users u ON u.id=m.user_id
      WHERE m.product_id=? ORDER BY m.date, m.id`,
    productId
  ).map((m) => ({ ...m, saldo: (saldo += m.qty) }));
}

module.exports = {
  MOVE, MOVE_LABEL, STATUS_LABEL, DEAD_STOCK_DAYS, addBatch, stockOf, consume, writeOff, stockOpname,
  productOverview, expiringBatches, stockCard,
};
