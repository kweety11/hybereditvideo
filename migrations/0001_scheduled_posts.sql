-- Scheduled social-media posts queue.
-- Apply with: npx wrangler d1 execute <DB> --file=./migrations/0001_scheduled_posts.sql
-- (The worker also creates this table on demand via ensureSchema().)

CREATE TABLE IF NOT EXISTS scheduled_posts (
  id          TEXT PRIMARY KEY,
  caption     TEXT NOT NULL,
  hashtags    TEXT NOT NULL DEFAULT '[]',   -- JSON array of strings
  videoUrl    TEXT NOT NULL,                -- publicly reachable video URL
  platforms   TEXT NOT NULL DEFAULT '[]',   -- JSON array: instagram|facebook|tiktok
  scheduledAt INTEGER NOT NULL,             -- unix epoch (ms)
  status      TEXT NOT NULL DEFAULT 'pending', -- pending|published|partial|failed
  results     TEXT,                         -- JSON array of per-platform results
  error       TEXT,
  createdAt   INTEGER NOT NULL,
  publishedAt INTEGER
);

CREATE INDEX IF NOT EXISTS idx_scheduled_posts_due
  ON scheduled_posts (status, scheduledAt);
