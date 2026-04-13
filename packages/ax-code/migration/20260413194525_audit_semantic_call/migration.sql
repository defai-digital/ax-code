CREATE TABLE `audit_semantic_call` (
	`id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`message_id` text,
	`tool` text NOT NULL,
	`operation` text NOT NULL,
	`args_json` text NOT NULL,
	`envelope_json` text NOT NULL,
	`error_code` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_audit_semantic_call_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `audit_semantic_call_session_idx` ON `audit_semantic_call` (`session_id`);--> statement-breakpoint
CREATE INDEX `audit_semantic_call_tool_op_idx` ON `audit_semantic_call` (`tool`,`operation`);--> statement-breakpoint
CREATE INDEX `audit_semantic_call_created_idx` ON `audit_semantic_call` (`time_created`);