CREATE TABLE IF NOT EXISTS reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL,
  name TEXT NOT NULL,
  surname TEXT NOT NULL,
  phone TEXT NOT NULL,
  phone_norm TEXT NOT NULL,
  email TEXT,
  seats INTEGER NOT NULL,
  payment_method TEXT NOT NULL,
  paid INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  reminder_sent INTEGER NOT NULL DEFAULT 0,
  arrived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_res_session ON reservations(session_id);
CREATE INDEX IF NOT EXISTS idx_res_phone ON reservations(phone_norm);
CREATE TABLE IF NOT EXISTS hits (
  kind TEXT NOT NULL,
  ip TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hits ON hits(kind, ip, ts);
CREATE TABLE IF NOT EXISTS waitlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  email TEXT NOT NULL,
  name TEXT,
  notified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wait_session ON waitlist(session_id);
