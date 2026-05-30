ALTER TABLE `workflow_run` ADD `source_task_id` text;
--> statement-breakpoint
CREATE INDEX `workflow_run_source_task_idx` ON `workflow_run` (`source_task_id`);
