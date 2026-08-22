-- Phase 3 (D5): refactor-plan rigor columns.
--
-- First DRE schema migration. Adds three nullable JSON columns to
-- debug_engine_refactor_plan so plans can carry source preconditions,
-- ordered/atomic edit groups, and a verification mapping. All three are
-- nullable: rows written before this migration (or by callers that don't
-- populate them) keep NULL. plan-refactor fills them; apply-safe-refactor
-- reads `preconditions` for drift detection before opening the shadow
-- worktree.

ALTER TABLE `debug_engine_refactor_plan` ADD `preconditions` text;--> statement-breakpoint
ALTER TABLE `debug_engine_refactor_plan` ADD `edit_groups` text;--> statement-breakpoint
ALTER TABLE `debug_engine_refactor_plan` ADD `verification_plan` text;
