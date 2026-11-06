// Menu navigasi. Setiap item hanya tampil untuk peran yang berhak (pemilik melihat semuanya).
const NAV = [
  { group: null, items: [{ label: 'Dashboard', href: '/', icon: 'home', roles: ['kasir', 'gudang', 'keuangan'] }] },
  {
    group: 'Penjualan',
    items: [
      { label: 'Kasir', href: '/pos', icon: 'cart', roles: ['kasir'] },
      { label: 'Riwayat Penjualan', href: '/sales', icon: 'receipt', roles: ['kasir', 'keuangan'] },
      { label: 'Pelanggan', href: '/master/customers', icon: 'users', roles: ['kasir', 'keuangan'] },
    ],
  },
  {
    group: 'Persediaan',
    items: [
      { label: 'Stok Barang', href: '/inventory', icon: 'box', roles: ['gudang', 'kasir'] },
      { label: 'Kedaluwarsa & Rusak', href: '/inventory/batches', icon: 'alert', roles: ['gudang'] },
      { label: 'Produk', href: '/master/products', icon: 'tag', roles: ['gudang'] },
    ],
  },
  {
    group: 'Pembelian',
    items: [
      { label: 'Purchase Order', href: '/purchases', icon: 'truck', roles: ['gudang', 'keuangan'] },
      { label: 'Supplier', href: '/master/suppliers', icon: 'building', roles: ['gudang', 'keuangan'] },
    ],
  },
  {
    group: 'Keuangan',
    items: [
      { label: 'Kas & Pengeluaran', href: '/finance/expenses', icon: 'wallet', roles: ['keuangan'] },
      { label: 'Hutang Supplier', href: '/finance/payables', icon: 'arrow-up', roles: ['keuangan'] },
      { label: 'Laba Rugi', href: '/reports/profit-loss', icon: 'chart', roles: ['keuangan'] },
      { label: 'Arus Kas', href: '/reports/cash-flow', icon: 'flow', roles: ['keuangan'] },
    ],
  },
  {
    group: 'SDM',
    items: [
      { label: 'Karyawan', href: '/master/employees', icon: 'id', roles: ['keuangan'] },
      { label: 'Penggajian', href: '/hr/payroll', icon: 'cash', roles: ['keuangan'] },
    ],
  },
  {
    group: 'Sistem',
    items: [{ label: 'Pengguna', href: '/master/users', icon: 'key', roles: [] }],
  },
];

module.exports = { NAV };
