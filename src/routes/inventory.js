const router = require('express').Router();
const { all, get } = require('../db');
const { allow } = require('../auth');
const { AppError, today } = require('../util');
const inventory = require('../services/inventory');

router.get('/', allow('gudang', 'kasir'), (req, res) => {
  const status = req.query.status || '';
  const rows = inventory.productOverview(today());
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

router.get('/card/:id', allow('gudang', 'kasir', 'keuangan'), (req, res) => {
  const product = inventory.productOverview(today()).find((p) => p.id === Number(req.params.id));
  if (!product) throw new AppError('Produk tidak ditemukan atau nonaktif.', 404);
  res.render('inventory/card', {
    title: 'Kartu Stok',
    product,
    moves: inventory.stockCard(product.id).reverse(),
    batches: all('SELECT b.*, p.code AS po_code FROM batches b LEFT JOIN purchases p ON p.id=b.purchase_id WHERE b.product_id=? AND b.qty_remaining>0 ORDER BY b.expiry_date IS NULL, b.expiry_date', product.id),
    MOVE_LABEL: inventory.MOVE_LABEL,
    STATUS_LABEL: inventory.STATUS_LABEL,
  });
});

router.get('/batches', allow('gudang'), (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 60, 1), 365);
  res.render('inventory/batches', {
    title: 'Kedaluwarsa & Barang Rusak',
    days,
    batches: inventory.expiringBatches(today(), days),
    allBatches: all(
      `SELECT b.*, p.name, p.unit FROM batches b JOIN products p ON p.id=b.product_id
        WHERE b.qty_remaining>0 ORDER BY p.name, b.expiry_date`
    ),
    history: all(
      `SELECT m.*, p.name, p.unit, u.name AS user_name FROM stock_movements m JOIN products p ON p.id=m.product_id
         LEFT JOIN users u ON u.id=m.user_id WHERE m.type=? ORDER BY m.id DESC LIMIT 30`,
      inventory.MOVE.WRITEOFF
    ),
  });
});

router.post('/batches/:id/writeoff', allow('gudang'), (req, res) => {
  const value = inventory.writeOff({ batchId: req.params.id, qty: req.body.qty, reason: req.body.reason, date: today() }, req.session.user.id);
  req.flash('success', `Barang dihapus dari stok. Kerugian ${require('../util').rp(value)} tercatat otomatis sebagai beban di laporan laba rugi.`);
  res.redirect('/inventory/batches');
});

router.get('/opname', allow('gudang'), (req, res) => {
  res.render('inventory/opname', {
    title: 'Stok Opname',
    products: inventory.productOverview(today()),
    history: all(
      `SELECT o.*, p.name, p.unit, u.name AS user_name FROM stock_opnames o JOIN products p ON p.id=o.product_id
         LEFT JOIN users u ON u.id=o.user_id ORDER BY o.id DESC LIMIT 50`
    ),
    selected: Number(req.query.product) || null,
  });
});

router.post('/opname', allow('gudang'), (req, res) => {
  const productId = Number(req.body.product_id);
  if (!productId) throw new AppError('Pilih produk terlebih dahulu.');
  const { diff } = inventory.stockOpname({ productId, physicalQty: req.body.physical_qty, note: req.body.note, date: today() }, req.session.user.id);
  const p = get('SELECT name FROM products WHERE id=?', productId);
  req.flash(diff === 0 ? 'success' : 'warning',
    diff === 0 ? `Stok ${p.name} sesuai, tidak ada selisih.` : `Stok ${p.name} disesuaikan (${diff > 0 ? '+' : ''}${diff}). Selisih sudah dijurnal otomatis.`);
  res.redirect('/inventory/opname');
});

module.exports = router;
