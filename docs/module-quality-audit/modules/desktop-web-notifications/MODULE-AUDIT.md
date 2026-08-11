# MODULE-AUDIT: desktop-web-notifications

| Field | Value |
|-------|-------|
| Unit slug | `desktop-web-notifications` |
| Scope | `desktop/packages/web/server/lib/notifications` |
| Resolved root | `desktop/packages/web/server/lib/notifications` |
| XL filter | no |
| Wave / effort | Wave 7 / M |
| Risk tags | desktop |
| Status | REVIEWING |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `046510f0ca8a215f632e99fa92aa0633d684cbb9` |
| Analysis fingerprint | `f87ab3cfc86ac9b3` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 11 / 1523 |
| Inventory ID | W7-13 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/web/server/lib/notifications/emitter-runtime.js` | 99 | 1 | 0 | 0 |
| `desktop/packages/web/server/lib/notifications/index.js` | 4 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/notifications/label-format.js` | 39 | 3 | 0 | 0 |
| `desktop/packages/web/server/lib/notifications/label-format.test.js` | 20 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/notifications/message.js` | 56 | 2 | 0 | 0 |
| `desktop/packages/web/server/lib/notifications/message.test.js` | 35 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/notifications/routes.js` | 202 | 1 | 1 | 0 |
| `desktop/packages/web/server/lib/notifications/runtime.js` | 470 | 1 | 0 | 0 |
| `desktop/packages/web/server/lib/notifications/runtime.test.js` | 105 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/notifications/template-runtime.js` | 345 | 1 | 1 | 0 |
| `desktop/packages/web/server/lib/notifications/template-runtime.test.js` | 148 | 0 | 0 | 0 |

### Exports (sample)
- `createNotificationEmitterRuntime@desktop/packages/web/server/lib/notifications/emitter-runtime.js:1`
- `formatNotificationProjectLabel@desktop/packages/web/server/lib/notifications/label-format.js:10`
- `formatNotificationModeLabel@desktop/packages/web/server/lib/notifications/label-format.js:15`
- `formatNotificationModelLabel@desktop/packages/web/server/lib/notifications/label-format.js:20`
- `truncateNotificationText@desktop/packages/web/server/lib/notifications/message.js:30`
- `prepareNotificationLastMessage@desktop/packages/web/server/lib/notifications/message.js:43`
- `registerNotificationRoutes@desktop/packages/web/server/lib/notifications/routes.js:1`
- `createNotificationTriggerRuntime@desktop/packages/web/server/lib/notifications/runtime.js:3`
- `createNotificationTemplateRuntime@desktop/packages/web/server/lib/notifications/template-runtime.js:8`

### Tests
- `packages/ax-code/test/cli/tui/desktop-handoff.test.ts`
- `packages/ax-code/test/desktop/webui.test.ts`
- `packages/ax-code/test/script/desktop-release-workflow.test.ts`
- `packages/ax-code/test/tool/webfetch.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (9) | static map |
| Silent failure | empty catch (2) | per-site disposition in findings |
| Secrets/process/IO | risk tags desktop | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-desktop-web-notifications-empty-catch | silent-error | Low | new | deferred |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `f87ab3cfc86ac9b3` |
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
