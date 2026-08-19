-- Phase 2 slice 2: track the shard's backfill coverage version so a project
-- that was backfilled under an earlier slice (e.g. message/part only) re-runs
-- the extended copy when a later slice adds another table (event_log). Existing
-- rows default to 0, which is < the runtime BACKFILL_VERSION, so any previously
-- "active" shard is treated as stale on next access and re-backfilled
-- (idempotently). See src/session/shard.ts for the runtime.

ALTER TABLE `project_shard` ADD COLUMN `backfill_version` integer NOT NULL DEFAULT 0;
