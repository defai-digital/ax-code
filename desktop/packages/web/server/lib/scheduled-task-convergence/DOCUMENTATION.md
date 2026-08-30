# Scheduled task convergence module

S2.6 (SPEC-2026-08-29-desktop-process-model-collapse §2 D6): deletes the
desktop scheduled-tasks engine and converges on the ax-code runtime's
`/scheduled-task` routes.

## Scope

- The retired desktop engine (`lib/scheduled-tasks/`) is gone. The runtime
  owns scheduling, execution, catch-up, overlap protection, and run history.
- This module owns the one-time storage migration and the per-boot scheduler
  wake-up. It is desktop-web feature glue, not runtime code.

## Files

- `transform.js`
  - Pure desktop-task → runtime-create-payload transform.
  - Multi-time / multi-weekday fan-out into N runtime tasks (`name (i/N)`
    suffixes) — the runtime supports a single time/weekday per task.
  - Runtime cron-subset guard (mirror of the runtime parser).
  - Skip decisions: unsupported cron, slash-command prompts, fired one-shots,
    oversized prompts.
  - KEEP IN SYNC with `desktop/packages/ui/src/lib/scheduledTaskTransform.ts`.

- `convergence.js`
  - `createScheduledTaskConvergence(deps)` → `{ start, migrate, wakeUp }`.
  - `start()` waits for runtime readiness, runs the marker-gated migration,
    then wakes every registered project directory with one
    `GET /scheduled-task?directory=<path>` (the runtime starts an instance's
    scheduler loop on the first directory-scoped request).
  - Migration is idempotent (title-match against existing runtime tasks) and
    writes `scheduled-tasks-migrated.json` next to the projects dir with the
    skip/warning report. Only confirmed tasks are removed from the project
    JSON; the `scheduledTasks` key is deleted once nothing remains.

## Related

- Task JSON persistence: `lib/projects/project-config.js`
  (`replaceScheduledTasks` is the migration write path).
- Time helpers: `lib/projects/scheduled-task-time.js`.
