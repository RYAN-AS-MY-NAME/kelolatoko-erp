// Fungsi bantu umum: error bisnis, tanggal, format rupiah, validasi input.

// Error yang pesannya aman ditampilkan ke pengguna (kesalahan input/aturan bisnis).
class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
    this.expose = true;
  }
}

const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Tanggal hari ini selalu WIB, karena server Vercel berjalan dalam UTC.
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return fmt(d);
}
function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
}
function monthRange(period) {
  const [y, m] = period.split('-').map(Number);
  return [`${period}-01`, `${period}-${pad(new Date(y, m, 0).getDate())}`];
}

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T00:00:00'));
const isPeriod = (s) => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

function toInt(value, label = 'Nilai', { min = null } = {}) {
  const s = String(value ?? '').trim();
  if (s === '' || !/^-?\d+$/.test(s)) throw new AppError(`${label} harus berupa angka bulat.`);
  const n = Number(s);
  if (min !== null && n < min) throw new AppError(`${label} minimal ${min}.`);
  return n;
}

function requireDate(value, label = 'Tanggal') {
  if (!isDate(value)) throw new AppError(`${label} tidak valid.`);
  return value;
}

const rp = (n) => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
const num = (n) => (Number(n) || 0).toLocaleString('id-ID');
function tgl(s) {
  if (!s) return '-';
  return new Date(s.slice(0, 10) + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}
function bulan(period) {
  return new Date(period + '-01T00:00:00').toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
}
// JSON aman untuk disisipkan di dalam tag <script>
const json = (x) => JSON.stringify(x).replace(/</g, '\\u003c');

module.exports = { AppError, today, addDays, daysBetween, monthRange, isDate, isPeriod, toInt, requireDate, rp, num, tgl, bulan, json };
