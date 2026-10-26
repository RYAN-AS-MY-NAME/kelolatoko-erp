// Modul Keuangan: jurnal otomatis (double-entry), saldo akun, laporan keuangan.
// Modul lain TIDAK menulis angka keuangan sendiri; semuanya lewat postJournal()
// sehingga laporan selalu sinkron dengan transaksi operasional.
const { all, get, run, tx, logActivity } = require('../db');
const { AppError, rp, toInt, requireDate, addDays } = require('../util');

const ACC = {
  KAS: '1101',
  PIUTANG: '1201',
  PERSEDIAAN: '1301',
  HUTANG: '2101',
  MODAL: '3101',
  PRIVE: '3102',
  PENJUALAN: '4101',
  PENDAPATAN_LAIN: '4102',
  HPP: '5101',
  GAJI: '6101',
  LISTRIK: '6102',
  SEWA: '6103',
  TRANSPORT: '6104',
  KERUGIAN_STOK: '6105',
  PERLENGKAPAN: '6106',
  LAIN: '6199',
};

const ACCOUNTS = [
  [ACC.KAS, 'Kas', 'aset', 'D'],
  [ACC.PIUTANG, 'Piutang Usaha (Bon Pelanggan)', 'aset', 'D'],
  [ACC.PERSEDIAAN, 'Persediaan Barang Dagang', 'aset', 'D'],
  [ACC.HUTANG, 'Hutang Usaha (ke Supplier)', 'kewajiban', 'K'],
  [ACC.MODAL, 'Modal Pemilik', 'modal', 'K'],
  [ACC.PRIVE, 'Prive (Pengambilan Pribadi Pemilik)', 'modal', 'D'],
  [ACC.PENJUALAN, 'Penjualan', 'pendapatan', 'K'],
  [ACC.PENDAPATAN_LAIN, 'Pendapatan Lain-lain (Selisih Lebih Stok)', 'pendapatan', 'K'],
  [ACC.HPP, 'Harga Pokok Penjualan (HPP)', 'hpp', 'D'],
  [ACC.GAJI, 'Beban Gaji Karyawan', 'beban', 'D'],
  [ACC.LISTRIK, 'Beban Listrik, Air & Internet', 'beban', 'D'],
  [ACC.SEWA, 'Beban Sewa Tempat', 'beban', 'D'],
  [ACC.TRANSPORT, 'Beban Transportasi & Bensin', 'beban', 'D'],
  [ACC.KERUGIAN_STOK, 'Beban Kerugian Stok (Rusak/Kedaluwarsa/Hilang)', 'beban', 'D'],
  [ACC.PERLENGKAPAN, 'Beban Perlengkapan (Plastik, Nota, dll)', 'beban', 'D'],
  [ACC.LAIN, 'Beban Lain-lain', 'beban', 'D'],
];

// Akun yang boleh dipilih di form "Catat Pengeluaran"
const EXPENSE_ACCOUNTS = [ACC.LISTRIK, ACC.SEWA, ACC.TRANSPORT, ACC.PERLENGKAPAN, ACC.LAIN, ACC.PRIVE];

// Label sumber kas untuk laporan arus kas
const CASH_SOURCES = {
  capital: 'Setoran modal pemilik',
  sale: 'Penjualan tunai',
  sale_void: 'Pembatalan penjualan',
  customer_payment: 'Pelunasan bon pelanggan',
  purchase_payment: 'Pembayaran ke supplier',
  expense: 'Beban operasional',
  prive: 'Prive (diambil pemilik)',
  payroll: 'Gaji karyawan',
};

function seedAccounts() {
  for (const a of ACCOUNTS) run('INSERT OR IGNORE INTO accounts(code,name,type,normal) VALUES (?,?,?,?)', ...a);
}

function postJournal({ date, description, refType = null, refId = null, lines }) {
  const ls = lines.filter((l) => (l.debit || 0) > 0 || (l.credit || 0) > 0);
  const d = ls.reduce((s, l) => s + (l.debit || 0), 0);
  const c = ls.reduce((s, l) => s + (l.credit || 0), 0);
  if (!ls.length || d !== c) throw new Error(`Jurnal tidak seimbang (D ${d} / K ${c}): ${description}`);
  return tx(() => {
    const j = run('INSERT INTO journals(date, description, ref_type, ref_id) VALUES (?,?,?,?)', date, description, refType, refId);
    for (const l of ls) {
      run('INSERT INTO journal_lines(journal_id, account_code, debit, credit) VALUES (?,?,?,?)', j.id, l.account, l.debit || 0, l.credit || 0);
    }
    return j.id;
  });
}

// Saldo semua akun pada rentang tanggal (from/to boleh null)
function accountBalances({ from = null, to = null } = {}) {
  return all(
    `SELECT a.code, a.name, a.type, a.normal,
            COALESCE(SUM(x.debit),0) AS d, COALESCE(SUM(x.credit),0) AS c
       FROM accounts a
       LEFT JOIN (SELECT l.account_code, l.debit, l.credit FROM journal_lines l
                    JOIN journals j ON j.id = l.journal_id
                   WHERE (? IS NULL OR j.date >= ?) AND (? IS NULL OR j.date <= ?)) x
              ON x.account_code = a.code
      GROUP BY a.code ORDER BY a.code`,
    from, from, to, to
  ).map((a) => ({ ...a, balance: a.normal === 'D' ? a.d - a.c : a.c - a.d }));
}

