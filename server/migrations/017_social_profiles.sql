-- Social features: profiles and an opt-in "now listening".
-- show_listening is 0 (nobody) by default — a user must turn it on themselves. avatar_path is a
-- normalised JPEG in the covers directory. The admin can switch the whole feature off with the
-- `social_enabled` setting ('false').
ALTER TABLE users ADD COLUMN display_name TEXT;
ALTER TABLE users ADD COLUMN bio TEXT;
ALTER TABLE users ADD COLUMN avatar_path TEXT;
ALTER TABLE users ADD COLUMN show_listening INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN avatar_updated_at INTEGER;
