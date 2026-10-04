-- Weekly discovery: each user's list of suggested artists/tracks that are NOT in the library
-- (names only — the app never provides a source or link, see CLAUDE.md principle 2).
-- One row per user per week; `week` is the Monday (UTC) of that week as YYYY-MM-DD, `items` a JSON array.
CREATE TABLE weekly_discovery (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week       TEXT    NOT NULL,
  items      TEXT    NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, week)
);
