// Dashboard eksekutif: menggabungkan data dari semua modul dalam satu layar.
const { all, get } = require('../db');
const { addDays, monthRange } = require('../util');
const finance = require('./finance');
const inventory = require('./inventory');
const { ACC } = finance;

async function salesSummary(from, to) {
  return await get(
    `SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS total, COALESCE(SUM(total-cogs),0) AS gp
       FROM sales WHERE status='selesai' AND date BETWEEN ? AND ?`,
    from, to
  );
}

async function build(date) {
  const [monthStart] = monthRange(date.slice(0, 7));
  const chartFrom = addDays(date, -13);
  const daily = await all(
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

  const overview = await inventory.productOverview(date);
  const cashOut = (await finance.cashFlow(monthStart, date)).rows.filter((r) => r.outflow > 0).sort((a, b) => b.outflow - a.outflow);

  return {
    today: await salesSummary(date, date),
    month: await salesSummary(monthStart, date),
    pl: await finance.profitLoss(monthStart, date),
    cash: await finance.balance(ACC.KAS),
    inventoryValue: overview.reduce((s, p) => s + p.value, 0),
    payable: await finance.balance(ACC.HUTANG),
    chart,
    cashOut,
    topProducts: await all(
      `SELECT p.name, SUM(si.qty) AS qty, SUM(si.qty*si.price) AS omzet FROM sale_items si
         JOIN sales s ON s.id=si.sale_id JOIN products p ON p.id=si.product_id
        WHERE s.status='selesai' AND s.date BETWEEN ? AND ?
        GROUP BY p.id ORDER BY omzet DESC LIMIT 5`,
      monthStart, date
    ),
    lowStock: overview.filter((p) => p.status === 'habis' || p.status === 'menipis'),
    deadStock: overview.filter((p) => p.status === 'mati'),
    deadStockValue: overview.filter((p) => p.status === 'mati').reduce((s, p) => s + p.value, 0),
    expiring: await inventory.expiringBatches(date, 30),
    payablesDue: await all(
      `SELECT p.id, p.code, p.due_date, p.total-p.paid AS remaining, s.name AS supplier FROM purchases p
         JOIN suppliers s ON s.id=p.supplier_id
        WHERE p.status='diterima' AND p.total>p.paid AND p.due_date <= ? ORDER BY p.due_date`,
      addDays(date, 7)
    ),
  };
}

module.exports = { build };
