ALTER TABLE `scheduled_task` ADD `workflow_template_id` text;
--> statement-breakpoint
ALTER TABLE `scheduled_task` ADD `workflow_start_options` text;
--> statement-breakpoint
ALTER TABLE `scheduled_task` ADD `last_workflow_run_id` text;
