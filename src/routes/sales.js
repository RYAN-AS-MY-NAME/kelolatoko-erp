const router = require('express').Router();
const { all } = require('../db');
const { allow } = require('../auth');
const { today, addDays, isDate } = require('../util');
const sales = require('../services/sales');

router.get('/pos', allow('kasir'), async (req, res) => {
  const date = today();
  res.render('pos', {
    title: 'Kasir',
    products: await all(
      `SELECT p.id, p.sku, p.name, p.unit, p.sell_price, c.name AS category,
              COALESCE((SELECT SUM(qty_remaining) FROM batches b WHERE b.product_id=p.id AND (b.expiry_date IS NULL OR b.expiry_date >= ?)),0) AS stock
         FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.active=1 ORDER BY p.name`,
      date
    ),
    customers: await all('SELECT id, name FROM customers ORDER BY name'),
    categories: (await all('SELECT name FROM categories ORDER BY name')).map((c) => c.name),
  });
});

// Dipanggil oleh halaman kasir (fetch JSON). Error bisnis dikembalikan sebagai JSON 400.
router.post('/pos', allow('kasir'), async (req, res) => {
  const b = req.body || {};
  const id = await sales.createSale({
    date: today(),
    customerId: Number(b.customerId) || null,
    items: b.items,
    cashReceived: b.cashReceived ?? null,
  }, req.session.user.id);
  res.json({ ok: true, id });
});

router.get('/sales', allow('kasir', 'keuangan'), async (req, res) => {
  const from = isDate(req.query.from) ? req.query.from : addDays(today(), -6);
  const to = isDate(req.query.to) ? req.query.to : today();
  const rows = await all(
    `SELECT s.*, c.name AS customer_name, u.name AS cashier,
            (SELECT SUM(qty) FROM sale_items WHERE sale_id=s.id) AS items
       FROM sales s LEFT JOIN customers c ON c.id=s.customer_id LEFT JOIN users u ON u.id=s.user_id
      WHERE s.date BETWEEN ? AND ?
      ORDER BY s.date DESC, s.id DESC LIMIT 500`,
    from, to
  );
  const ok = rows.filter((r) => r.status === 'selesai');
  res.render('sales/index', {
    title: 'Riwayat Penjualan', rows, from, to,
    sum: { n: ok.length, total: ok.reduce((s, r) => s + r.total, 0), gp: ok.reduce((s, r) => s + r.total - r.cogs, 0) },
  });
});

router.get('/sales/:id', allow('kasir', 'keuangan'), async (req, res) => {
  const s = await sales.getSale(req.params.id);
  res.render('sales/show', { title: `Nota ${s.code}`, s, justCreated: req.query.new === '1' });
});

router.post('/sales/:id/void', allow(), async (req, res) => {
  await sales.voidSale(req.params.id, { reason: req.body.reason, date: today() }, req.session.user.id);
  req.flash('success', 'Transaksi dibatalkan. Stok dikembalikan dan uang dikembalikan dari kas.');
  res.redirect(`/sales/${req.params.id}`);
});

module.exports = router;
