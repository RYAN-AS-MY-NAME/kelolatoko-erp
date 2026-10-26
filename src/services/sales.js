// Modul Penjualan (Order-to-Cash): kasir -> stok berkurang (FEFO) -> kas/piutang -> jurnal.
const { all, get, run, tx, nextCode, logActivity } = require('../db');
const { AppError, toInt, requireDate, addDays, rp } = require('../util');
const finance = require('./finance');
const inventory = require('./inventory');
const { ACC } = finance;
const { MOVE } = inventory;

function outstandingCredit(customerId) {
  return get(
    "SELECT COALESCE(SUM(total-paid),0) AS o FROM sales WHERE customer_id=? AND status='selesai' AND payment_method='kredit'",
    customerId
  ).o;
}

function createSale({ date, customerId = null, method = 'tunai', items, discount = 0, cashReceived = null, note = null }, userId) {
  requireDate(date);
  if (!['tunai', 'kredit'].includes(method)) throw new AppError('Metode pembayaran tidak valid.');
  if (!Array.isArray(items) || !items.length) throw new AppError('Keranjang masih kosong.');

  const merged = new Map();
  for (const it of items) {
    const pid = toInt(it.productId, 'Produk');
    const qty = toInt(it.qty, 'Jumlah barang', { min: 1 });
    merged.set(pid, (merged.get(pid) || 0) + qty);
  }

  return tx(() => {
    const lines = [];
    let subtotal = 0;
    for (const [pid, qty] of merged) {
      const p = get('SELECT * FROM products WHERE id=? AND active=1', pid);
      if (!p) throw new AppError('Produk tidak ditemukan atau sudah nonaktif.');
      lines.push({ p, qty, price: p.sell_price }); // harga selalu diambil dari master produk
      subtotal += qty * p.sell_price;
    }
    discount = toInt(discount || 0, 'Diskon', { min: 0 });
    if (discount > subtotal) throw new AppError('Diskon tidak boleh melebihi subtotal.');
    const total = subtotal - discount;
    if (total <= 0) throw new AppError('Total transaksi harus lebih dari 0.');

    let customer = null;
    if (customerId) {
      customer = get('SELECT * FROM customers WHERE id=?', customerId);
      if (!customer) throw new AppError('Pelanggan tidak ditemukan.');
    }
    let cash = 0;
    if (method === 'kredit') {
      if (!customer) throw new AppError('Penjualan bon (kredit) wajib memilih pelanggan.');
      if (customer.credit_limit <= 0) throw new AppError(`${customer.name} tidak memiliki limit bon.`);
      const outstanding = outstandingCredit(customer.id);
      if (outstanding + total > customer.credit_limit) {
        throw new AppError(
          `Melebihi limit bon ${customer.name}. Limit ${rp(customer.credit_limit)}, bon berjalan ${rp(outstanding)}, transaksi ini ${rp(total)}.`
        );
      }
    } else {
      cash = cashReceived === null || cashReceived === '' ? total : toInt(cashReceived, 'Uang diterima', { min: 0 });
      if (cash < total) throw new AppError(`Uang diterima (${rp(cash)}) kurang dari total belanja (${rp(total)}).`);
    }

    const code = nextCode('PJ', 'sales', date);
    const s = run(
      `INSERT INTO sales(code, date, customer_id, payment_method, subtotal, discount, total, paid, cash_received, due_date, status, note, user_id)
       VALUES (?,?,?,?,?,?,?,?,?,?, 'selesai', ?, ?)`,
      code, date, customer?.id ?? null, method, subtotal, discount, total,
      method === 'tunai' ? total : 0, cash, method === 'kredit' ? addDays(date, 14) : null, note, userId
    );

    let cogs = 0;
    for (const l of lines) {
      const c = inventory.consume({ productId: l.p.id, qty: l.qty, date, type: MOVE.SALE, refType: 'sale', refId: s.id, userId, note: code, sellableOnly: true });
      cogs += c;
      run('INSERT INTO sale_items(sale_id, product_id, qty, price, cogs) VALUES (?,?,?,?,?)', s.id, l.p.id, l.qty, l.price, c);
    }
    run('UPDATE sales SET cogs=? WHERE id=?', cogs, s.id);

    finance.postJournal({
      date,
      description: `Penjualan ${code}` + (customer ? ` – ${customer.name}` : ''),
      refType: 'sale',
      refId: s.id,
      lines: [
        { account: method === 'tunai' ? ACC.KAS : ACC.PIUTANG, debit: total },
        { account: ACC.PENJUALAN, credit: total },
        { account: ACC.HPP, debit: cogs },
        { account: ACC.PERSEDIAAN, credit: cogs },
      ],
    });
    logActivity(userId, 'Penjualan', `${code} ${rp(total)} (${method})`);
    return s.id;
  });
}

