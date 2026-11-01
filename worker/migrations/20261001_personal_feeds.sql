-- Additive, repeatable: account-scoped custom RSS feeds and their items.
-- Item data lives ONLY here — never in the shared events/articles tables,
-- public catalog, digest snapshots or the generic sync/export path.
CREATE TABLE IF NOT EXISTS user_feeds (
  user_id TEXT NOT NULL,
  feed_id TEXT NOT NULL,
  url TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  paused INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_refresh_at TEXT,
  last_attempt_at TEXT,
  last_error TEXT,
  PRIMARY KEY (user_id, feed_id)
);
CREATE INDEX IF NOT EXISTS user_feeds_user ON user_feeds(user_id, created_at);

CREATE TABLE IF NOT EXISTS user_feed_items (
  user_id TEXT NOT NULL,
  feed_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  key TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  summary TEXT,
  published_at TEXT,
  first_seen_at TEXT,
  PRIMARY KEY (user_id, feed_id, item_id)
);
CREATE INDEX IF NOT EXISTS user_feed_items_user ON user_feed_items(user_id, feed_id, published_at);
