CREATE TABLE `session_goal` (
  `session_id` text PRIMARY KEY NOT NULL,
  `objective` text NOT NULL,
  `status` text NOT NULL,
  `token_budget` integer,
  `tokens_used` integer DEFAULT 0 NOT NULL,
  `time_used_seconds` integer DEFAULT 0 NOT NULL,
  `time_created` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
  `time_updated` integer,
  CONSTRAINT `session_goal_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `session_goal_status_idx` ON `session_goal` (`status`);
