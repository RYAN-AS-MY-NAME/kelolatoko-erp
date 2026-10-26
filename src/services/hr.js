// Modul SDM: absensi harian dan penggajian. Gaji yang dibayar otomatis menjadi beban di keuangan.
const { all, get, run, tx, logActivity } = require('../db');
const { AppError, requireDate, monthRange, isPeriod, rp, bulan } = require('../util');
const finance = require('./finance');
const { ACC } = finance;

const ATTENDANCE = ['hadir', 'izin', 'sakit', 'alpa'];
const WORK_DAYS = 26; // potongan alpa = gaji pokok / 26 per hari

function saveAttendance(date, entries, userId) {
  requireDate(date);
  const employees = all('SELECT id FROM employees WHERE active=1');
  tx(() => {
    for (const e of employees) {
      const status = entries[e.id];
      if (!status) continue;
      if (!ATTENDANCE.includes(status)) throw new AppError('Status absensi tidak valid.');
      run(
        'INSERT INTO attendance(employee_id, date, status) VALUES (?,?,?) ON CONFLICT(employee_id, date) DO UPDATE SET status=excluded.status',
        e.id, date, status
      );
    }
  });
  logActivity(userId, 'Simpan absensi', date);
}

function payrollPreview(period) {
  if (!isPeriod(period)) throw new AppError('Periode tidak valid.');
  const [from, to] = monthRange(period);
  return all(
    `SELECT e.*,
       SUM(CASE WHEN a.status='hadir' THEN 1 ELSE 0 END) AS hadir,
       SUM(CASE WHEN a.status='izin'  THEN 1 ELSE 0 END) AS izin,
       SUM(CASE WHEN a.status='sakit' THEN 1 ELSE 0 END) AS sakit,
       SUM(CASE WHEN a.status='alpa'  THEN 1 ELSE 0 END) AS alpa,
       pr.id AS payroll_id, pr.net AS paid_net, pr.paid_date
     FROM employees e
     LEFT JOIN attendance a ON a.employee_id=e.id AND a.date BETWEEN ? AND ?
     LEFT JOIN payrolls pr ON pr.employee_id=e.id AND pr.period=?
     WHERE e.active=1 OR pr.id IS NOT NULL
     GROUP BY e.id ORDER BY e.name`,
    from, to, period
  ).map((e) => {
    const hadir = e.hadir || 0;
    const alpa = e.alpa || 0;
    const allowance = hadir * e.daily_allowance;
    const deduction = alpa * Math.round(e.base_salary / WORK_DAYS);
    return { ...e, hadir, alpa, izin: e.izin || 0, sakit: e.sakit || 0, allowance, deduction, net: Math.max(e.base_salary + allowance - deduction, 0) };
  });
}

function payPayroll(period, date, userId) {
  requireDate(date, 'Tanggal bayar');
  return tx(() => {
    const rows = payrollPreview(period).filter((r) => !r.payroll_id && r.active && r.net > 0);
    if (!rows.length) throw new AppError(`Gaji periode ${bulan(period)} sudah dibayar semua.`);
    const total = rows.reduce((s, r) => s + r.net, 0);
    finance.ensureCash(total);
    const jid = finance.postJournal({
      date, description: `Gaji karyawan periode ${bulan(period)} (${rows.length} orang)`, refType: 'payroll',
      lines: [{ account: ACC.GAJI, debit: total }, { account: ACC.KAS, credit: total }],
    });
    for (const r of rows) {
      run(
        `INSERT INTO payrolls(period, employee_id, base_salary, days_present, allowance, deduction, net, paid_date, journal_id)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        period, r.id, r.base_salary, r.hadir, r.allowance, r.deduction, r.net, date, jid
      );
    }
    logActivity(userId, 'Bayar gaji', `${bulan(period)}: ${rp(total)}`);
    return total;
  });
}

function attendanceOn(date) {
  return all(
    `SELECT e.id, e.name, e.position, a.status FROM employees e
       LEFT JOIN attendance a ON a.employee_id=e.id AND a.date=?
      WHERE e.active=1 ORDER BY e.name`,
    date
  );
}

module.exports = { ATTENDANCE, WORK_DAYS, saveAttendance, payrollPreview, payPayroll, attendanceOn };
