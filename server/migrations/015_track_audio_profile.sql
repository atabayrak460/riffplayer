-- Audio quality details (Hi-Fi features): bit depth, channel count, codec and
-- whether the codec is lossless. sample_rate has existed since 001 but was
-- never exposed. All nullable: rows scanned before this migration are
-- re-read once by the next scan (see the `channels IS NULL` check in
-- indexer/scan.ts), which fills these in without a full rebuild.
ALTER TABLE tracks ADD COLUMN bit_depth INTEGER;
ALTER TABLE tracks ADD COLUMN channels INTEGER;
ALTER TABLE tracks ADD COLUMN codec TEXT;
ALTER TABLE tracks ADD COLUMN lossless INTEGER;
