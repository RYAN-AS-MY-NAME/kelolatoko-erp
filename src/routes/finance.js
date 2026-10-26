const router = require('express').Router();
const { all } = require('../db');
const { allow } = require('../auth');
const { today, addDays, isDate, monthRange, daysBetween } = require('../util');
const finance = require('../services/finance');
const { ACC } = finance;

const range = (q, defFrom) => [isDate(q.from) ? q.from : defFrom, isDate(q.to) ? q.to : today()];

router.use(allow('keuangan'));

router.get('/expenses', (req, res) => {
  const [from, to] = range(req.query, monthRange(today().slice(0, 7))[0]);
  const rows = all(
    `SELECT e.*, a.name AS account_name, u.name AS user_name FROM expenses e JOIN accounts a ON a.code=e.account_code
       LEFT JOIN users u ON u.id=e.user_id WHERE e.date BETWEEN ? AND ? ORDER BY e.date DESC, e.id DESC`,
    from, to
  );
  const byAccount = {};
  for (const r of rows) byAccount[r.account_name] = (byAccount[r.account_name] || 0) + r.amount;
  res.render('finance/expenses', {
    title: 'Kas & Pengeluaran', from, to, rows,
    byAccount: Object.entries(byAccount).sort((a, b) => b[1] - a[1]),
    total: rows.reduce((s, r) => s + r.amount, 0),
    cash: finance.balance(ACC.KAS),
    accounts: all(`SELECT * FROM accounts WHERE code IN (${finance.EXPENSE_ACCOUNTS.map(() => '?').join(',')}) ORDER BY code`, ...finance.EXPENSE_ACCOUNTS),
  });
});

router.post('/expenses', (req, res) => {
  finance.recordExpense({ date: req.body.date, account: req.body.account, amount: req.body.amount, description: req.body.description }, req.session.user.id);
  req.flash('success', 'Pengeluaran tercatat. Saldo kas dan laporan laba rugi sudah diperbarui.');
  res.redirect('/finance/expenses');
});

router.post('/capital', allow(), (req, res) => {
  finance.recordCapital({ date: req.body.date, amount: req.body.amount, description: req.body.description }, req.session.user.id);
  req.flash('success', 'Setoran modal tercatat.');
  res.redirect('/finance/expenses');
});

router.get('/payables', (req, res) => {
  const rows = all(
    `SELECT p.*, s.name AS supplier_name FROM purchases p JOIN suppliers s ON s.id=p.supplier_id
      WHERE p.status='diterima' AND p.total > p.paid ORDER BY p.due_date`
  ).map((p) => ({ ...p, remaining: p.total - p.paid, overdue: daysBetween(p.due_date, today()) }));
  res.render('finance/payables', { title: 'Hutang ke Supplier', rows, total: rows.reduce((s, r) => s + r.remaining, 0), cash: finance.balance(ACC.KAS) });
});

router.get('/receivables', (req, res) => {
  const rows = all(
    `SELECT s.*, c.name AS customer_name, c.phone AS customer_phone FROM sales s JOIN customers c ON c.id=s.customer_id
      WHERE s.status='selesai' AND s.payment_method='kredit' AND s.total > s.paid ORDER BY s.due_date`
  ).map((s) => ({ ...s, remaining: s.total - s.paid, overdue: daysBetween(s.due_date, today()) }));
  const byCustomer = {};
  for (const r of rows) {
    const c = (byCustomer[r.customer_name] ||= { name: r.customer_name, phone: r.customer_phone, total: 0, n: 0, overdue: 0 });
    c.total += r.remaining; c.n++; if (r.overdue > 0) c.overdue += r.remaining;
  }
  res.render('finance/receivables', {
    title: 'Piutang Pelanggan (Bon)', rows, byCustomer: Object.values(byCustomer).sort((a, b) => b.total - a.total),
    total: rows.reduce((s, r) => s + r.remaining, 0),
  });
});

router.get('/journal', (req, res) => {
  const [from, to] = range(req.query, addDays(today(), -2));
  res.render('finance/journal', { title: 'Jurnal Umum', from, to, journals: finance.journalEntries({ from, to }) });
});

module.exports = router;
