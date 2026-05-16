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
CREATE INDEX `debug_engine_refactor_plan_project_idx` ON `debug_engine_refactor_plan` (`project_id`);--> statement-breakpoint
CREATE INDEX `debug_engine_refactor_plan_status_idx` ON `debug_engine_refactor_plan` (`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `debug_engine_embedding_cache_project_idx` ON `debug_engine_embedding_cache` (`project_id`);--> statement-breakpoint
CREATE INDEX `debug_engine_embedding_cache_node_idx` ON `debug_engine_embedding_cache` (`project_id`,`node_id`);--> statement-breakpoint
CREATE INDEX `debug_engine_embedding_cache_sig_idx` ON `debug_engine_embedding_cache` (`project_id`,`signature_hash`);
