// KelolaToko — titik masuk aplikasi web.
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const { pool } = require('./src/db');

const { ROLES, requireLogin } = require('./src/auth');
const { rp, num, tgl, bulan, json, today } = require('./src/util');
const { NAV } = require('./src/nav');
const { icon } = require('./src/icons');

if (process.env.VERCEL && !process.env.SESSION_SECRET) throw new Error('SESSION_SECRET belum diisi di Vercel.');

const app = express();
app.set('trust proxy', 1); // Vercel meneruskan HTTPS lewat proxy
app.engine('ejs', require('ejs').__express); // eksplisit agar ejs ikut ter-bundle di Vercel
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'src', 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use((req, res, next) => { req.body ??= {}; next(); });
// Di Vercel folder public/ dilayani CDN; baris ini untuk menjalankan di laptop.
app.use(express.static(path.join(__dirname, 'public')));
app.use(
  session({
    secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    store: new PgSession({ pool, tableName: 'session', disableTouch: true, pruneSessionInterval: false }),
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: 'auto', maxAge: 8 * 60 * 60 * 1000 },
  })
);

// Variabel & helper yang tersedia di semua tampilan
app.use((req, res, next) => {
  const user = req.session.user || null;
  res.locals.user = user;
  res.locals.path = req.path;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  Object.assign(res.locals, { rp, num, tgl, bulan, json, icon, today: today(), ROLES });
  res.locals.can = (...roles) => !!user && (user.role === 'owner' || roles.includes(user.role));
  res.locals.nav = user
    ? NAV.map((g) => ({ ...g, items: g.items.filter((i) => user.role === 'owner' || i.roles.includes(user.role)) })).filter((g) => g.items.length)
    : [];
  res.locals.isActive = (href) => (href === '/' ? req.path === '/' : req.path === href || req.path.startsWith(href + '/'));
  req.flash = (type, msg) => { req.session.flash = { type, msg }; };
  next();
});

app.use(require('./src/routes/auth'));
app.use(requireLogin);
app.use(require('./src/routes/dashboard'));
app.use(require('./src/routes/sales'));
app.use('/master', require('./src/routes/master'));
app.use('/inventory', require('./src/routes/inventory'));
app.use('/purchases', require('./src/routes/purchases'));
app.use('/finance', require('./src/routes/finance'));
app.use('/hr', require('./src/routes/hr'));
app.use('/reports', require('./src/routes/reports'));

app.use((req, res) => {
  res.status(404).render('error', { title: 'Tidak Ditemukan', code: 404, message: 'Halaman yang Anda cari tidak ada.' });
});

// Penanganan kesalahan terpusat
app.use((err, req, res, next) => {
  const wantsJson = req.xhr || (req.headers.accept || '').includes('application/json');
  if (err.expose) {
    if (wantsJson) return res.status(err.status || 400).json({ error: err.message });
    if (err.status === 404) return res.status(404).render('error', { title: 'Tidak Ditemukan', code: 404, message: err.message });
    req.flash('error', err.message);
    return res.redirect(req.get('Referer') || '/');
  }
  console.error(err);
  if (wantsJson) return res.status(500).json({ error: 'Terjadi kesalahan sistem. Silakan coba lagi.' });
  res.status(500).render('error', { title: 'Kesalahan Sistem', code: 500, message: 'Terjadi kesalahan sistem. Data tidak diubah karena transaksi dibatalkan otomatis.' });
});

if (require.main === module) {
  const PORT = Number(process.env.PORT) || 3000;
  app.listen(PORT, () => console.log(`KelolaToko berjalan di http://localhost:${PORT}`));
}

module.exports = app;
