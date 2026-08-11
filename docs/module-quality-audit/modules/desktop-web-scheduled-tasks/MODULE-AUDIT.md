# MODULE-AUDIT: desktop-web-scheduled-tasks

| Field | Value |
|-------|-------|
| Unit slug | `desktop-web-scheduled-tasks` |
| Scope | `desktop/packages/web/server/lib/scheduled-tasks` |
| Resolved root | `desktop/packages/web/server/lib/scheduled-tasks` |
| XL filter | no |
| Wave / effort | Wave 7 / L |
| Risk tags | desktop |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `cab6c0089e3b7b3410f050bc9d824c06a3c3a814` |
| Analysis fingerprint | `53b388ec7f63492f` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 5 / 1580 |
| Inventory ID | W7-17 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/web/server/lib/scheduled-tasks/routes.js` | 234 | 1 | 2 | 0 |
| `desktop/packages/web/server/lib/scheduled-tasks/runtime.js` | 912 | 4 | 3 | 0 |
| `desktop/packages/web/server/lib/scheduled-tasks/runtime.test.js` | 322 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/scheduled-tasks/time.js` | 69 | 5 | 0 | 0 |
| `desktop/packages/web/server/lib/scheduled-tasks/time.test.js` | 43 | 0 | 0 | 0 |

### Exports (sample)
- `registerScheduledTaskRoutes@desktop/packages/web/server/lib/scheduled-tasks/routes.js:12`
- `parseScheduledCommandPrompt@desktop/packages/web/server/lib/scheduled-tasks/runtime.js:54`
- `computeNextRunAt@desktop/packages/web/server/lib/scheduled-tasks/runtime.js:77`
- `formatScheduledSessionTitle@desktop/packages/web/server/lib/scheduled-tasks/runtime.js:178`
- `createScheduledTasksRuntime@desktop/packages/web/server/lib/scheduled-tasks/runtime.js:188`
- `normalizeScheduledTaskTime@desktop/packages/web/server/lib/scheduled-tasks/time.js:3`
- `uniqueSortedScheduledTaskTimes@desktop/packages/web/server/lib/scheduled-tasks/time.js:8`
- `normalizeScheduledTaskTimes@desktop/packages/web/server/lib/scheduled-tasks/time.js:10`
- `resolveScheduledTaskTimes@desktop/packages/web/server/lib/scheduled-tasks/time.js:26`
- `parseScheduledTaskTimeParts@desktop/packages/web/server/lib/scheduled-tasks/time.js:55`

### Tests
- `packages/ax-code/test/cli/tui/desktop-handoff.test.ts`
- `packages/ax-code/test/desktop/webui.test.ts`
- `packages/ax-code/test/script/desktop-release-workflow.test.ts`
- `packages/ax-code/test/server/scheduled-task-routes.test.ts`
- `packages/ax-code/test/tool/webfetch.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (10) | static map |
| Silent failure | empty catch (5) | per-site disposition in findings |
| Secrets/process/IO | risk tags desktop | hotspot scan |

## 3–7. Protocol steps 3–7

Completed by dual-agent; see agent-protocol.json

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-desktop-web-scheduled-tasks-empty-catch | silent-error | Low | new | deferred |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `53b388ec7f63492f` |
| Dual-agent protocol | complete |
| Critical independent verify | ax-code-glm |

### Exit checklist
- [x] Full 9-step protocol by dual-agent/implementer
- [x] Map with unit-scoped files (XL filters applied when configured)
- [x] Findings ledger consistent with findings/ files
- [x] Sign-off roles complete

### Sign-off

| Role | Name | Date | Evidence |
|------|------|------|----------|
| Reviewer | codex-sol | 2026-08-11 | filesRead=12 |
| Independent verifier | ax-code-glm | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
