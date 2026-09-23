-- Goal time budget (wall-clock seconds), adopted from the kimi-code goal-mode
-- design review (.internal/reports/2026-09-23-kimi-goal-mode-design-review.md).
--
-- A token budget cannot cap expensive autonomous runs whose cost is wall time
-- (remote training jobs, long tool calls). `time_budget_seconds` bounds the
-- accrued `time_used_seconds` the same way `token_budget` bounds
-- `tokens_used`: crossing either budget flips the goal to `budget_limited`
-- inside SessionGoal.addUsage, which the existing wrap-up flow already
-- handles. Nullable so pre-existing goals keep no time budget.

ALTER TABLE `session_goal` ADD COLUMN `time_budget_seconds` integer;
