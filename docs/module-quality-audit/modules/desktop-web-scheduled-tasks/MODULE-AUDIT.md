# MODULE-AUDIT: desktop-web-scheduled-tasks

| Field | Value |
|-------|-------|
| Unit slug | `desktop-web-scheduled-tasks` |
| Scope | `desktop/packages/web/server/lib/scheduled-tasks` |
| Resolved root | `desktop/packages/web/server/lib/scheduled-tasks` |
| XL filter | no |
| Wave / effort | Wave 7 / L |
| Risk tags | desktop |
| Status | REVIEWING |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `046510f0ca8a215f632e99fa92aa0633d684cbb9` |
| Analysis fingerprint | `53b388ec7f63492f` |
| Protocol marker | pending dual-agent 9-step |
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

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-desktop-web-scheduled-tasks-empty-catch | silent-error | Low | new | deferred |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `53b388ec7f63492f` |
| Dual-agent protocol | PENDING |
| Critical independent verify | pending |

### Exit checklist
- [ ] Full 9-step protocol by dual-agent/implementer
- [x] Map with unit-scoped files (XL filters applied when configured)
- [x] Findings ledger consistent with findings/ files
- [ ] Sign-off roles complete

### Sign-off

| Role | Name | Date | Evidence |
|------|------|------|----------|
| Reviewer | — | — | protocol pending |
| Independent verifier | — | — | pending |
| Module owner | — | — | REVIEWING |
