CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  source TEXT,
  url TEXT,
  title TEXT,
  summary TEXT,
  published_at TEXT,
  first_seen_at TEXT,
  occurred_at TEXT,
  raw_json TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  title TEXT,
  title_zh TEXT,
  overview_zh TEXT,
  category TEXT,
  value REAL,
  json TEXT,
  occurred_at TEXT,
  published_at TEXT,
  first_seen_at TEXT,
  updated_at TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS event_members (
  event_id TEXT,
  article_id TEXT,
  PRIMARY KEY (event_id, article_id)
);

CREATE TABLE IF NOT EXISTS article_event_map (
  article_id TEXT PRIMARY KEY,
  event_id TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS preferences (
  id TEXT PRIMARY KEY,
  json TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  event_id TEXT,
  kind TEXT,
  json TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS reads (
  event_id TEXT PRIMARY KEY,
  read_at TEXT
);

CREATE TABLE IF NOT EXISTS favorites (
  event_id TEXT PRIMARY KEY,
  snapshot_json TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  kind TEXT,
  status TEXT,
  lock_until TEXT,
  json TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS cache_entries (
  key TEXT PRIMARY KEY,
  value TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  event_id TEXT,
  channel TEXT,
  status TEXT,
  json TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS source_health (
  source TEXT PRIMARY KEY,
  json TEXT
);

CREATE TABLE IF NOT EXISTS snapshots (
  name TEXT PRIMARY KEY,
  json TEXT,
  at TEXT
);
