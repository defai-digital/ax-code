-- Pinned messages (ADR-226): user-pinned message texts that must survive a
-- compaction verbatim, re-sent as one background-context block after the
-- summary replaces the transcript.
--
-- User content, not an execution artifact: the text is captured at pin time so
-- the block can be re-sent without re-reading the message, and `messageID` ties
-- the pin to its source so a revert drops it and a fork remaps it.
--
-- Nullable so pre-existing sessions simply carry no pins. JSON payload:
--   [ { "messageID": string, "text": string (<= 4000 chars) } ]   (max 8 pins)
--
-- The session table lives in the registry database, not in per-project shards
-- (src/storage/shard.ts keeps message/part/event_log in shards), so this column
-- only needs the registry migration.

ALTER TABLE `session` ADD COLUMN `pins` text;
