CREATE TABLE `debug_engine_embedding_cache` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`node_id` text NOT NULL,
	`signature_hash` text NOT NULL,
	`model_id` text NOT NULL,
	`embedding` blob NOT NULL,
	`dim` integer NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_debug_engine_embedding_cache_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `debug_engine_refactor_plan` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`summary` text NOT NULL,
	`edits` text NOT NULL,
	`affected_files` text NOT NULL,
	`affected_symbols` text NOT NULL,
	`risk` text NOT NULL,
	`status` text NOT NULL,
	`graph_cursor_at_creation` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_debug_engine_refactor_plan_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_session` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`parent_id` text,
	`slug` text NOT NULL,
	`directory` text NOT NULL,
	`title` text NOT NULL,
	`version` text NOT NULL,
	`share_url` text,
	`summary_additions` integer,
	`summary_deletions` integer,
	`summary_files` integer,
	`summary_diffs` text,
	`revert` text,
	`permission` text,
	`workspace_id` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	`time_compacting` integer,
	`time_archived` integer,
	CONSTRAINT `fk_session_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_session_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
INSERT INTO `__new_session`(`id`, `project_id`, `parent_id`, `slug`, `directory`, `title`, `version`, `share_url`, `summary_additions`, `summary_deletions`, `summary_files`, `summary_diffs`, `revert`, `permission`, `workspace_id`, `time_created`, `time_updated`, `time_compacting`, `time_archived`) SELECT `id`, `project_id`, `parent_id`, `slug`, `directory`, `title`, `version`, `share_url`, `summary_additions`, `summary_deletions`, `summary_files`, `summary_diffs`, `revert`, `permission`, `workspace_id`, `time_created`, `time_updated`, `time_compacting`, `time_archived` FROM `session`;--> statement-breakpoint
DROP TABLE `session`;--> statement-breakpoint
ALTER TABLE `__new_session` RENAME TO `session`;--> statement-breakpoint
CREATE INDEX `session_project_idx` ON `session` (`project_id`);--> statement-breakpoint
CREATE INDEX `session_parent_idx` ON `session` (`parent_id`);--> statement-breakpoint
CREATE INDEX `session_workspace_idx` ON `session` (`workspace_id`);--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_workspace` (
	`id` text PRIMARY KEY,
	`branch` text,
	`project_id` text NOT NULL,
	`type` text NOT NULL,
	`name` text,
	`directory` text,
	`extra` text,
	CONSTRAINT `fk_workspace_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__new_workspace`(`id`, `branch`, `project_id`, `type`, `name`, `directory`, `extra`) SELECT `id`, `branch`, `project_id`, `type`, `name`, `directory`, `extra` FROM `workspace`;--> statement-breakpoint
DROP TABLE `workspace`;--> statement-breakpoint
ALTER TABLE `__new_workspace` RENAME TO `workspace`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_part` (
	`id` text PRIMARY KEY,
	`message_id` text NOT NULL,
	`session_id` text NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	`data` text NOT NULL,
	CONSTRAINT `fk_part_message_id_message_id_fk` FOREIGN KEY (`message_id`) REFERENCES `message`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_part_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__new_part`(`id`, `message_id`, `session_id`, `time_created`, `time_updated`, `data`) SELECT `id`, `message_id`, `session_id`, `time_created`, `time_updated`, `data` FROM `part`;--> statement-breakpoint
DROP TABLE `part`;--> statement-breakpoint
ALTER TABLE `__new_part` RENAME TO `part`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `workspace_project_idx` ON `workspace` (`project_id`);--> statement-breakpoint
CREATE INDEX `part_message_id_id_idx` ON `part` (`message_id`,`id`);--> statement-breakpoint
CREATE INDEX `part_session_idx` ON `part` (`session_id`);--> statement-breakpoint
CREATE INDEX `debug_engine_embedding_cache_project_idx` ON `debug_engine_embedding_cache` (`project_id`);--> statement-breakpoint
CREATE INDEX `debug_engine_embedding_cache_node_idx` ON `debug_engine_embedding_cache` (`project_id`,`node_id`);--> statement-breakpoint
CREATE INDEX `debug_engine_embedding_cache_sig_idx` ON `debug_engine_embedding_cache` (`project_id`,`signature_hash`);--> statement-breakpoint
CREATE INDEX `debug_engine_refactor_plan_project_idx` ON `debug_engine_refactor_plan` (`project_id`);--> statement-breakpoint
CREATE INDEX `debug_engine_refactor_plan_status_idx` ON `debug_engine_refactor_plan` (`project_id`,`status`);