-- LSP response cache (Semantic Trust Layer PRD §S2).
-- Content-addressable: unique key includes content_hash, so stale rows
-- are unreachable once file content changes. Feature-gated by
-- AX_CODE_LSP_CACHE=1; default off for the first release.

CREATE TABLE `code_intel_lsp_cache` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`operation` text NOT NULL,
	`file_path` text NOT NULL,
	`content_hash` text NOT NULL,
	`line` integer NOT NULL,
	`character` integer NOT NULL,
	`payload_json` text NOT NULL,
	`server_ids_json` text NOT NULL,
	`completeness` text NOT NULL,
	`hit_count` integer DEFAULT 0 NOT NULL,
	`expires_at` integer NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_code_intel_lsp_cache_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `code_intel_lsp_cache_project_idx` ON `code_intel_lsp_cache` (`project_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `code_intel_lsp_cache_key_idx` ON `code_intel_lsp_cache` (`project_id`,`operation`,`file_path`,`content_hash`,`line`,`character`);
--> statement-breakpoint
CREATE INDEX `code_intel_lsp_cache_expires_idx` ON `code_intel_lsp_cache` (`expires_at`);
