const router = require('express').Router();
const { get, logActivity } = require('../db');
const { verifyPassword } = require('../auth');

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { error: null, username: '' });
});

router.post('/login', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (!username || !password) {
    return res.status(400).render('login', { error: 'Nama pengguna dan kata sandi wajib diisi.', username });
  }
  const u = get('SELECT * FROM users WHERE username=?', username);
  if (!u || !verifyPassword(password, u.password_hash)) {
    return res.status(401).render('login', { error: 'Nama pengguna atau kata sandi salah.', username });
  }
  if (!u.active) return res.status(403).render('login', { error: 'Akun ini dinonaktifkan. Hubungi pemilik toko.', username });
  req.session.regenerate(() => {
    req.session.user = { id: u.id, name: u.name, role: u.role, username: u.username };
    logActivity(u.id, 'Masuk', null);
    res.redirect(u.role === 'kasir' ? '/pos' : '/');
  });
});

router.post('/logout', (req, res) => {
  if (req.session.user) logActivity(req.session.user.id, 'Keluar', null);
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