function balance(code, opts = {}) {
  return accountBalances(opts).find((a) => a.code === code)?.balance ?? 0;
}

function ensureCash(amount) {
  const kas = balance(ACC.KAS);
  if (kas < amount) throw new AppError(`Saldo kas tidak cukup. Saldo saat ini ${rp(kas)}, dibutuhkan ${rp(amount)}.`);
}

function profitLoss(from, to) {
  const bal = accountBalances({ from, to });
  const revenue = bal.filter((a) => a.type === 'pendapatan');
  const hpp = bal.filter((a) => a.type === 'hpp');
  const expenses = bal.filter((a) => a.type === 'beban');
  const sum = (xs) => xs.reduce((s, a) => s + a.balance, 0);
  const totalRevenue = sum(revenue);
  const totalHpp = sum(hpp);
  const grossProfit = totalRevenue - totalHpp;
  const totalExpense = sum(expenses);
  return { from, to, revenue, hpp, expenses, totalRevenue, totalHpp, grossProfit, totalExpense, netProfit: grossProfit - totalExpense };
}

function balanceSheet(asOf) {
  const bal = accountBalances({ to: asOf });
  const assets = bal.filter((a) => a.type === 'aset');
  const liabilities = bal.filter((a) => a.type === 'kewajiban');
  // Akun modal ditampilkan bertanda: prive mengurangi modal
  const equity = bal.filter((a) => a.type === 'modal').map((a) => ({ ...a, balance: a.c - a.d }));
  const currentProfit = profitLoss(null, asOf).netProfit;
  const sum = (xs) => xs.reduce((s, a) => s + a.balance, 0);
  const totalAssets = sum(assets);
  const totalLiabilities = sum(liabilities);
  const totalEquity = sum(equity) + currentProfit;
  return { asOf, assets, liabilities, equity, currentProfit, totalAssets, totalLiabilities, totalEquity, balanced: totalAssets === totalLiabilities + totalEquity };
}

function cashFlow(from, to) {
  const opening = balance(ACC.KAS, { to: addDays(from, -1) });
  const rows = all(
    `SELECT j.ref_type, COALESCE(SUM(l.debit),0) AS inflow, COALESCE(SUM(l.credit),0) AS outflow
       FROM journal_lines l JOIN journals j ON j.id = l.journal_id
      WHERE l.account_code = ? AND j.date BETWEEN ? AND ?
      GROUP BY j.ref_type`,
    ACC.KAS, from, to
  ).map((r) => ({ ...r, label: CASH_SOURCES[r.ref_type] || r.ref_type || 'Lainnya', net: r.inflow - r.outflow }));
  const totalIn = rows.reduce((s, r) => s + r.inflow, 0);
  const totalOut = rows.reduce((s, r) => s + r.outflow, 0);
  return { from, to, opening, rows, totalIn, totalOut, closing: opening + totalIn - totalOut };
}

function recordExpense({ date, account, amount, description }, userId) {
  requireDate(date);
  if (!EXPENSE_ACCOUNTS.includes(account)) throw new AppError('Kategori pengeluaran tidak valid.');
  amount = toInt(amount, 'Jumlah', { min: 1 });
  description = String(description || '').trim();
  if (!description) throw new AppError('Keterangan pengeluaran wajib diisi.');
  return tx(() => {
    ensureCash(amount);
    const e = run('INSERT INTO expenses(date, account_code, amount, description, user_id) VALUES (?,?,?,?,?)', date, account, amount, description, userId);
    const isPrive = account === ACC.PRIVE;
    postJournal({
      date,
      description: (isPrive ? 'Prive: ' : 'Beban: ') + description,
      refType: isPrive ? 'prive' : 'expense',
      refId: e.id,
      lines: [{ account, debit: amount }, { account: ACC.KAS, credit: amount }],
    });
    logActivity(userId, 'Catat pengeluaran', `${description} ${rp(amount)}`);
    return e.id;
  });
}

function recordCapital({ date, amount, description }, userId) {
  requireDate(date);
  amount = toInt(amount, 'Jumlah modal', { min: 1 });
  const id = postJournal({
    date,
    description: 'Setoran modal: ' + (String(description || '').trim() || 'modal pemilik'),
    refType: 'capital',
    lines: [{ account: ACC.KAS, debit: amount }, { account: ACC.MODAL, credit: amount }],
  });
  logActivity(userId, 'Setor modal', rp(amount));
  return id;
}

function journalEntries({ from, to }) {
  const journals = all('SELECT * FROM journals WHERE date BETWEEN ? AND ? ORDER BY date DESC, id DESC LIMIT 300', from, to);
  if (!journals.length) return [];
  const lines = all(
    `SELECT l.*, a.name AS account_name FROM journal_lines l JOIN accounts a ON a.code = l.account_code
      WHERE l.journal_id IN (${journals.map(() => '?').join(',')}) ORDER BY l.debit DESC, l.id`,
    ...journals.map((j) => j.id)
  );
  return journals.map((j) => ({ ...j, lines: lines.filter((l) => l.journal_id === j.id) }));
}

module.exports = {
  ACC, ACCOUNTS, EXPENSE_ACCOUNTS, CASH_SOURCES, seedAccounts, postJournal, accountBalances, balance, ensureCash,
  profitLoss, balanceSheet, cashFlow, recordExpense, recordCapital, journalEntries,
};