function getSale(id) {
  const s = get(
    `SELECT s.*, c.name AS customer_name, c.phone AS customer_phone, u.name AS cashier
       FROM sales s LEFT JOIN customers c ON c.id=s.customer_id LEFT JOIN users u ON u.id=s.user_id WHERE s.id=?`,
    id
  );
  if (!s) throw new AppError('Transaksi tidak ditemukan.', 404);
  s.items = all('SELECT si.*, p.name, p.sku, p.unit FROM sale_items si JOIN products p ON p.id=si.product_id WHERE si.sale_id=? ORDER BY si.id', id);
  s.payments = all(`SELECT pay.*, u.name AS user_name FROM payments pay LEFT JOIN users u ON u.id=pay.user_id
                     WHERE pay.ref_type='sale' AND pay.ref_id=? ORDER BY pay.date, pay.id`, id);
  return s;
}

function receivePayment(id, { amount, date }, userId) {
  requireDate(date, 'Tanggal bayar');
  amount = toInt(amount, 'Jumlah bayar', { min: 1 });
  return tx(() => {
    const s = getSale(id);
    if (s.status !== 'selesai' || s.payment_method !== 'kredit') throw new AppError('Transaksi ini bukan bon aktif.');
    const remaining = s.total - s.paid;
    if (remaining <= 0) throw new AppError('Bon ini sudah lunas.');
    if (amount > remaining) throw new AppError(`Jumlah bayar melebihi sisa bon (${rp(remaining)}).`);
    const pay = run(
      "INSERT INTO payments(date, direction, ref_type, ref_id, amount, user_id) VALUES (?, 'masuk', 'sale', ?, ?, ?)",
      date, s.id, amount, userId
    );
    run('UPDATE sales SET paid = paid + ? WHERE id=?', amount, s.id);
    finance.postJournal({
      date, description: `Pelunasan bon ${s.code} – ${s.customer_name}`, refType: 'customer_payment', refId: pay.id,
      lines: [{ account: ACC.KAS, debit: amount }, { account: ACC.PIUTANG, credit: amount }],
    });
    logActivity(userId, 'Terima pembayaran bon', `${s.code} ${rp(amount)}`);
  });
}

// Pembatalan transaksi: stok dikembalikan ke batch asal dan jurnal dibalik.
function voidSale(id, { reason, date }, userId) {
  requireDate(date);
  reason = String(reason || '').trim();
  if (!reason) throw new AppError('Alasan pembatalan wajib diisi.');
  return tx(() => {
    const s = getSale(id);
    if (s.status === 'batal') throw new AppError('Transaksi sudah dibatalkan sebelumnya.');
    if (s.payments.length) throw new AppError('Bon ini sudah pernah dibayar sebagian, tidak bisa dibatalkan.');
    if (s.payment_method === 'tunai') finance.ensureCash(s.total);
    const moves = all("SELECT * FROM stock_movements WHERE ref_type='sale' AND ref_id=? AND type=?", s.id, MOVE.SALE);
    for (const m of moves) {
      run('UPDATE batches SET qty_remaining = qty_remaining + ? WHERE id=?', -m.qty, m.batch_id);
      run(
        'INSERT INTO stock_movements(date, product_id, batch_id, type, qty, unit_cost, ref_type, ref_id, note, user_id) VALUES (?,?,?,?,?,?,?,?,?,?)',
        date, m.product_id, m.batch_id, MOVE.VOID, -m.qty, m.unit_cost, 'sale_void', s.id, `Batal ${s.code}: ${reason}`, userId
      );
    }
    run("UPDATE sales SET status='batal', note=? WHERE id=?", `Dibatalkan: ${reason}`, s.id);
    finance.postJournal({
      date, description: `Pembatalan ${s.code}: ${reason}`, refType: 'sale_void', refId: s.id,
      lines: [
        { account: ACC.PENJUALAN, debit: s.total },
        { account: s.payment_method === 'tunai' ? ACC.KAS : ACC.PIUTANG, credit: s.total },
        { account: ACC.PERSEDIAAN, debit: s.cogs },
        { account: ACC.HPP, credit: s.cogs },
      ],
    });
    logActivity(userId, 'Batalkan penjualan', `${s.code}: ${reason}`);
  });
}

module.exports = { createSale, getSale, receivePayment, voidSale, outstandingCredit };
