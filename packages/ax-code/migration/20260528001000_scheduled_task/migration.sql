CREATE TABLE `scheduled_task` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `directory` text NOT NULL,
  `title` text NOT NULL,
  `prompt` text NOT NULL,
  `schedule` text NOT NULL,
  `status` text NOT NULL,
  `agent` text,
  `model` text,
  `last_queue_id` text,
  `error` text,
  `next_run_at` integer,
  `last_run_at` integer,
  `time_created` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
  `time_updated` integer,
  FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`last_queue_id`) REFERENCES `task_queue`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `scheduled_task_project_status_idx` ON `scheduled_task` (`project_id`,`status`);
--> statement-breakpoint
CREATE INDEX `scheduled_task_project_next_run_idx` ON `scheduled_task` (`project_id`,`next_run_at`);
