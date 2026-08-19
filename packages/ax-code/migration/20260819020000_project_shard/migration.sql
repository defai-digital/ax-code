-- Phase 2 (per-project DB sharding): project_shard is the registry-side index
-- mapping a project to its shard file plus the lazy backfill state machine.
-- `state` progresses none -> backfilling -> active; writes only land on the
-- shard once `state` is `active`. See src/storage/shard.ts for the runtime.

CREATE TABLE `project_shard` (
	`project_id` text PRIMARY KEY NOT NULL,
	`shard_file` text NOT NULL,
	`state` text NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `project_shard_state_check` CHECK (`state` IN ('none', 'backfilling', 'active'))
);
