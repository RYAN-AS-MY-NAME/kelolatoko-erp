const router = require('express').Router();
const { all } = require('../db');
const { allow } = require('../auth');
const { today, addDays } = require('../util');
const purchasing = require('../services/purchasing');

const arr = (v) => (Array.isArray(v) ? v : v === undefined ? [] : [v]);

router.get('/', allow('gudang', 'keuangan'), (req, res) => {
  const status = req.query.status || '';
  const rows = all(
    `SELECT p.*, s.name AS supplier_name, (SELECT COUNT(*) FROM purchase_items i WHERE i.purchase_id=p.id) AS items
       FROM purchases p JOIN suppliers s ON s.id=p.supplier_id
      WHERE (? = '' OR p.status = ?) ORDER BY p.order_date DESC, p.id DESC LIMIT 300`,
    status, status
  );
  const counts = Object.fromEntries(all('SELECT status, COUNT(*) AS n FROM purchases GROUP BY status').map((r) => [r.status, r.n]));
  res.render('purchases/index', { title: 'Purchase Order (Pembelian)', rows, status, counts, STATUS_LABEL: purchasing.STATUS_LABEL });
});

router.get('/new', allow('gudang'), (req, res) => {
  res.render('purchases/new', {
    title: 'Buat Purchase Order',
    suppliers: all('SELECT * FROM suppliers ORDER BY name'),
    products: all('SELECT id, name, sku, unit, buy_price, supplier_id FROM products WHERE active=1 ORDER BY name'),
    defaults: { order_date: today(), due_date: addDays(today(), 14) },
  });
});

router.post('/', allow('gudang'), (req, res) => {
  const b = req.body;
  const pids = arr(b.product_id), qtys = arr(b.qty), costs = arr(b.unit_cost), exps = arr(b.expiry_date);
  const id = purchasing.createPO({
    supplierId: Number(b.supplier_id) || null,
    orderDate: b.order_date,
    dueDate: b.due_date || null,
    note: b.note || null,
    status: b.as_draft ? 'draf' : 'dipesan',
    items: pids.map((p, i) => ({ productId: p, qty: qtys[i], unitCost: costs[i], expiryDate: exps[i] || null })),
  }, req.session.user.id);
  req.flash('success', 'Purchase order berhasil dibuat.');
  res.redirect(`/purchases/${id}`);
});

router.post('/reorder', allow('gudang'), (req, res) => {
  const ids = purchasing.generateReorder(today(), req.session.user.id);
  req.flash('success', `${ids.length} PO draf dibuat otomatis dari barang yang stoknya menipis. Periksa lalu kirim ke supplier.`);
  res.redirect('/purchases?status=draf');
});

router.get('/:id', allow('gudang', 'keuangan'), (req, res) => {
  const po = purchasing.getPO(req.params.id);
  res.render('purchases/show', { title: `PO ${po.code}`, po, STATUS_LABEL: purchasing.STATUS_LABEL });
});

router.post('/:id/approve', allow('gudang'), (req, res) => {
  purchasing.approvePO(req.params.id, req.session.user.id);
  req.flash('success', 'PO dikirim ke supplier (status: dipesan).');
  res.redirect(`/purchases/${req.params.id}`);
});

router.post('/:id/cancel', allow('gudang'), (req, res) => {
  purchasing.cancelPO(req.params.id, req.session.user.id);
  req.flash('success', 'PO dibatalkan.');
  res.redirect(`/purchases/${req.params.id}`);
});

router.post('/:id/receive', allow('gudang'), (req, res) => {
  const expiries = {};
  for (const [k, v] of Object.entries(req.body)) if (k.startsWith('expiry_')) expiries[k.slice(7)] = v;
  purchasing.receivePO(req.params.id, { date: req.body.date || today(), expiries, payAmount: Number(req.body.pay_amount) || 0 }, req.session.user.id);
  req.flash('success', 'Barang diterima: stok bertambah, harga beli diperbarui, dan hutang ke supplier tercatat otomatis.');
  res.redirect(`/purchases/${req.params.id}`);
});

router.post('/:id/pay', allow('keuangan'), (req, res) => {
  purchasing.payPO(req.params.id, { amount: req.body.amount, date: req.body.date || today(), note: req.body.note }, req.session.user.id);
  req.flash('success', 'Pembayaran ke supplier tercatat. Kas dan hutang sudah diperbarui.');
  const back = /^\/[a-z]/.test(req.body.back || '') ? req.body.back : `/purchases/${req.params.id}`;
  res.redirect(back);
});

module.exports = router;
