// Autentikasi & hak akses berbasis peran (role-based access control).
const crypto = require('crypto');

const ROLES = {
  owner: 'Pemilik',
  kasir: 'Kasir',
  gudang: 'Gudang',
  keuangan: 'Keuangan',
};

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 32);
  return crypto.timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
}

function requireLogin(req, res, next) {
  if (req.session.user) return next();
  res.redirect('/login');
}

// Pemilik (owner) selalu boleh mengakses semua halaman.
function allow(...roles) {
  return (req, res, next) => {
    const role = req.session.user?.role;
    if (role === 'owner' || roles.includes(role)) return next();
    res.status(403).render('error', {
      title: 'Akses Ditolak',
      code: 403,
      message: `Peran "${ROLES[role] || role}" tidak memiliki izin membuka halaman ini.`,
    });
  };
}

module.exports = { ROLES, hashPassword, verifyPassword, requireLogin, allow };
