# KelolaToko — Sistem ERP Toko Sembako AMART

Aplikasi ERP berbasis web untuk toko sembako/minimarket kecil. Dibuat untuk tugas UTS mata kuliah Sistem Informasi Enterprise.

**Masalah bisnis yang diselesaikan**

1. Pemilik tidak tahu uang keluar ke mana dan pemasukan sebenarnya berapa.
2. Modal tertahan di **stok mati** (barang tidak laku) dan barang kedaluwarsa, salah satu penyebab warung bangkrut.
3. Stok sering kosong saat dicari pembeli, dan hutang ke supplier tidak tercatat rapi.

## Cara menjalankan

Prasyarat: **Node.js 22.13 atau lebih baru** dan satu proyek [Supabase](https://supabase.com) (paket Free cukup).

1. Pasang dependensi:

   ```bash
   npm install
   ```

2. Salin `.env.example` menjadi `.env`, lalu isi `DATABASE_URL` dan `SESSION_SECRET` (lihat [Deploy](#deploy-ke-supabase--vercel)).
3. Buat tabel dan isi data contoh 45 hari terakhir (sekali saja):

   ```bash
   npm run db:setup
   ```

4. Jalankan aplikasi:

   ```bash
   npm start
   ```

Buka <http://localhost:3000>.

| Perintah | Fungsi |
|---|---|
| `npm start` | Menjalankan aplikasi |
| `npm run db:setup` | Membuat tabel dan data contoh di database yang masih kosong |
| `npm run seed` | **Menghapus semua data** di `DATABASE_URL` lalu mengisi ulang data contoh (pakai sebelum demo) |
| `npm test` | Menjalankan 14 skenario uji end-to-end di PostgreSQL sementara (tidak menyentuh Supabase) |

### Peran pengguna

| Peran | Akses |
|---|---|
| Pemilik | Semua menu, batal transaksi, setor modal, kelola pengguna |
| Kasir | Kasir (POS), riwayat penjualan, pelanggan, lihat stok |
| Gudang | Produk, stok, kedaluwarsa, purchase order |
| Keuangan | Kas, pengeluaran, hutang supplier, laba rugi, arus kas, penggajian |

## Deploy ke Supabase + Vercel

**Supabase**

1. Buat proyek baru di <https://supabase.com/dashboard>, pilih region **Singapore**, dan simpan password database.
2. Klik **Connect**, salin connection string **Transaction pooler** (port `6543`), ganti `[YOUR-PASSWORD]`, lalu tempel sebagai `DATABASE_URL` di `.env`.
3. Jalankan `npm run db:setup`. Skrip ini membuat tabel, mengisi data contoh, dan menutup akses Data API (RLS aktif, hak `anon` dan `authenticated` dicabut).

**Vercel**

1. Push repositori ini ke GitHub, lalu di <https://vercel.com/new> pilih **Import**. Preset Express terdeteksi otomatis.
2. Di **Environment Variables**, isi `DATABASE_URL` (sama dengan `.env`) dan `SESSION_SECRET` (teks acak panjang).
3. Klik **Deploy**. Function berjalan di region Singapore sesuai `vercel.json`.

**Catatan**

- Setelah online, ganti password akun contoh di menu **Pengguna Sistem** karena password bawaannya tertulis di `seed.js`.
- Proyek Supabase paket Free dijeda setelah 1 minggu tidak aktif. Buka dashboard Supabase dan aktifkan lagi sebelum demo.
- File `.env` tidak boleh di-commit (sudah ada di `.gitignore`).

## Modul & integrasi

| Modul | Fitur | Terhubung ke |
|---|---|---|
| **Penjualan (Kasir)** | Kasir tunai, cari/scan SKU, kembalian, nota cetak, pembatalan, pelanggan | Stok berkurang (FEFO) → kas bertambah → jurnal penjualan + HPP |
| **Persediaan** | Stok per batch, kartu stok, kedaluwarsa (FEFO), hapus barang rusak/kedaluwarsa, deteksi stok mati | Kerugian stok → beban di laba rugi; stok menipis → PO otomatis |
| **Pembelian** | Purchase order, PO otomatis dari stok menipis, penerimaan barang + tanggal kedaluwarsa, pembayaran | Stok bertambah, harga beli diperbarui, hutang & jurnal otomatis |
| **Keuangan** | Kas, pengeluaran per kategori, prive, setoran modal, hutang supplier, laporan laba rugi & arus kas | Menerima jurnal otomatis dari semua modul |
| **SDM** | Data karyawan, penggajian bulanan (gaji pokok) | Gaji dibayar → kas berkurang → beban gaji |
| **Sistem** | Login, hak akses per peran, kelola pengguna | — |

Semua modul memakai **satu database terpusat**. Tidak ada input jurnal manual: setiap transaksi operasional otomatis membentuk jurnal double-entry di belakang layar, sehingga laba rugi dan arus kas selalu sesuai dengan transaksi.

## Skenario demo end-to-end (±10 menit)

Jalankan `npm run seed` sebelum presentasi agar data segar.

1. **Login sebagai Pemilik**, buka **Dashboard**. Tunjukkan laba bersih, penjualan, saldo kas, stok menipis, kedaluwarsa, stok mati, dan "uang keluar bulan ini".
2. **Pembelian (Procure-to-Pay)**: klik **Buat PO otomatis**. Sistem membuat PO per supplier dengan jumlah berdasarkan rata-rata penjualan. Buka PO, isi tanggal kedaluwarsa, lalu **Terima barang**.
   - Tunjukkan: stok bertambah (Stok Barang/Kartu Stok) dan hutang muncul di **Hutang Supplier**.
   - Bayar hutang dari menu **Hutang Supplier**. Saldo kas berkurang.
3. **Penjualan (Order-to-Cash)**: buka **Kasir**, tambah beberapa barang, isi uang diterima, bayar, cetak nota.
   - Tunjukkan: stok berkurang di kartu stok dan penjualan muncul di dashboard.
4. **Penanganan kesalahan** (di Kasir):
   - Klik Saus Sambal: tidak bisa dijual karena kedaluwarsa.
   - Ubah jumlah melebihi stok: ditolak dengan pesan jelas.
   - Isi uang diterima kurang dari total: ditolak.
5. **Persediaan**: di **Kedaluwarsa & Rusak**, hapus Saus Sambal dari stok. Kerugian otomatis muncul di **Laba Rugi**.
6. **Keuangan**: catat pengeluaran listrik dan **Prive**. Coba pengeluaran melebihi saldo kas: ditolak.
7. **SDM**: buka **Penggajian** bulan berjalan, bayar gaji. Kas berkurang dan beban gaji masuk laba rugi.
8. **Laporan**: buka **Laba Rugi** dan **Arus Kas**, lalu cetak ke PDF.
9. **Hak akses**: logout, login sebagai Kasir. Menu terbatas; buka `/reports/profit-loss` → halaman 403.

## Struktur proyek

```
server.js               titik masuk aplikasi (Express)
seed.js                 data contoh 45 hari
scripts/db-setup.js     membuat tabel dan menyalin data contoh ke DATABASE_URL
src/schema.sql          skema database terpusat
src/db.js               koneksi PostgreSQL + transaksi atomik
src/services/           logika bisnis per modul (finance, inventory, purchasing, sales, hr, dashboard)
src/routes/             endpoint web per modul
src/views/              tampilan (EJS)
public/                 CSS, JavaScript, font, dan Chart.js (dilayani CDN di Vercel)
tests/e2e.test.js       pengujian end-to-end
```

Teknologi: Node.js, Express, EJS, PostgreSQL (Supabase), Chart.js. Deploy: Vercel.
