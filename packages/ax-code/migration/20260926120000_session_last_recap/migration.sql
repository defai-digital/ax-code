-- Durable last recap (ADR-148): the most recent conversation recap generated
-- for a session, stored as a bounded display hint so the session picker can
-- show what a session was about before the user resumes it.
--
-- Presentation plane only, exactly as ADR-082 defines it: the value is never
-- model context, transcript content, compaction input, or evidence of
-- execution. It is server-owned (written only by SessionRecap.generate), never
-- written by session-update clients, and it deliberately does not bump
-- `time_updated` — generating a recap is not user activity and must not
-- reorder the session list.
--
-- Nullable so pre-existing sessions keep "no recap" and simply regenerate one
-- after their next settled turn. JSON payload:
--   { "text": string (<= 400 chars), "time": epoch ms, "scope": "turn" | "conversation" }
--
-- The session table lives in the registry database, not in per-project shards
-- (src/storage/shard.ts keeps message/part/event_log in shards), so this column
-- only needs the registry migration.

ALTER TABLE `session` ADD COLUMN `last_recap` text;
