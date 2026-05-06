CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  ic TEXT,
  phone TEXT,
  address TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pawn_tickets (
  id TEXT PRIMARY KEY,
  ticket_no TEXT NOT NULL UNIQUE,
  customer_id TEXT NOT NULL,
  principal REAL NOT NULL DEFAULT 0,
  remaining_principal REAL NOT NULL DEFAULT 0,
  gold_price REAL NOT NULL DEFAULT 0,
  rate REAL NOT NULL DEFAULT 0,
  rate_mode TEXT NOT NULL DEFAULT 'month',
  start_date TEXT NOT NULL,
  tenure INTEGER NOT NULL DEFAULT 6,
  status TEXT NOT NULL DEFAULT 'active',
  image_path TEXT,
  ocr_raw_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS ticket_items (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  description TEXT NOT NULL,
  weight_gram REAL NOT NULL DEFAULT 0,
  value REAL NOT NULL DEFAULT 0,
  redeemed INTEGER NOT NULL DEFAULT 0,
  redeemed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(ticket_id) REFERENCES pawn_tickets(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  type TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  upah_amount REAL NOT NULL DEFAULT 0,
  total_paid REAL NOT NULL DEFAULT 0,
  item_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(ticket_id) REFERENCES pawn_tickets(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pawn_tickets_customer ON pawn_tickets(customer_id);
CREATE INDEX IF NOT EXISTS idx_ticket_items_ticket ON ticket_items(ticket_id);
CREATE INDEX IF NOT EXISTS idx_transactions_ticket ON transactions(ticket_id);
