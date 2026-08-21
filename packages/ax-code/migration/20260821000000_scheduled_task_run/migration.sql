-- Scheduled-task run history (ADR-059, PRD-2026-08-21-scheduled-task-best-practices).
-- One row per scheduled-task occurrence (fired / skipped / coalesced / failed) so
-- the headless scheduler is auditable and overlap protection / failure backoff can
-- be DERIVED from history instead of adding columns to `scheduled_task`. This is a
-- NEW table (not an ALTER) because per-project shards apply CREATE TABLE IF NOT
-- EXISTS DDL on open and have no ALTER path. `status='running'` is the only
-- non-terminal state; terminal transitions are guarded by queue_id and idempotent.

CREATE TABLE `scheduled_task_run` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`project_id` text NOT NULL,
	`trigger_type` text NOT NULL,
	`status` text NOT NULL,
	`occurrence_at` integer,
	`coalesced_count` integer NOT NULL DEFAULT 1,
	`queue_id` text,
	`workflow_run_id` text,
	`error` text,
	`time_started` integer,
	`time_completed` integer,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_scheduled_task_run_task_id_scheduled_task_id_fk` FOREIGN KEY (`task_id`) REFERENCES `scheduled_task`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_scheduled_task_run_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_scheduled_task_run_queue_id_task_queue_id_fk` FOREIGN KEY (`queue_id`) REFERENCES `task_queue`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `scheduled_task_run_task_created_idx` ON `scheduled_task_run` (`task_id`,`time_created`,`id`);
--> statement-breakpoint
CREATE INDEX `scheduled_task_run_queue_idx` ON `scheduled_task_run` (`queue_id`);
