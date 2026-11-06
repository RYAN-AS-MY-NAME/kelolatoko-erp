// Modul SDM: data karyawan dan penggajian bulanan. Gaji yang dibayar otomatis menjadi beban di keuangan.
const { all, run, tx, logActivity } = require('../db');
const { AppError, requireDate, isPeriod, rp, bulan } = require('../util');
const finance = require('./finance');
const { ACC } = finance;

// Daftar gaji satu periode: karyawan aktif dengan gaji pokoknya, dan status sudah/belum dibayar.
async function payrollPreview(period) {
  if (!isPeriod(period)) throw new AppError('Periode tidak valid.');
  return await all(
    `SELECT e.*, pr.id AS payroll_id, pr.amount AS paid_amount, pr.paid_date
       FROM employees e
       LEFT JOIN payrolls pr ON pr.employee_id=e.id AND pr.period=?
      WHERE e.active=1 OR pr.id IS NOT NULL
      ORDER BY e.name`,
    period
  );
}

async function payPayroll(period, date, userId) {
  requireDate(date, 'Tanggal bayar');
  return tx(async () => {
    const rows = (await payrollPreview(period)).filter((r) => !r.payroll_id && r.active && r.base_salary > 0);
    if (!rows.length) throw new AppError(`Gaji periode ${bulan(period)} sudah dibayar semua.`);
    const total = rows.reduce((s, r) => s + r.base_salary, 0);
    await finance.ensureCash(total);
    const jid = await finance.postJournal({
      date, description: `Gaji karyawan periode ${bulan(period)} (${rows.length} orang)`, refType: 'payroll',
      lines: [{ account: ACC.GAJI, debit: total }, { account: ACC.KAS, credit: total }],
    });
    for (const r of rows) {
      await run('INSERT INTO payrolls(period, employee_id, amount, paid_date, journal_id) VALUES (?,?,?,?,?)', period, r.id, r.base_salary, date, jid);
    }
    await logActivity(userId, 'Bayar gaji', `${bulan(period)}: ${rp(total)}`);
    return total;
  });
}

module.exports = { payrollPreview, payPayroll };
