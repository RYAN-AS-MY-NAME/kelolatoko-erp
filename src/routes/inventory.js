const router = require('express').Router();
const { all } = require('../db');
const { allow } = require('../auth');
const { AppError, today } = require('../util');
const inventory = require('../services/inventory');

router.get('/', allow('gudang', 'kasir'), async (req, res) => {
  const status = req.query.status || '';
  const rows = await inventory.productOverview(today());
  const counts = rows.reduce((c, p) => ({ ...c, [p.status]: (c[p.status] || 0) + 1 }), {});
  res.render('inventory/index', {
    title: 'Stok Barang',
    rows: status ? rows.filter((p) => p.status === status) : rows,
    counts, status, total: rows.length,
    totalValue: rows.reduce((s, p) => s + p.value, 0),
    expiredQty: rows.reduce((s, p) => s + p.expired_qty, 0),
    STATUS_LABEL: inventory.STATUS_LABEL,
  });
});

router.get('/card/:id', allow('gudang', 'kasir', 'keuangan'), async (req, res) => {
  const product = (await inventory.productOverview(today())).find((p) => p.id === Number(req.params.id));
  if (!product) throw new AppError('Produk tidak ditemukan atau nonaktif.', 404);
  res.render('inventory/card', {
    title: 'Kartu Stok',
    product,
    moves: (await inventory.stockCard(product.id)).reverse(),
    batches: await all('SELECT b.*, p.code AS po_code FROM batches b LEFT JOIN purchases p ON p.id=b.purchase_id WHERE b.product_id=? AND b.qty_remaining>0 ORDER BY b.expiry_date IS NULL, b.expiry_date', product.id),
    MOVE_LABEL: inventory.MOVE_LABEL,
    STATUS_LABEL: inventory.STATUS_LABEL,
  });
});

router.get('/batches', allow('gudang'), async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 60, 1), 365);
  res.render('inventory/batches', {
    title: 'Kedaluwarsa & Barang Rusak',
    days,
    batches: await inventory.expiringBatches(today(), days),
    allBatches: await all(
      `SELECT b.*, p.name, p.unit FROM batches b JOIN products p ON p.id=b.product_id
        WHERE b.qty_remaining>0 ORDER BY p.name, b.expiry_date`
    ),
    history: await all(
      `SELECT m.*, p.name, p.unit, u.name AS user_name FROM stock_movements m JOIN products p ON p.id=m.product_id
         LEFT JOIN users u ON u.id=m.user_id WHERE m.type=? ORDER BY m.id DESC LIMIT 30`,
      inventory.MOVE.WRITEOFF
    ),
  });
});

router.post('/batches/:id/writeoff', allow('gudang'), async (req, res) => {
  const value = await inventory.writeOff({ batchId: req.params.id, qty: req.body.qty, reason: req.body.reason, date: today() }, req.session.user.id);
  req.flash('success', `Barang dihapus dari stok. Kerugian ${require('../util').rp(value)} tercatat otomatis sebagai beban di laporan laba rugi.`);
  res.redirect('/inventory/batches');
});

module.exports = router;
