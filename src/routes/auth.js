const router = require('express').Router();
const { get, run, logActivity } = require('../db');
const { verifyPassword } = require('../auth');

router.get('/login', async (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { error: null, username: '' });
});

router.post('/login', async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (!username || !password) {
    return res.status(400).render('login', { error: 'Nama pengguna dan kata sandi wajib diisi.', username });
  }
  const u = await get('SELECT * FROM users WHERE username=?', username);
  if (!u || !verifyPassword(password, u.password_hash)) {
    return res.status(401).render('login', { error: 'Nama pengguna atau kata sandi salah.', username });
  }
  if (!u.active) return res.status(403).render('login', { error: 'Akun ini dinonaktifkan. Hubungi pemilik toko.', username });
  await new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
  req.session.user = { id: u.id, name: u.name, role: u.role, username: u.username };
  await logActivity(u.id, 'Masuk', null);
  await run('DELETE FROM session WHERE expire < now()'); // bersihkan session kedaluwarsa
  res.redirect(u.role === 'kasir' ? '/pos' : '/');
});

router.post('/logout', async (req, res) => {
  if (req.session.user) await logActivity(req.session.user.id, 'Keluar', null);
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
