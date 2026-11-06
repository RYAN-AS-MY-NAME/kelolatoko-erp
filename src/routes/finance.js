const router = require('express').Router();
const { all } = require('../db');
const { allow } = require('../auth');
const { today, isDate, monthRange, daysBetween } = require('../util');
const finance = require('../services/finance');
const { ACC } = finance;

const range = (q, defFrom) => [isDate(q.from) ? q.from : defFrom, isDate(q.to) ? q.to : today()];

router.use(allow('keuangan'));

router.get('/expenses', async (req, res) => {
  const [from, to] = range(req.query, monthRange(today().slice(0, 7))[0]);
  const rows = await all(
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
    cash: await finance.balance(ACC.KAS),
    accounts: await all(`SELECT * FROM accounts WHERE code IN (${finance.EXPENSE_ACCOUNTS.map(() => '?').join(',')}) ORDER BY code`, ...finance.EXPENSE_ACCOUNTS),
  });
});

router.post('/expenses', async (req, res) => {
  await finance.recordExpense({ date: req.body.date, account: req.body.account, amount: req.body.amount, description: req.body.description }, req.session.user.id);
  req.flash('success', 'Pengeluaran tercatat. Saldo kas dan laporan laba rugi sudah diperbarui.');
  res.redirect('/finance/expenses');
});

router.post('/capital', allow(), async (req, res) => {
  await finance.recordCapital({ date: req.body.date, amount: req.body.amount, description: req.body.description }, req.session.user.id);
  req.flash('success', 'Setoran modal tercatat.');
  res.redirect('/finance/expenses');
});

router.get('/payables', async (req, res) => {
  const rows = (await all(
    `SELECT p.*, s.name AS supplier_name FROM purchases p JOIN suppliers s ON s.id=p.supplier_id
      WHERE p.status='diterima' AND p.total > p.paid ORDER BY p.due_date`
  )).map((p) => ({ ...p, remaining: p.total - p.paid, overdue: daysBetween(p.due_date, today()) }));
  res.render('finance/payables', { title: 'Hutang ke Supplier', rows, total: rows.reduce((s, r) => s + r.remaining, 0), cash: await finance.balance(ACC.KAS) });
});

module.exports = router;
