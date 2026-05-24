CREATE TABLE `prompt_history` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `directory` text NOT NULL,
  `mode` text,
  `input` text NOT NULL,
  `parts` text NOT NULL,
  `time_created` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
  `time_updated` integer,
  FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `prompt_history_project_time_idx` ON `prompt_history` (`project_id`,`time_created`,`id`);
