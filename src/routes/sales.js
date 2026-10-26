const router = require('express').Router();
const { all } = require('../db');
const { allow } = require('../auth');
const { today, addDays, isDate } = require('../util');
const sales = require('../services/sales');

router.get('/pos', allow('kasir'), (req, res) => {
  const date = today();
  res.render('pos', {
    title: 'Kasir (Point of Sale)',
    products: all(
      `SELECT p.id, p.sku, p.name, p.unit, p.sell_price, c.name AS category,
              COALESCE((SELECT SUM(qty_remaining) FROM batches b WHERE b.product_id=p.id AND (b.expiry_date IS NULL OR b.expiry_date >= ?)),0) AS stock
         FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.active=1 ORDER BY p.name`,
      date
    ),
    customers: all('SELECT id, name, credit_limit FROM customers ORDER BY name').map((c) => ({ ...c, debt: sales.outstandingCredit(c.id) })),
    categories: all('SELECT name FROM categories ORDER BY name').map((c) => c.name),
  });
});

// Dipanggil oleh halaman kasir (fetch JSON). Error bisnis dikembalikan sebagai JSON 400.
router.post('/pos', allow('kasir'), (req, res) => {
  const b = req.body || {};
  const id = sales.createSale({
    date: today(),
    customerId: Number(b.customerId) || null,
    method: b.method,
    items: b.items,
    discount: b.discount || 0,
    cashReceived: b.cashReceived ?? null,
  }, req.session.user.id);
  res.json({ ok: true, id });
});

router.get('/sales', allow('kasir', 'keuangan'), (req, res) => {
  const from = isDate(req.query.from) ? req.query.from : addDays(today(), -6);
  const to = isDate(req.query.to) ? req.query.to : today();
  const method = ['tunai', 'kredit'].includes(req.query.method) ? req.query.method : '';
  const rows = all(
    `SELECT s.*, c.name AS customer_name, u.name AS cashier,
            (SELECT SUM(qty) FROM sale_items WHERE sale_id=s.id) AS items
       FROM sales s LEFT JOIN customers c ON c.id=s.customer_id LEFT JOIN users u ON u.id=s.user_id
      WHERE s.date BETWEEN ? AND ? AND (? = '' OR s.payment_method = ?)
      ORDER BY s.date DESC, s.id DESC LIMIT 500`,
    from, to, method, method
  );
  const ok = rows.filter((r) => r.status === 'selesai');
  res.render('sales/index', {
    title: 'Riwayat Penjualan', rows, from, to, method,
    sum: { n: ok.length, total: ok.reduce((s, r) => s + r.total, 0), gp: ok.reduce((s, r) => s + r.total - r.cogs, 0) },
  });
});

router.get('/sales/:id', allow('kasir', 'keuangan'), (req, res) => {
  const s = sales.getSale(req.params.id);
  res.render('sales/show', { title: `Nota ${s.code}`, s, justCreated: req.query.new === '1' });
});

router.post('/sales/:id/pay', allow('kasir', 'keuangan'), (req, res) => {
  sales.receivePayment(req.params.id, { amount: req.body.amount, date: req.body.date || today() }, req.session.user.id);
  req.flash('success', 'Pembayaran bon diterima. Kas bertambah dan piutang berkurang.');
  const back = /^\/[a-z]/.test(req.body.back || '') ? req.body.back : `/sales/${req.params.id}`;
  res.redirect(back);
});

router.post('/sales/:id/void', allow(), (req, res) => {
  sales.voidSale(req.params.id, { reason: req.body.reason, date: today() }, req.session.user.id);
  req.flash('success', 'Transaksi dibatalkan. Stok dikembalikan dan jurnal dibalik otomatis.');
  res.redirect(`/sales/${req.params.id}`);
});

module.exports = router;
