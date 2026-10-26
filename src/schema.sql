-- =====================================================================
-- KelolaToko — skema database terpusat (satu database untuk semua modul)
-- Semua modul (Penjualan, Persediaan, Pembelian, Keuangan, SDM) membaca
-- dan menulis ke tabel yang sama sehingga data selalu konsisten.
-- Nilai uang disimpan dalam rupiah (bilangan bulat).
-- =====================================================================

-- ---------- Sistem & Pengguna ----------
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('owner','kasir','gudang','keuangan')),
  active        INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id),
  action     TEXT NOT NULL,
  detail     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ---------- Master Data (dipakai bersama oleh semua modul) ----------
CREATE TABLE IF NOT EXISTS categories (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS suppliers (
  id      INTEGER PRIMARY KEY,
  name    TEXT NOT NULL,
  phone   TEXT,
  address TEXT
);

CREATE TABLE IF NOT EXISTS customers (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  phone        TEXT,
  address      TEXT,
  credit_limit INTEGER NOT NULL DEFAULT 0   -- batas bon (0 = tidak boleh bon)
);

CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY,
  sku         TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id),
  supplier_id INTEGER REFERENCES suppliers(id),   -- supplier utama (untuk PO otomatis)
  unit        TEXT NOT NULL DEFAULT 'pcs',
  buy_price   INTEGER NOT NULL DEFAULT 0,         -- harga beli terakhir
  sell_price  INTEGER NOT NULL DEFAULT 0,
  min_stock   INTEGER NOT NULL DEFAULT 0,         -- titik pemesanan ulang
  active      INTEGER NOT NULL DEFAULT 1
);

-- ---------- Persediaan ----------
-- Stok disimpan per batch agar HPP akurat dan tanggal kedaluwarsa terlacak (FEFO).
CREATE TABLE IF NOT EXISTS batches (
  id            INTEGER PRIMARY KEY,
  product_id    INTEGER NOT NULL REFERENCES products(id),
  purchase_id   INTEGER REFERENCES purchases(id),
  qty_in        INTEGER NOT NULL,
  qty_remaining INTEGER NOT NULL CHECK (qty_remaining >= 0),
  unit_cost     INTEGER NOT NULL,
  expiry_date   TEXT,
  received_date TEXT NOT NULL
);

