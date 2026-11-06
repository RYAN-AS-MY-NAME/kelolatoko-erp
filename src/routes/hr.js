const router = require('express').Router();
const { all } = require('../db');
const { allow } = require('../auth');
const { today, isPeriod, rp } = require('../util');
const hr = require('../services/hr');

router.use(allow('keuangan'));

router.get('/payroll', async (req, res) => {
  const period = isPeriod(req.query.period) ? req.query.period : today().slice(0, 7);
  const rows = await hr.payrollPreview(period);
  res.render('hr/payroll', {
    title: 'Penggajian', period, rows,
    unpaidTotal: rows.filter((r) => !r.payroll_id && r.active).reduce((s, r) => s + r.base_salary, 0),
    history: await all(
      `SELECT period, COUNT(*) AS n, SUM(amount) AS total, MAX(paid_date) AS paid_date FROM payrolls GROUP BY period ORDER BY period DESC LIMIT 12`
    ),
  });
});

router.post('/payroll', async (req, res) => {
  const total = await hr.payPayroll(req.body.period, req.body.date || today(), req.session.user.id);
  req.flash('success', `Gaji dibayarkan: ${rp(total)}. Kas berkurang dan beban gaji tercatat di laporan laba rugi.`);
  res.redirect(`/hr/payroll?period=${req.body.period}`);
});

module.exports = router;
