ALTER TABLE `scheduled_task` ADD `catch_up_policy` text NOT NULL DEFAULT 'run_once';
--> statement-breakpoint
ALTER TABLE `scheduled_task` ADD `max_run_duration_ms` integer;
--> statement-breakpoint
ALTER TABLE `task_queue` ADD `execution_timeout_ms` integer;
