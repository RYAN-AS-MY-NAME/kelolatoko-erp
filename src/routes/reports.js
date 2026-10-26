const router = require('express').Router();
const { all } = require('../db');
const { allow } = require('../auth');
const { today, isDate, monthRange } = require('../util');
const finance = require('../services/finance');
const inventory = require('../services/inventory');

const range = (q) => [isDate(q.from) ? q.from : monthRange(today().slice(0, 7))[0], isDate(q.to) ? q.to : today()];

router.get('/profit-loss', allow('keuangan'), (req, res) => {
  const [from, to] = range(req.query);
  res.render('reports/profit_loss', { title: 'Laporan Laba Rugi', from, to, pl: finance.profitLoss(from, to) });
});

router.get('/balance-sheet', allow('keuangan'), (req, res) => {
  const asOf = isDate(req.query.date) ? req.query.date : today();
  res.render('reports/balance_sheet', { title: 'Neraca', asOf, bs: finance.balanceSheet(asOf) });
});

router.get('/cash-flow', allow('keuangan'), (req, res) => {
  const [from, to] = range(req.query);
  res.render('reports/cash_flow', { title: 'Laporan Arus Kas', from, to, cf: finance.cashFlow(from, to) });
});

router.get('/sales', allow('keuangan'), (req, res) => {
  const [from, to] = range(req.query);
  const byProduct = all(
    `SELECT p.name, c.name AS category, SUM(si.qty) AS qty, SUM(si.qty*si.price) AS omzet, SUM(si.cogs) AS cogs
       FROM sale_items si JOIN sales s ON s.id=si.sale_id JOIN products p ON p.id=si.product_id LEFT JOIN categories c ON c.id=p.category_id
      WHERE s.status='selesai' AND s.date BETWEEN ? AND ? GROUP BY p.id ORDER BY omzet DESC`,
    from, to
  );
  const daily = all(
    `SELECT date, COUNT(*) AS n, SUM(total) AS total, SUM(discount) AS discount, SUM(cogs) AS cogs,
            SUM(CASE WHEN payment_method='kredit' THEN total ELSE 0 END) AS kredit
       FROM sales WHERE status='selesai' AND date BETWEEN ? AND ? GROUP BY date ORDER BY date`,
    from, to
  );
  const byCashier = all(
    `SELECT u.name, COUNT(*) AS n, SUM(s.total) AS total FROM sales s JOIN users u ON u.id=s.user_id
      WHERE s.status='selesai' AND s.date BETWEEN ? AND ? GROUP BY u.id ORDER BY total DESC`,
    from, to
  );
  res.render('reports/sales', { title: 'Laporan Penjualan', from, to, byProduct, daily, byCashier });
});

router.get('/inventory', allow('keuangan', 'gudang'), (req, res) => {
  const rows = inventory.productOverview(today()).sort((a, b) => b.value - a.value);
  res.render('reports/inventory', {
    title: 'Laporan Persediaan & Perputaran Stok', rows, STATUS_LABEL: inventory.STATUS_LABEL,
    totalValue: rows.reduce((s, p) => s + p.value, 0),
    deadValue: rows.filter((p) => p.status === 'mati').reduce((s, p) => s + p.value, 0),
    slowValue: rows.filter((p) => p.status === 'lambat').reduce((s, p) => s + p.value, 0),
  });
});

module.exports = router;
