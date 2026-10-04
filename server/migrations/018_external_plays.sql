-- Listening history imported from other services (Spotify, Apple Music, Last.fm) so a user's Wrapped
-- covers the whole year, including songs that are not in this library. Only the user's own
-- listening data lives here: names and times, never audio or a source. track_id is set when the
-- play matches a library track (and is cleared if that track is later removed).
-- dedupe_key makes re-importing the same export harmless.
CREATE TABLE external_plays (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source      TEXT    NOT NULL,
  artist      TEXT    NOT NULL,
  title       TEXT    NOT NULL,
  album       TEXT,
  played_at   INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  track_id    INTEGER REFERENCES tracks(id) ON DELETE SET NULL,
  dedupe_key  TEXT    NOT NULL,
  UNIQUE (user_id, dedupe_key)
);

CREATE INDEX idx_external_plays_user_time ON external_plays(user_id, played_at);
