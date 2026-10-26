// Master data generik: satu set route + tampilan untuk semua data induk.
// Data induk ini dipakai bersama oleh semua modul (shared master data).
const router = require('express').Router();
const { all, get, run, logActivity } = require('../db');
const { AppError, toInt, isDate } = require('../util');
const { allow, ROLES, hashPassword } = require('../auth');

const ACTIVE = [{ value: '1', label: 'Aktif' }, { value: '0', label: 'Nonaktif' }];

const ENTITIES = {
  products: {
    title: 'Produk', singular: 'produk', table: 'products', roles: ['gudang'],
    intro: 'Daftar barang dagangan. Harga beli diperbarui otomatis setiap barang diterima dari supplier.',
    fields: [
      { name: 'sku', label: 'Kode / SKU', required: true, hint: 'Contoh: BRS-PRM-5 atau barcode' },
      { name: 'name', label: 'Nama produk', required: true },
      { name: 'category_id', label: 'Kategori', type: 'select', required: true, options: () => all('SELECT id AS value, name AS label FROM categories ORDER BY name') },
      { name: 'supplier_id', label: 'Supplier utama', type: 'select', options: () => all('SELECT id AS value, name AS label FROM suppliers ORDER BY name'), hint: 'Dipakai untuk PO otomatis' },
      { name: 'unit', label: 'Satuan', required: true, default: 'pcs' },
      { name: 'buy_price', label: 'Harga beli (Rp)', type: 'number', required: true },
      { name: 'sell_price', label: 'Harga jual (Rp)', type: 'number', required: true },
      { name: 'min_stock', label: 'Stok minimum', type: 'number', required: true, hint: 'Di bawah angka ini muncul peringatan & saran PO' },
      { name: 'active', label: 'Status', type: 'select', options: ACTIVE, default: '1' },
    ],
    validate(d) {
      if (d.sell_price < d.buy_price) throw new AppError('Harga jual tidak boleh di bawah harga beli (toko akan rugi di setiap penjualan).');
    },
    listSql: `SELECT p.*, c.name AS category, s.name AS supplier,
                COALESCE((SELECT SUM(qty_remaining) FROM batches b WHERE b.product_id=p.id),0) AS stock,
                ROUND((p.sell_price - p.buy_price) * 100.0 / NULLIF(p.sell_price,0), 1) AS margin
              FROM products p LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN suppliers s ON s.id=p.supplier_id
              ORDER BY p.active DESC, p.name`,
    columns: [
      { key: 'name', label: 'Produk', sub: 'sku', link: (r) => `/inventory/card/${r.id}` }, { key: 'category', label: 'Kategori' },
      { key: 'buy_price', label: 'Harga beli', fmt: 'rp' }, { key: 'sell_price', label: 'Harga jual', fmt: 'rp' },
      { key: 'margin', label: 'Margin', fmt: 'pct' }, { key: 'stock', label: 'Stok', fmt: 'num', unit: 'unit' }, { key: 'min_stock', label: 'Min', fmt: 'num' },
      { key: 'active', label: 'Status', fmt: 'active' },
    ],
  },
  categories: {
    title: 'Kategori Produk', singular: 'kategori', table: 'categories', roles: ['gudang'],
    fields: [{ name: 'name', label: 'Nama kategori', required: true }],
    listSql: 'SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id=c.id) AS products FROM categories c ORDER BY c.name',
    columns: [{ key: 'name', label: 'Nama kategori' }, { key: 'products', label: 'Jumlah produk', fmt: 'num' }],
  },
  suppliers: {
    title: 'Supplier', singular: 'supplier', table: 'suppliers', roles: ['gudang', 'keuangan'],
    fields: [
      { name: 'name', label: 'Nama supplier', required: true },
      { name: 'phone', label: 'No. telepon' },
      { name: 'address', label: 'Alamat', type: 'textarea' },
    ],
    listSql: `SELECT s.*,
                (SELECT COUNT(*) FROM purchases p WHERE p.supplier_id=s.id AND p.status!='batal') AS po_count,
                COALESCE((SELECT SUM(total-paid) FROM purchases p WHERE p.supplier_id=s.id AND p.status='diterima'),0) AS debt
              FROM suppliers s ORDER BY s.name`,
    columns: [
      { key: 'name', label: 'Nama' }, { key: 'phone', label: 'Telepon' }, { key: 'address', label: 'Alamat' },
      { key: 'po_count', label: 'Jumlah PO', fmt: 'num' }, { key: 'debt', label: 'Hutang berjalan', fmt: 'rp' },
    ],
  },
  customers: {
    title: 'Pelanggan', singular: 'pelanggan', table: 'customers', roles: ['kasir', 'keuangan'],
    intro: 'Pelanggan tetap dan batas bon (kredit). Limit 0 berarti pelanggan hanya boleh membayar tunai.',
    fields: [
      { name: 'name', label: 'Nama pelanggan', required: true },
      { name: 'phone', label: 'No. telepon' },
      { name: 'address', label: 'Alamat', type: 'textarea' },
      { name: 'credit_limit', label: 'Limit bon (Rp)', type: 'number', default: '0' },
    ],
    listSql: `SELECT c.*,
                COALESCE((SELECT SUM(total-paid) FROM sales s WHERE s.customer_id=c.id AND s.status='selesai' AND s.payment_method='kredit'),0) AS debt,
                COALESCE((SELECT SUM(total) FROM sales s WHERE s.customer_id=c.id AND s.status='selesai'),0) AS spent
              FROM customers c ORDER BY c.name`,
    columns: [
      { key: 'name', label: 'Nama' }, { key: 'phone', label: 'Telepon' }, { key: 'credit_limit', label: 'Limit bon', fmt: 'rp' },
      { key: 'debt', label: 'Bon berjalan', fmt: 'rp' }, { key: 'spent', label: 'Total belanja', fmt: 'rp' },
    ],
  },
  employees: {
    title: 'Karyawan', singular: 'karyawan', table: 'employees', roles: ['keuangan'],
    fields: [
      { name: 'name', label: 'Nama lengkap', required: true },
      { name: 'position', label: 'Jabatan', required: true },
      { name: 'phone', label: 'No. telepon' },
      { name: 'base_salary', label: 'Gaji pokok / bulan (Rp)', type: 'number', required: true },
      { name: 'daily_allowance', label: 'Uang makan / hari hadir (Rp)', type: 'number', default: '0' },
      { name: 'join_date', label: 'Tanggal masuk', type: 'date' },
      { name: 'active', label: 'Status', type: 'select', options: ACTIVE, default: '1' },
    ],
    columns: [
      { key: 'name', label: 'Nama' }, { key: 'position', label: 'Jabatan' }, { key: 'phone', label: 'Telepon' },
      { key: 'base_salary', label: 'Gaji pokok', fmt: 'rp' }, { key: 'daily_allowance', label: 'Uang makan/hari', fmt: 'rp' },
      { key: 'join_date', label: 'Masuk', fmt: 'date' }, { key: 'active', label: 'Status', fmt: 'active' },
    ],
  },
  users: {
    title: 'Pengguna Sistem', singular: 'pengguna', table: 'users', roles: [],
    intro: 'Akun login dan hak akses. Setiap peran hanya melihat menu yang sesuai tugasnya.',
    fields: [
      { name: 'username', label: 'Nama pengguna', required: true },
      { name: 'name', label: 'Nama lengkap', required: true },
      { name: 'role', label: 'Peran', type: 'select', required: true, options: Object.entries(ROLES).map(([value, label]) => ({ value, label })) },
      { name: 'password', label: 'Kata sandi', type: 'password', hint: 'Minimal 6 karakter. Kosongkan saat edit bila tidak diganti.' },
      { name: 'active', label: 'Status', type: 'select', options: ACTIVE, default: '1' },
    ],
    beforeSave(d, isNew) {
      if (d.password) {
        if (d.password.length < 6) throw new AppError('Kata sandi minimal 6 karakter.');
        d.password_hash = hashPassword(d.password);
      } else if (isNew) throw new AppError('Kata sandi wajib diisi untuk pengguna baru.');
      delete d.password;
    },
    beforeDelete(id, req) {
      if (Number(id) === req.session.user.id) throw new AppError('Anda tidak bisa menghapus akun sendiri.');
    },
    listSql: 'SELECT id, username, name, role, active FROM users ORDER BY id',
    columns: [
      { key: 'username', label: 'Username' }, { key: 'name', label: 'Nama' }, { key: 'role', label: 'Peran', fmt: 'role' },
      { key: 'active', label: 'Status', fmt: 'active' },
    ],
  },
};

