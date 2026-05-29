CREATE TABLE `task_queue` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `session_id` text,
  `directory` text NOT NULL,
  `kind` text NOT NULL,
  `status` text NOT NULL,
  `priority` integer DEFAULT 0 NOT NULL,
  `position` integer NOT NULL,
  `title` text NOT NULL,
  `agent` text,
  `model` text,
  `source_message_id` text,
  `source_task_id` text,
  `payload` text NOT NULL,
  `error` text,
  `time_started` integer,
  `time_completed` integer,
  `time_created` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
  `time_updated` integer,
  FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `task_queue_project_position_idx` ON `task_queue` (`project_id`,`position`,`id`);
--> statement-breakpoint
CREATE INDEX `task_queue_project_status_idx` ON `task_queue` (`project_id`,`status`);
--> statement-breakpoint
CREATE INDEX `task_queue_session_idx` ON `task_queue` (`session_id`);
