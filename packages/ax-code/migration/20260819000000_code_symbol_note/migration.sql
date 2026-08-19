-- Symbol-anchored cross-session notes (ADR-056, PRD-2026-08-19-symbol-anchored-cross-session-memory).
-- Durable, symbol-level conclusions that survive sessions: root causes, refactor
-- rationale, caveats. Keyed by (project_id, qualified_name) — NOT node id — because
-- reindex is delete-then-insert and node ids are ephemeral. No FK into code_node so
-- watcher reindexes and pruneOrphanFiles can never cascade away learned knowledge.
-- Staleness is detected at read time by comparing content_hash_at_write against
-- code_file.sha. Capped at 5 notes per symbol (newest wins) with write-time dedupe.

CREATE TABLE `code_symbol_note` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`qualified_name` text NOT NULL,
	`file` text NOT NULL,
	`kind` text NOT NULL,
	`body` text NOT NULL,
	`content_hash_at_write` text,
	`session_id` text,
	`signature_at_write` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_code_symbol_note_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `code_symbol_note_project_idx` ON `code_symbol_note` (`project_id`);
--> statement-breakpoint
CREATE INDEX `code_symbol_note_qualified_idx` ON `code_symbol_note` (`project_id`,`qualified_name`);
--> statement-breakpoint
CREATE INDEX `code_symbol_note_file_idx` ON `code_symbol_note` (`project_id`,`file`);
