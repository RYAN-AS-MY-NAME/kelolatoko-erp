// Modul Keuangan: jurnal otomatis (double-entry), saldo akun, laporan keuangan.
// Modul lain TIDAK menulis angka keuangan sendiri; semuanya lewat postJournal()
// sehingga laporan selalu sinkron dengan transaksi operasional.
const { all, get, run, tx, logActivity } = require('../db');
const { AppError, rp, toInt, requireDate, addDays } = require('../util');

const ACC = {
  KAS: '1101',
  PERSEDIAAN: '1301',
  HUTANG: '2101',
  MODAL: '3101',
  PRIVE: '3102',
  PENJUALAN: '4101',
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
  [ACC.PERSEDIAAN, 'Persediaan Barang Dagang', 'aset', 'D'],
  [ACC.HUTANG, 'Hutang Usaha (ke Supplier)', 'kewajiban', 'K'],
  [ACC.MODAL, 'Modal Pemilik', 'modal', 'K'],
  [ACC.PRIVE, 'Prive (Pengambilan Pribadi Pemilik)', 'modal', 'D'],
  [ACC.PENJUALAN, 'Penjualan', 'pendapatan', 'K'],
  [ACC.HPP, 'Harga Pokok Penjualan (HPP)', 'hpp', 'D'],
  [ACC.GAJI, 'Beban Gaji Karyawan', 'beban', 'D'],
  [ACC.LISTRIK, 'Beban Listrik, Air & Internet', 'beban', 'D'],
  [ACC.SEWA, 'Beban Sewa Tempat', 'beban', 'D'],
  [ACC.TRANSPORT, 'Beban Transportasi & Bensin', 'beban', 'D'],
  [ACC.KERUGIAN_STOK, 'Beban Kerugian Stok (Rusak/Kedaluwarsa)', 'beban', 'D'],
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
  purchase_payment: 'Pembayaran ke supplier',
  expense: 'Beban operasional',
  prive: 'Prive (diambil pemilik)',
  payroll: 'Gaji karyawan',
};

async function seedAccounts() {
  for (const a of ACCOUNTS) await run('INSERT INTO accounts(code,name,type,normal) VALUES (?,?,?,?) ON CONFLICT (code) DO NOTHING RETURNING code', ...a);
}

async function postJournal({ date, description, refType = null, refId = null, lines }) {
  const ls = lines.filter((l) => (l.debit || 0) > 0 || (l.credit || 0) > 0);
  const d = ls.reduce((s, l) => s + (l.debit || 0), 0);
  const c = ls.reduce((s, l) => s + (l.credit || 0), 0);
  if (!ls.length || d !== c) throw new Error(`Jurnal tidak seimbang (D ${d} / K ${c}): ${description}`);
  return tx(async () => {
    const j = await run('INSERT INTO journals(date, description, ref_type, ref_id) VALUES (?,?,?,?)', date, description, refType, refId);
    for (const l of ls) {
      await run('INSERT INTO journal_lines(journal_id, account_code, debit, credit) VALUES (?,?,?,?)', j.id, l.account, l.debit || 0, l.credit || 0);
    }
    return j.id;
  });
}

// Saldo semua akun pada rentang tanggal (from/to boleh null)
async function accountBalances({ from = null, to = null } = {}) {
  return (await all(
    `SELECT a.code, a.name, a.type, a.normal,
            COALESCE(SUM(x.debit),0) AS d, COALESCE(SUM(x.credit),0) AS c
       FROM accounts a
       LEFT JOIN (SELECT l.account_code, l.debit, l.credit FROM journal_lines l
                    JOIN journals j ON j.id = l.journal_id
                   WHERE (?::text IS NULL OR j.date >= ?) AND (?::text IS NULL OR j.date <= ?)) x
              ON x.account_code = a.code
      GROUP BY a.code ORDER BY a.code`,
    from, from, to, to
  )).map((a) => ({ ...a, balance: a.normal === 'D' ? a.d - a.c : a.c - a.d }));
}

async function balance(code, opts = {}) {
  return (await accountBalances(opts)).find((a) => a.code === code)?.balance ?? 0;
}

