const router = require('express').Router();
const { all } = require('../db');
const { allow } = require('../auth');
const { today, isDate, isPeriod, monthRange } = require('../util');
const hr = require('../services/hr');

router.use(allow('keuangan'));

router.get('/attendance', (req, res) => {
  const date = isDate(req.query.date) ? req.query.date : today();
  const period = date.slice(0, 7);
  const [from, to] = monthRange(period);
  res.render('hr/attendance', {
    title: 'Absensi Karyawan', date, period,
    rows: hr.attendanceOn(date),
    recap: all(
      `SELECT e.name,
         SUM(a.status='hadir') AS hadir, SUM(a.status='izin') AS izin, SUM(a.status='sakit') AS sakit, SUM(a.status='alpa') AS alpa
       FROM employees e LEFT JOIN attendance a ON a.employee_id=e.id AND a.date BETWEEN ? AND ?
       WHERE e.active=1 GROUP BY e.id ORDER BY e.name`,
      from, to
    ),
    STATUSES: hr.ATTENDANCE,
  });
});

router.post('/attendance', (req, res) => {
  const date = req.body.date;
  const entries = {};
  for (const [k, v] of Object.entries(req.body)) if (k.startsWith('s_')) entries[k.slice(2)] = v;
  hr.saveAttendance(date, entries, req.session.user.id);
  req.flash('success', 'Absensi tersimpan. Data ini dipakai otomatis untuk menghitung gaji.');
  res.redirect(`/hr/attendance?date=${date}`);
});

router.get('/payroll', (req, res) => {
  const period = isPeriod(req.query.period) ? req.query.period : today().slice(0, 7);
  const rows = hr.payrollPreview(period);
  res.render('hr/payroll', {
    title: 'Penggajian', period, rows, WORK_DAYS: hr.WORK_DAYS,
    unpaidTotal: rows.filter((r) => !r.payroll_id && r.active).reduce((s, r) => s + r.net, 0),
    history: all(
      `SELECT period, COUNT(*) AS n, SUM(net) AS total, MAX(paid_date) AS paid_date FROM payrolls GROUP BY period ORDER BY period DESC LIMIT 12`
    ),
  });
});

router.post('/payroll', (req, res) => {
  const total = hr.payPayroll(req.body.period, req.body.date || today(), req.session.user.id);
  req.flash('success', `Gaji dibayarkan: ${require('../util').rp(total)}. Kas berkurang dan beban gaji tercatat di laporan laba rugi.`);
  res.redirect(`/hr/payroll?period=${req.body.period}`);
});

module.exports = router;
