# KelolaToko — Sistem ERP Toko Sembako AMART

Aplikasi ERP berbasis web untuk toko sembako/minimarket kecil. Dibuat untuk tugas UTS mata kuliah Sistem Informasi Enterprise.

**Masalah bisnis yang diselesaikan**

1. Pemilik tidak tahu uang keluar ke mana dan pemasukan sebenarnya berapa.
2. Modal tertahan di **stok mati** (barang tidak laku) dan barang kedaluwarsa, salah satu penyebab warung bangkrut.
3. Stok sering kosong saat dicari pembeli, bon pelanggan dan hutang supplier tidak tercatat rapi.

## Cara menjalankan

Prasyarat: **Node.js 22.13 atau lebih baru** (database SQLite sudah bawaan Node.js, tidak perlu XAMPP/MySQL).

```bash
npm install
```

```bash
npm start
```

Buka <http://localhost:3000>. Saat pertama dijalankan, database `data/erp.db` otomatis terisi data contoh 45 hari terakhir.

| Perintah | Fungsi |
|---|---|
| `npm start` | Menjalankan aplikasi |
| `npm run seed` | Menghapus database dan mengisi ulang data contoh (pakai sebelum demo) |
| `npm test` | Menjalankan 12 skenario uji end-to-end di database sementara |

### Peran pengguna

| Peran | Akses |
|---|---|
| Pemilik | Semua menu, batal transaksi, setor modal, kelola pengguna |
| Kasir | Kasir (POS), riwayat penjualan, pelanggan, lihat stok |
| Gudang | Produk, stok, kedaluwarsa, opname, purchase order |
| Keuangan | Kas, pengeluaran, hutang/piutang, jurnal, SDM, laporan |

## Modul & integrasi

| Modul | Fitur | Terhubung ke |
|---|---|---|
| **Penjualan (POS)** | Kasir, cari/scan SKU, tunai & bon, diskon, kembalian, nota cetak, pembatalan | Stok berkurang (FEFO) → kas/piutang → jurnal penjualan + HPP |
| **Persediaan** | Stok per batch, kartu stok, kedaluwarsa (FEFO), hapus barang rusak/kedaluwarsa, stok opname, analisis stok mati & perputaran | Kerugian stok → beban di laba rugi; stok menipis → PO otomatis |
| **Pembelian** | Purchase order, PO otomatis dari stok menipis, penerimaan barang + tanggal kedaluwarsa, pembayaran | Stok bertambah, harga beli diperbarui, hutang & jurnal otomatis |
| **Keuangan** | Kas, pengeluaran per kategori, prive, setoran modal, hutang supplier, piutang/bon, jurnal umum otomatis | Menerima jurnal dari semua modul |
| **SDM** | Data karyawan, absensi harian, penggajian otomatis dari absensi | Gaji dibayar → kas berkurang → beban gaji |
| **Laporan** | Laba rugi, neraca, arus kas, penjualan per produk/hari/kasir, persediaan & perputaran | Semua dari satu database |
| **Sistem** | Login, hak akses per peran, log aktivitas | — |

Semua modul memakai **satu database terpusat**. Tidak ada input jurnal manual: setiap transaksi operasional otomatis membentuk jurnal double-entry, sehingga neraca selalu seimbang.

## Skenario demo end-to-end (±10 menit)

Jalankan `npm run seed` sebelum presentasi agar data segar.

1. **Login sebagai Pemilik**, buka **Dashboard**. Tunjukkan penjualan, laba bersih, saldo kas, grafik "uang keluar ke mana", stok menipis, kedaluwarsa, dan stok mati.
2. **Pembelian (Procure-to-Pay)**: klik **Buat PO otomatis**. Sistem membuat PO draf per supplier dengan jumlah berdasarkan rata-rata penjualan. Buka PO, klik **Kirim ke supplier**, isi tanggal kedaluwarsa, lalu **Terima barang**.
   - Tunjukkan: stok bertambah (Stok Barang/Kartu Stok), hutang muncul di **Hutang Supplier**, jurnal "Persediaan / Hutang" di **Jurnal Umum**.
   - Bayar hutang dari menu **Hutang Supplier**. Saldo kas berkurang.
3. **Penjualan (Order-to-Cash)**: buka **Kasir (POS)**, tambah beberapa barang, bayar tunai, cetak nota.
   - Tunjukkan: stok berkurang di kartu stok, jurnal Kas/Penjualan dan HPP/Persediaan.
   - Buat penjualan **bon** untuk "Bu Sari", lalu terima pembayarannya di **Piutang (Bon)**.
4. **Penanganan kesalahan** (di POS):
   - Klik Saus Sambal: tidak bisa dijual karena kedaluwarsa.
   - Ubah jumlah melebihi stok: ditolak dengan pesan jelas.
   - Pilih bon tanpa pelanggan, atau pelanggan "Mas Dedi" (limit 0): ditolak.
5. **Persediaan**: di **Kedaluwarsa & Rusak**, hapus Saus Sambal dari stok. Kerugian otomatis muncul di **Laba Rugi**. Lakukan **Stok Opname** dengan selisih.
6. **Keuangan**: catat pengeluaran listrik dan **Prive**. Coba pengeluaran melebihi saldo kas: ditolak.
7. **SDM**: isi **Absensi** hari ini, buka **Penggajian** bulan berjalan, bayar gaji. Beban gaji masuk laba rugi.
8. **Laporan**: buka Laba Rugi, Neraca (tunjukkan status *seimbang*), Arus Kas, dan Persediaan (perputaran & stok mati). Cetak ke PDF.
9. **Hak akses**: logout, login sebagai Kasir. Menu terbatas; buka `/reports/profit-loss` → halaman 403.
10. **Log Aktivitas** (pemilik): semua aksi tadi tercatat beserta pelakunya.

## Struktur proyek

```
server.js               titik masuk aplikasi (Express)
seed.js                 data contoh 45 hari
src/schema.sql          skema database terpusat
src/db.js               koneksi SQLite + transaksi atomik
src/services/           logika bisnis per modul (finance, inventory, purchasing, sales, hr, dashboard)
src/routes/             endpoint web per modul
src/views/              tampilan (EJS)
public/                 CSS & JavaScript sisi klien
tests/e2e.test.js       pengujian end-to-end
```

Teknologi: Node.js, Express, EJS, SQLite (`node:sqlite`), Chart.js.
