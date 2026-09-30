-- Additive and repeatable read-path indexes (CREATE INDEX IF NOT EXISTS is
-- safe on fresh and existing databases: no ALTER, no backfill; SQLite builds
-- the index over existing rows on first run and no-ops afterwards).
CREATE INDEX IF NOT EXISTS events_reader_source ON events(json_extract(json, '$.source'), category);
CREATE INDEX IF NOT EXISTS events_recency ON events(COALESCE(NULLIF(published_at, ''), NULLIF(first_seen_at, ''), created_at) DESC);
