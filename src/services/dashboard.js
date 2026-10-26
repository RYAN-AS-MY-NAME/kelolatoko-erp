// Dashboard eksekutif: menggabungkan data dari semua modul dalam satu layar.
const { all, get } = require('../db');
const { addDays, monthRange } = require('../util');
const finance = require('./finance');
const inventory = require('./inventory');
const { ACC } = finance;

function salesSummary(from, to) {
  return get(
    `SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS total, COALESCE(SUM(total-cogs),0) AS gp
       FROM sales WHERE status='selesai' AND date BETWEEN ? AND ?`,
    from, to
  );
}

function build(date) {
  const [monthStart] = monthRange(date.slice(0, 7));
  const chartFrom = addDays(date, -13);
  const daily = all(
    `SELECT date, SUM(total) AS omzet, SUM(total-cogs) AS laba FROM sales
      WHERE status='selesai' AND date BETWEEN ? AND ? GROUP BY date`,
    chartFrom, date
  );
  const chart = [];
  for (let i = 0; i < 14; i++) {
    const d = addDays(chartFrom, i);
    const r = daily.find((x) => x.date === d);
    chart.push({ date: d, omzet: r?.omzet || 0, laba: r?.laba || 0 });
  }

  const overview = inventory.productOverview(date);
  const cashOut = finance.cashFlow(monthStart, date).rows.filter((r) => r.outflow > 0).sort((a, b) => b.outflow - a.outflow);

  return {
    today: salesSummary(date, date),
    month: salesSummary(monthStart, date),
    pl: finance.profitLoss(monthStart, date),
    cash: finance.balance(ACC.KAS),
    inventoryValue: overview.reduce((s, p) => s + p.value, 0),
    receivable: finance.balance(ACC.PIUTANG),
    payable: finance.balance(ACC.HUTANG),
    chart,
    cashOut,
    topProducts: all(
      `SELECT p.name, SUM(si.qty) AS qty, SUM(si.qty*si.price) AS omzet FROM sale_items si
         JOIN sales s ON s.id=si.sale_id JOIN products p ON p.id=si.product_id
        WHERE s.status='selesai' AND s.date BETWEEN ? AND ?
        GROUP BY p.id ORDER BY omzet DESC LIMIT 5`,
      monthStart, date
    ),
    lowStock: overview.filter((p) => p.status === 'habis' || p.status === 'menipis'),
    deadStock: overview.filter((p) => p.status === 'mati'),
    deadStockValue: overview.filter((p) => p.status === 'mati').reduce((s, p) => s + p.value, 0),
    expiring: inventory.expiringBatches(date, 30),
    payablesDue: all(
      `SELECT p.id, p.code, p.due_date, p.total-p.paid AS remaining, s.name AS supplier FROM purchases p
         JOIN suppliers s ON s.id=p.supplier_id
        WHERE p.status='diterima' AND p.total>p.paid AND p.due_date <= ? ORDER BY p.due_date`,
      addDays(date, 7)
    ),
    receivablesDue: all(
      `SELECT s.id, s.code, s.due_date, s.total-s.paid AS remaining, c.name AS customer FROM sales s
         JOIN customers c ON c.id=s.customer_id
        WHERE s.status='selesai' AND s.payment_method='kredit' AND s.total>s.paid AND s.due_date <= ? ORDER BY s.due_date`,
      addDays(date, 7)
    ),
  };
}

module.exports = { build };