const optionsOf = (f) => (typeof f.options === 'function' ? f.options() : f.options || []);

function collect(cfg, body, isNew) {
  const data = {};
  for (const f of cfg.fields) {
    let v = String(body[f.name] ?? '').trim();
    if (f.type === 'password') { if (v) data[f.name] = v; continue; }
    if (v === '') {
      if (f.required) throw new AppError(`${f.label} wajib diisi.`);
      data[f.name] = f.type === 'number' ? 0 : null;
      continue;
    }
    if (f.type === 'number') v = toInt(v, f.label, { min: 0 });
    else if (f.type === 'date' && !isDate(v)) throw new AppError(`${f.label} tidak valid.`);
    else if (f.type === 'select') {
      if (!optionsOf(f).some((o) => String(o.value) === v)) throw new AppError(`Pilihan ${f.label} tidak valid.`);
      if (/^\d+$/.test(v)) v = Number(v);
    }
    data[f.name] = v;
  }
  cfg.validate?.(data, isNew);
  cfg.beforeSave?.(data, isNew);
  return data;
}

function friendlyDbError(err) {
  if (/UNIQUE/i.test(err.message)) return new AppError('Data dengan kode/nama tersebut sudah ada. Gunakan nilai lain.');
  if (/FOREIGN KEY/i.test(err.message)) return new AppError('Data ini sudah dipakai di transaksi sehingga tidak bisa dihapus. Ubah statusnya menjadi Nonaktif.');
  return err;
}

