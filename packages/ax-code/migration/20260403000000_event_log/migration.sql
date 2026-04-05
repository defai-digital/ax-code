CREATE TABLE `event_log` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL REFERENCES `session`(`id`) ON DELETE CASCADE,
	`step_id` text,
	`event_type` text NOT NULL,
	`event_data` text NOT NULL,
	`sequence` integer NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `event_log_session_idx` ON `event_log` (`session_id`);
--> statement-breakpoint
CREATE INDEX `event_log_session_sequence_idx` ON `event_log` (`session_id`,`sequence`);
--> statement-breakpoint
CREATE INDEX `event_log_time_created_idx` ON `event_log` (`time_created`);
