-- Waiting-list signups from the landing page. Apply with:
--   npx wrangler d1 migrations apply resumeapplyr-signups --remote
CREATE TABLE IF NOT EXISTS signups (
  email      TEXT PRIMARY KEY,
  source     TEXT NOT NULL DEFAULT 'page',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
