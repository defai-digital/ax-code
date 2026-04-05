CREATE TABLE `code_node` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`qualified_name` text NOT NULL,
	`file` text NOT NULL,
	`range_start_line` integer NOT NULL,
	`range_start_char` integer NOT NULL,
	`range_end_line` integer NOT NULL,
	`range_end_char` integer NOT NULL,
	`signature` text,
	`visibility` text,
	`metadata` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_code_node_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `code_edge` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`from_node` text NOT NULL,
	`to_node` text NOT NULL,
	`file` text NOT NULL,
	`range_start_line` integer NOT NULL,
	`range_start_char` integer NOT NULL,
	`range_end_line` integer NOT NULL,
	`range_end_char` integer NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_code_edge_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `code_file` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`path` text NOT NULL,
	`sha` text NOT NULL,
	`size` integer NOT NULL,
	`lang` text NOT NULL,
	`indexed_at` integer NOT NULL,
	`completeness` text NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_code_file_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `code_index_cursor` (
	`project_id` text PRIMARY KEY,
	`commit_sha` text,
	`node_count` integer NOT NULL,
	`edge_count` integer NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_code_index_cursor_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `code_node_project_idx` ON `code_node` (`project_id`);--> statement-breakpoint
CREATE INDEX `code_node_project_name_idx` ON `code_node` (`project_id`,`name`);--> statement-breakpoint
CREATE INDEX `code_node_project_file_idx` ON `code_node` (`project_id`,`file`);--> statement-breakpoint
CREATE INDEX `code_node_project_kind_idx` ON `code_node` (`project_id`,`kind`);--> statement-breakpoint
CREATE INDEX `code_node_qualified_idx` ON `code_node` (`project_id`,`qualified_name`);--> statement-breakpoint
CREATE INDEX `code_edge_project_idx` ON `code_edge` (`project_id`);--> statement-breakpoint
CREATE INDEX `code_edge_from_idx` ON `code_edge` (`project_id`,`from_node`);--> statement-breakpoint
CREATE INDEX `code_edge_to_idx` ON `code_edge` (`project_id`,`to_node`);--> statement-breakpoint
CREATE INDEX `code_edge_project_file_idx` ON `code_edge` (`project_id`,`file`);--> statement-breakpoint
CREATE INDEX `code_edge_project_kind_idx` ON `code_edge` (`project_id`,`kind`);--> statement-breakpoint
CREATE INDEX `code_file_project_idx` ON `code_file` (`project_id`);--> statement-breakpoint
CREATE INDEX `code_file_project_path_idx` ON `code_file` (`project_id`,`path`);