async function ensureCash(amount) {
  const kas = await balance(ACC.KAS);
  if (kas < amount) throw new AppError(`Saldo kas tidak cukup. Saldo saat ini ${rp(kas)}, dibutuhkan ${rp(amount)}.`);
}

async function profitLoss(from, to) {
  const bal = await accountBalances({ from, to });
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

async function balanceSheet(asOf) {
  const bal = await accountBalances({ to: asOf });
  const assets = bal.filter((a) => a.type === 'aset');
  const liabilities = bal.filter((a) => a.type === 'kewajiban');
  // Akun modal ditampilkan bertanda: prive mengurangi modal
  const equity = bal.filter((a) => a.type === 'modal').map((a) => ({ ...a, balance: a.c - a.d }));
  const currentProfit = (await profitLoss(null, asOf)).netProfit;
  const sum = (xs) => xs.reduce((s, a) => s + a.balance, 0);
  const totalAssets = sum(assets);
  const totalLiabilities = sum(liabilities);
  const totalEquity = sum(equity) + currentProfit;
  return { asOf, assets, liabilities, equity, currentProfit, totalAssets, totalLiabilities, totalEquity, balanced: totalAssets === totalLiabilities + totalEquity };
}

async function cashFlow(from, to) {
  const opening = await balance(ACC.KAS, { to: addDays(from, -1) });
  const rows = (await all(
    `SELECT j.ref_type, COALESCE(SUM(l.debit),0) AS inflow, COALESCE(SUM(l.credit),0) AS outflow
       FROM journal_lines l JOIN journals j ON j.id = l.journal_id
      WHERE l.account_code = ? AND j.date BETWEEN ? AND ?
      GROUP BY j.ref_type`,
    ACC.KAS, from, to
  )).map((r) => ({ ...r, label: CASH_SOURCES[r.ref_type] || r.ref_type || 'Lainnya', net: r.inflow - r.outflow }));
  const totalIn = rows.reduce((s, r) => s + r.inflow, 0);
  const totalOut = rows.reduce((s, r) => s + r.outflow, 0);
  return { from, to, opening, rows, totalIn, totalOut, closing: opening + totalIn - totalOut };
}

async function recordExpense({ date, account, amount, description }, userId) {
  requireDate(date);
  if (!EXPENSE_ACCOUNTS.includes(account)) throw new AppError('Kategori pengeluaran tidak valid.');
  amount = toInt(amount, 'Jumlah', { min: 1 });
  description = String(description || '').trim();
  if (!description) throw new AppError('Keterangan pengeluaran wajib diisi.');
  return tx(async () => {
    await ensureCash(amount);
    const e = await run('INSERT INTO expenses(date, account_code, amount, description, user_id) VALUES (?,?,?,?,?)', date, account, amount, description, userId);
    const isPrive = account === ACC.PRIVE;
    await postJournal({
      date,
      description: (isPrive ? 'Prive: ' : 'Beban: ') + description,
      refType: isPrive ? 'prive' : 'expense',
      refId: e.id,
      lines: [{ account, debit: amount }, { account: ACC.KAS, credit: amount }],
    });
    await logActivity(userId, 'Catat pengeluaran', `${description} ${rp(amount)}`);
    return e.id;
  });
}

async function recordCapital({ date, amount, description }, userId) {
  requireDate(date);
  amount = toInt(amount, 'Jumlah modal', { min: 1 });
  const id = await postJournal({
    date,
    description: 'Setoran modal: ' + (String(description || '').trim() || 'modal pemilik'),
    refType: 'capital',
    lines: [{ account: ACC.KAS, debit: amount }, { account: ACC.MODAL, credit: amount }],
  });
  await logActivity(userId, 'Setor modal', rp(amount));
  return id;
}

module.exports = {
  ACC, ACCOUNTS, EXPENSE_ACCOUNTS, CASH_SOURCES, seedAccounts, postJournal, accountBalances, balance, ensureCash,
  profitLoss, balanceSheet, cashFlow, recordExpense, recordCapital,
};
