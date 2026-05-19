-- Cross-session debug pattern memory (PRD: coding-debugging-capability-hardening §Phase 6).
-- When a debug case is resolved (confirmed hypothesis), a compact signature
-- is stored here. On new debug case open, the system queries for similar
-- patterns using keyword overlap + file path similarity + error category match.
-- Capped at 1000 rows per project with LRU eviction.

CREATE TABLE `debug_engine_pattern` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`problem` text NOT NULL,
	`category` text NOT NULL,
	`fix_pattern` text NOT NULL,
	`affected_file_patterns` text NOT NULL,
	`keywords` text NOT NULL,
	`last_matched_at` integer,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_debug_engine_pattern_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);--> statement-breakpoint
CREATE INDEX `debug_engine_pattern_project_idx` ON `debug_engine_pattern` (`project_id`);--> statement-breakpoint
CREATE INDEX `debug_engine_pattern_category_idx` ON `debug_engine_pattern` (`project_id`,`category`);--> statement-breakpoint
CREATE INDEX `debug_engine_pattern_keywords_idx` ON `debug_engine_pattern` (`project_id`,`keywords`);
