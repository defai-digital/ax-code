-- Phase 2/3 of symbol-anchored cross-session notes (ADR-056, PRD-2026-08-19).
-- (1) code_symbol_signal: lossy, decaying relevance counters — separate from
-- code_symbol_note (durable content) because write rate, retention, and
-- consistency semantics differ. Keyed by (project_id, qualified_name,
-- signal_type), never node id. (2) code_symbol_note gains symbol-identity
-- columns for rename re-anchoring plus an origin column for cap partitioning.

CREATE TABLE `code_symbol_signal` (
	`project_id` text NOT NULL,
	`qualified_name` text NOT NULL,
	`file` text NOT NULL,
	`signal_type` text NOT NULL,
	`hit_count` integer DEFAULT 1 NOT NULL,
	`last_seen_at` integer NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `code_symbol_signal_project_id_qualified_name_signal_type_pk` PRIMARY KEY(`project_id`,`qualified_name`,`signal_type`),
	CONSTRAINT `fk_code_symbol_signal_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `code_symbol_signal_project_idx` ON `code_symbol_signal` (`project_id`);
--> statement-breakpoint
CREATE INDEX `code_symbol_signal_lastseen_idx` ON `code_symbol_signal` (`project_id`,`last_seen_at`);
--> statement-breakpoint
ALTER TABLE `code_symbol_note` ADD `symbol_name_at_write` text;
--> statement-breakpoint
ALTER TABLE `code_symbol_note` ADD `symbol_kind_at_write` text;
--> statement-breakpoint
ALTER TABLE `code_symbol_note` ADD `origin` text DEFAULT 'explicit' NOT NULL;
--> statement-breakpoint
CREATE INDEX `code_symbol_note_identity_idx` ON `code_symbol_note` (`project_id`,`symbol_name_at_write`,`symbol_kind_at_write`,`signature_at_write`);
