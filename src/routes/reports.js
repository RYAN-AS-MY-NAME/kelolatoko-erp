const router = require('express').Router();
const { allow } = require('../auth');
const { today, isDate, monthRange } = require('../util');
const finance = require('../services/finance');

const range = (q) => [isDate(q.from) ? q.from : monthRange(today().slice(0, 7))[0], isDate(q.to) ? q.to : today()];

router.use(allow('keuangan'));

router.get('/profit-loss', async (req, res) => {
  const [from, to] = range(req.query);
  res.render('reports/profit_loss', { title: 'Laporan Laba Rugi', from, to, pl: await finance.profitLoss(from, to) });
});

router.get('/cash-flow', async (req, res) => {
  const [from, to] = range(req.query);
  res.render('reports/cash_flow', { title: 'Laporan Arus Kas', from, to, cf: await finance.cashFlow(from, to) });
});

module.exports = router;