-- Kartu stok: setiap perubahan stok dari modul mana pun tercatat di sini.
CREATE TABLE IF NOT EXISTS stock_movements (
  id         INTEGER PRIMARY KEY,
  date       TEXT NOT NULL,
  product_id INTEGER NOT NULL REFERENCES products(id),
  batch_id   INTEGER REFERENCES batches(id),
  type       TEXT NOT NULL,
  qty        INTEGER NOT NULL,           -- positif = masuk, negatif = keluar
  unit_cost  INTEGER NOT NULL DEFAULT 0,
  ref_type   TEXT,
  ref_id     INTEGER,
  note       TEXT,
  user_id    INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS stock_opnames (
  id           INTEGER PRIMARY KEY,
  date         TEXT NOT NULL,
  product_id   INTEGER NOT NULL REFERENCES products(id),
  system_qty   INTEGER NOT NULL,
  physical_qty INTEGER NOT NULL,
  difference   INTEGER NOT NULL,
  value        INTEGER NOT NULL DEFAULT 0,
  note         TEXT,
  user_id      INTEGER REFERENCES users(id)
);

-- ---------- Pembelian ----------
CREATE TABLE IF NOT EXISTS purchases (
  id            INTEGER PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,
  supplier_id   INTEGER NOT NULL REFERENCES suppliers(id),
  order_date    TEXT NOT NULL,
  due_date      TEXT,
  received_date TEXT,
  status        TEXT NOT NULL CHECK (status IN ('draf','dipesan','diterima','batal')),
  total         INTEGER NOT NULL DEFAULT 0,
  paid          INTEGER NOT NULL DEFAULT 0,
  note          TEXT,
  user_id       INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS purchase_items (
  id          INTEGER PRIMARY KEY,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id  INTEGER NOT NULL REFERENCES products(id),
  qty         INTEGER NOT NULL CHECK (qty > 0),
  unit_cost   INTEGER NOT NULL CHECK (unit_cost >= 0),
  expiry_date TEXT
);

-- ---------- Penjualan ----------
CREATE TABLE IF NOT EXISTS sales (
  id             INTEGER PRIMARY KEY,
  code           TEXT NOT NULL UNIQUE,
  date           TEXT NOT NULL,
  customer_id    INTEGER REFERENCES customers(id),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('tunai','kredit')),
  subtotal       INTEGER NOT NULL,
  discount       INTEGER NOT NULL DEFAULT 0,
  total          INTEGER NOT NULL,
  cogs           INTEGER NOT NULL DEFAULT 0,   -- HPP (dihitung dari batch FEFO)
  paid           INTEGER NOT NULL DEFAULT 0,
  cash_received  INTEGER NOT NULL DEFAULT 0,
  due_date       TEXT,
  status         TEXT NOT NULL CHECK (status IN ('selesai','batal')),
  note           TEXT,
  user_id        INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS sale_items (
  id         INTEGER PRIMARY KEY,
  sale_id    INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty        INTEGER NOT NULL CHECK (qty > 0),
  price      INTEGER NOT NULL,
  cogs       INTEGER NOT NULL DEFAULT 0
);

-- Pembayaran hutang (ke supplier) & piutang (dari pelanggan)
CREATE TABLE IF NOT EXISTS payments (
  id         INTEGER PRIMARY KEY,
  date       TEXT NOT NULL,
  direction  TEXT NOT NULL CHECK (direction IN ('masuk','keluar')),
  ref_type   TEXT NOT NULL CHECK (ref_type IN ('purchase','sale')),
  ref_id     INTEGER NOT NULL,
  amount     INTEGER NOT NULL CHECK (amount > 0),
  note       TEXT,
  user_id    INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ---------- Keuangan / Akuntansi ----------
CREATE TABLE IF NOT EXISTS accounts (
  code   TEXT PRIMARY KEY,
  name   TEXT NOT NULL,
  type   TEXT NOT NULL CHECK (type IN ('aset','kewajiban','modal','pendapatan','hpp','beban')),
  normal TEXT NOT NULL CHECK (normal IN ('D','K'))
);

CREATE TABLE IF NOT EXISTS journals (
  id          INTEGER PRIMARY KEY,
  date        TEXT NOT NULL,
  description TEXT NOT NULL,
  ref_type    TEXT,
  ref_id      INTEGER,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS journal_lines (
  id           INTEGER PRIMARY KEY,
  journal_id   INTEGER NOT NULL REFERENCES journals(id) ON DELETE CASCADE,
  account_code TEXT NOT NULL REFERENCES accounts(code),
  debit        INTEGER NOT NULL DEFAULT 0,
  credit       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS expenses (
  id           INTEGER PRIMARY KEY,
  date         TEXT NOT NULL,
  account_code TEXT NOT NULL REFERENCES accounts(code),
  amount       INTEGER NOT NULL CHECK (amount > 0),
  description  TEXT NOT NULL,
  user_id      INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ---------- SDM ----------
CREATE TABLE IF NOT EXISTS employees (
  id              INTEGER PRIMARY KEY,
  name            TEXT NOT NULL,
  position        TEXT NOT NULL,
  phone           TEXT,
  base_salary     INTEGER NOT NULL DEFAULT 0,
  daily_allowance INTEGER NOT NULL DEFAULT 0,   -- uang makan per hari hadir
  join_date       TEXT,
  active          INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS attendance (
  id          INTEGER PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  date        TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('hadir','izin','sakit','alpa')),
  UNIQUE (employee_id, date)
);

CREATE TABLE IF NOT EXISTS payrolls (
  id           INTEGER PRIMARY KEY,
  period       TEXT NOT NULL,           -- YYYY-MM
  employee_id  INTEGER NOT NULL REFERENCES employees(id),
  base_salary  INTEGER NOT NULL,
  days_present INTEGER NOT NULL,
  allowance    INTEGER NOT NULL,
  deduction    INTEGER NOT NULL,
  net          INTEGER NOT NULL,
  paid_date    TEXT NOT NULL,
  journal_id   INTEGER REFERENCES journals(id),
  UNIQUE (period, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_batches_product   ON batches(product_id, qty_remaining);
CREATE INDEX IF NOT EXISTS idx_moves_product     ON stock_movements(product_id, date);
CREATE INDEX IF NOT EXISTS idx_sales_date        ON sales(date, status);
CREATE INDEX IF NOT EXISTS idx_sale_items_prod   ON sale_items(product_id);
CREATE INDEX IF NOT EXISTS idx_journal_date      ON journals(date);
CREATE INDEX IF NOT EXISTS idx_journal_ref       ON journals(ref_type, ref_id);
CREATE INDEX IF NOT EXISTS idx_jlines_account    ON journal_lines(account_code);
CREATE INDEX IF NOT EXISTS idx_attendance_date   ON attendance(date);
