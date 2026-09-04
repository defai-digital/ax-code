-- Cloud Operations Mode storage (PRD-2026-09-04-cloud-operations-mode, slice 1).
--
-- Three NEW tables, project-scoped with cascade on project delete:
--
--   operation_plan   — the human-reviewable plan registry. canonical_json +
--                      canonical_hash (sha256) is what ops_approve pins, so
--                      args drift is detectable. origin_session_id is recorded
--                      for correlation only (no FK): plans are the durable
--                      safety record for state pushed outside the git
--                      worktree and must survive session deletion. Unique
--                      (project_id, canonical_hash) dedupes identical plans.
--   operation_journal — append-only event log (planned/approved/executed/
--                      verified/rolled_back/failed/aborted). Deliberately NO
--                      time_updated: rows are immutable once written.
--                      entry_hash chains payload + prev_entry_hash so history
--                      tampering is detectable (OperationJournal.verifyChain).
--                      session_id is audit-only, no FK.
--   operation_token  — single-use approval tokens. Only the sha256 of the
--                      opaque bearer is stored; redemption is an atomic
--                      conditional UPDATE (consumed_at IS NULL AND
--                      expires_at >= now), never a plan-blob read-modify-write.
--                      Expiry is lazy at consume time; pruneExpired is
--                      best-effort cleanup.

CREATE TABLE `operation_plan` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`canonical_json` text NOT NULL,
	`canonical_hash` text NOT NULL,
	`origin_session_id` text,
	`supersedes_plan_id` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_operation_plan_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `operation_journal` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`actor` text NOT NULL,
	`status` text NOT NULL,
	`before_snapshot_ref` text,
	`after_snapshot_ref` text,
	`plan_canonical_hash` text NOT NULL,
	`payload_json` text NOT NULL,
	`entry_hash` text NOT NULL,
	`prev_entry_hash` text,
	`session_id` text,
	`time_created` integer NOT NULL,
	CONSTRAINT `fk_operation_journal_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_operation_journal_plan_id_operation_plan_id_fk` FOREIGN KEY (`plan_id`) REFERENCES `operation_plan`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `operation_token` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`purpose` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_operation_token_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_operation_token_plan_id_operation_plan_id_fk` FOREIGN KEY (`plan_id`) REFERENCES `operation_plan`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `operation_plan_project_hash_idx` ON `operation_plan` (`project_id`,`canonical_hash`);
--> statement-breakpoint
CREATE INDEX `operation_plan_project_status_idx` ON `operation_plan` (`project_id`,`status`);
--> statement-breakpoint
CREATE INDEX `operation_plan_origin_session_idx` ON `operation_plan` (`origin_session_id`);
--> statement-breakpoint
CREATE INDEX `operation_journal_plan_sequence_idx` ON `operation_journal` (`plan_id`,`sequence`);
--> statement-breakpoint
CREATE INDEX `operation_journal_project_status_idx` ON `operation_journal` (`project_id`,`status`);
--> statement-breakpoint
CREATE INDEX `operation_journal_project_created_idx` ON `operation_journal` (`project_id`,`time_created`,`id`);
--> statement-breakpoint
CREATE INDEX `operation_journal_plan_entry_hash_idx` ON `operation_journal` (`plan_id`,`entry_hash`);
--> statement-breakpoint
CREATE UNIQUE INDEX `operation_token_hash_idx` ON `operation_token` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `operation_token_plan_idx` ON `operation_token` (`plan_id`);
--> statement-breakpoint
CREATE INDEX `operation_token_expires_idx` ON `operation_token` (`expires_at`);