router.param('entity', (req, res, next, entity) => {
  const cfg = ENTITIES[entity];
  if (!cfg) return next(new AppError('Halaman tidak ditemukan.', 404));
  req.cfg = cfg;
  allow(...cfg.roles)(req, res, next);
});

function renderForm(res, req, values, error = null, status = 200) {
  const cfg = req.cfg;
  res.status(status).render('master/form', {
    title: (req.params.id ? 'Ubah ' : 'Tambah ') + cfg.singular,
    cfg, entity: req.params.entity, id: req.params.id || null, values, error,
    fields: cfg.fields.map((f) => ({ ...f, opts: optionsOf(f) })),
  });
}

router.get('/:entity', (req, res) => {
  const cfg = req.cfg;
  const rows = all(cfg.listSql || `SELECT * FROM ${cfg.table} ORDER BY id DESC`);
  res.render('master/index', { title: cfg.title, cfg, entity: req.params.entity, rows });
});

router.get('/:entity/new', (req, res) => {
  const values = Object.fromEntries(req.cfg.fields.map((f) => [f.name, f.default ?? '']));
  renderForm(res, req, values);
});

router.post('/:entity', (req, res) => {
  const cfg = req.cfg;
  try {
    const data = collect(cfg, req.body, true);
    const cols = Object.keys(data);
    const r = run(`INSERT INTO ${cfg.table}(${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, ...cols.map((c) => data[c]));
    logActivity(req.session.user.id, `Tambah ${cfg.singular}`, data.name || data.username || `#${r.id}`);
    req.flash('success', `Data ${cfg.singular} berhasil ditambahkan.`);
    res.redirect(`/master/${req.params.entity}`);
  } catch (err) {
    const e = friendlyDbError(err);
    if (!e.expose) throw e;
    renderForm(res, req, req.body, e.message, 400);
  }
});

router.get('/:entity/:id/edit', (req, res) => {
  const row = get(`SELECT * FROM ${req.cfg.table} WHERE id=?`, req.params.id);
  if (!row) throw new AppError('Data tidak ditemukan.', 404);
  renderForm(res, req, row);
});

router.post('/:entity/:id', (req, res) => {
  const cfg = req.cfg;
  try {
    if (!get(`SELECT id FROM ${cfg.table} WHERE id=?`, req.params.id)) throw new AppError('Data tidak ditemukan.', 404);
    const data = collect(cfg, req.body, false);
    const cols = Object.keys(data);
    run(`UPDATE ${cfg.table} SET ${cols.map((c) => `${c}=?`).join(',')} WHERE id=?`, ...cols.map((c) => data[c]), req.params.id);
    logActivity(req.session.user.id, `Ubah ${cfg.singular}`, data.name || data.username || `#${req.params.id}`);
    req.flash('success', `Data ${cfg.singular} berhasil diperbarui.`);
    res.redirect(`/master/${req.params.entity}`);
  } catch (err) {
    const e = friendlyDbError(err);
    if (!e.expose || e.status === 404) throw e;
    renderForm(res, req, { ...req.body, id: req.params.id }, e.message, 400);
  }
});

router.post('/:entity/:id/delete', (req, res) => {
  const cfg = req.cfg;
  cfg.beforeDelete?.(req.params.id, req);
  try {
    const r = run(`DELETE FROM ${cfg.table} WHERE id=?`, req.params.id);
    if (!r.changes) throw new AppError('Data tidak ditemukan.', 404);
  } catch (err) {
    throw friendlyDbError(err);
  }
  logActivity(req.session.user.id, `Hapus ${cfg.singular}`, `#${req.params.id}`);
  req.flash('success', `Data ${cfg.singular} berhasil dihapus.`);
  res.redirect(`/master/${req.params.entity}`);
});

module.exports = router;
