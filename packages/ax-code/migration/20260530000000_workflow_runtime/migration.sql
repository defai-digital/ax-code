CREATE TABLE `workflow_run` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `directory` text NOT NULL,
  `parent_session_id` text,
  `source_template_id` text,
  `status` text NOT NULL,
  `current_phase_id` text,
  `spec_snapshot` text NOT NULL,
  `budget` text NOT NULL,
  `budget_usage` text NOT NULL,
  `verification_envelope_ids` text NOT NULL,
  `error` text,
  `time_started` integer,
  `time_completed` integer,
  `time_created` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
  `time_updated` integer NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`parent_session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `workflow_run_project_status_idx` ON `workflow_run` (`project_id`,`status`);
--> statement-breakpoint
CREATE INDEX `workflow_run_project_created_idx` ON `workflow_run` (`project_id`,`time_created`,`id`);
--> statement-breakpoint
CREATE INDEX `workflow_run_parent_session_idx` ON `workflow_run` (`parent_session_id`);
--> statement-breakpoint
CREATE TABLE `workflow_phase` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `spec_phase_id` text NOT NULL,
  `position` integer NOT NULL,
  `name` text NOT NULL,
  `kind` text NOT NULL,
  `status` text NOT NULL,
  `agent` text,
  `model_policy` text,
  `budget` text,
  `outputs` text NOT NULL,
  `error` text,
  `time_started` integer,
  `time_completed` integer,
  `time_created` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
  `time_updated` integer NOT NULL,
  FOREIGN KEY (`run_id`) REFERENCES `workflow_run`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `workflow_phase_run_position_idx` ON `workflow_phase` (`run_id`,`position`);
--> statement-breakpoint
CREATE INDEX `workflow_phase_run_status_idx` ON `workflow_phase` (`run_id`,`status`);
--> statement-breakpoint
CREATE TABLE `workflow_child` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `phase_id` text NOT NULL,
  `task_queue_id` text,
  `session_id` text,
  `status` text NOT NULL,
  `agent` text,
  `model` text,
  `budget_slice` text,
  `artifact_ids` text NOT NULL,
  `evidence_refs` text NOT NULL,
  `output_summary` text,
  `error` text,
  `time_started` integer,
  `time_completed` integer,
  `time_created` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
  `time_updated` integer NOT NULL,
  FOREIGN KEY (`run_id`) REFERENCES `workflow_run`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`phase_id`) REFERENCES `workflow_phase`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`task_queue_id`) REFERENCES `task_queue`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `workflow_child_run_phase_idx` ON `workflow_child` (`run_id`,`phase_id`);
--> statement-breakpoint
CREATE INDEX `workflow_child_run_status_idx` ON `workflow_child` (`run_id`,`status`);
--> statement-breakpoint
CREATE INDEX `workflow_child_task_queue_idx` ON `workflow_child` (`task_queue_id`);
--> statement-breakpoint
CREATE TABLE `workflow_artifact` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `phase_id` text,
  `child_id` text,
  `kind` text NOT NULL,
  `retention` text NOT NULL,
  `expose_to_main_context` integer NOT NULL,
  `summary` text,
  `payload` text,
  `redaction` text,
  `evidence_refs` text NOT NULL,
  `time_created` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
  `time_updated` integer NOT NULL,
  FOREIGN KEY (`run_id`) REFERENCES `workflow_run`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`phase_id`) REFERENCES `workflow_phase`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`child_id`) REFERENCES `workflow_child`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `workflow_artifact_run_idx` ON `workflow_artifact` (`run_id`,`time_created`,`id`);
--> statement-breakpoint
CREATE INDEX `workflow_artifact_phase_idx` ON `workflow_artifact` (`phase_id`);
--> statement-breakpoint
CREATE INDEX `workflow_artifact_child_idx` ON `workflow_artifact` (`child_id`);
--> statement-breakpoint
CREATE TABLE `workflow_budget_ledger` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `phase_id` text,
  `child_id` text,
  `kind` text NOT NULL,
  `usage_delta` text NOT NULL,
  `message` text,
  `time_created` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
  `time_updated` integer NOT NULL,
  FOREIGN KEY (`run_id`) REFERENCES `workflow_run`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`phase_id`) REFERENCES `workflow_phase`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`child_id`) REFERENCES `workflow_child`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `workflow_budget_ledger_run_idx` ON `workflow_budget_ledger` (`run_id`,`time_created`,`id`);
--> statement-breakpoint
CREATE INDEX `workflow_budget_ledger_phase_idx` ON `workflow_budget_ledger` (`phase_id`);
--> statement-breakpoint
CREATE INDEX `workflow_budget_ledger_child_idx` ON `workflow_budget_ledger` (`child_id`);
