// Interaksi umum: menu mobile, konfirmasi aksi penting, tombol cetak, format rupiah.
// Dimuat di <head> agar helper format sudah tersedia untuk skrip halaman (grafik, POS).
(function () {
  window.rpShort = (v) => {
    const n = Math.abs(v);
    if (n >= 1e6) return (v / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' jt';
    if (n >= 1e3) return (v / 1e3).toLocaleString('id-ID', { maximumFractionDigits: 0 }) + ' rb';
    return String(v);
  };
  window.rp = (v) => 'Rp ' + Math.round(v || 0).toLocaleString('id-ID');

  // <form data-confirm="..."> meminta konfirmasi sebelum dikirim
  document.addEventListener('submit', (e) => {
    const msg = e.target.getAttribute('data-confirm');
    if (msg && !window.confirm(msg)) e.preventDefault();
  });

  document.addEventListener('DOMContentLoaded', () => {
    const body = document.body;
    const btn = document.getElementById('menuBtn');
    const overlay = document.getElementById('overlay');
    const setNav = (open) => {
      body.classList.toggle('nav-open', open);
      if (btn) btn.setAttribute('aria-expanded', String(open));
    };
    if (btn) btn.addEventListener('click', () => setNav(!body.classList.contains('nav-open')));
    if (overlay) overlay.addEventListener('click', () => setNav(false));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setNav(false); });

    // Tombol kirim dinonaktifkan sesaat agar transaksi tidak terkirim dua kali
    document.addEventListener('submit', (e) => {
      if (e.defaultPrevented || e.target.method !== 'post') return;
      const b = e.submitter;
      if (b && b.tagName === 'BUTTON') setTimeout(() => { b.disabled = true; }, 0);
    });
    window.addEventListener('pageshow', (e) => {
      if (e.persisted) document.querySelectorAll('button:disabled').forEach((b) => { b.disabled = false; });
    });
    document.querySelectorAll('[data-print]').forEach((el) => el.addEventListener('click', () => window.print()));
  });
})();
