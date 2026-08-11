# MODULE-AUDIT: desktop-web-src

| Field | Value |
|-------|-------|
| Unit slug | `desktop-web-src` |
| Scope | `desktop/packages/web/src` |
| Resolved root | `desktop/packages/web/src` |
| XL filter | no |
| Wave / effort | Wave 7 / M |
| Risk tags | desktop |
| Status | REVIEWING |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `5fefa00cdc847667d3ba3d38509a751498ee4180` |
| Analysis fingerprint | `454d79d0603392b8` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 15 / 1265 |
| Inventory ID | W7-22 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/web/src/api/constants.ts` | 83 | 5 | 0 | 0 |
| `desktop/packages/web/src/api/files.test.ts` | 49 | 0 | 0 | 0 |
| `desktop/packages/web/src/api/files.ts` | 286 | 1 | 0 | 0 |
| `desktop/packages/web/src/api/git.test.ts` | 73 | 0 | 0 | 0 |
| `desktop/packages/web/src/api/git.ts` | 74 | 1 | 0 | 0 |
| `desktop/packages/web/src/api/github.ts` | 333 | 1 | 0 | 0 |
| `desktop/packages/web/src/api/index.ts` | 23 | 1 | 0 | 0 |
| `desktop/packages/web/src/api/notifications.test.ts` | 61 | 0 | 0 | 0 |
| `desktop/packages/web/src/api/notifications.ts` | 84 | 1 | 0 | 0 |
| `desktop/packages/web/src/api/permissions.ts` | 16 | 1 | 0 | 0 |
| `desktop/packages/web/src/api/settings.ts` | 57 | 1 | 0 | 0 |
| `desktop/packages/web/src/api/terminal.ts` | 69 | 1 | 0 | 0 |
| `desktop/packages/web/src/api/tools.ts` | 24 | 1 | 0 | 0 |
| `desktop/packages/web/src/main.tsx` | 16 | 0 | 0 | 0 |
| `desktop/packages/web/src/mini-chat-main.tsx` | 17 | 0 | 0 | 0 |

### Exports (sample)
- `API_BASE_PATH@desktop/packages/web/src/api/constants.ts:6`
- `API_ENDPOINTS@desktop/packages/web/src/api/constants.ts:8`
- `HTTP_QUERY_STRINGS@desktop/packages/web/src/api/constants.ts:32`
- `HTTP_DEFAULTS@desktop/packages/web/src/api/constants.ts:38`
- `buildQueryUrl@desktop/packages/web/src/api/constants.ts:73`
- `createWebFilesAPI@desktop/packages/web/src/api/files.ts:47`
- `createWebGitAPI@desktop/packages/web/src/api/git.ts:4`
- `createWebGitHubAPI@desktop/packages/web/src/api/github.ts:28`
- `createWebAPIs@desktop/packages/web/src/api/index.ts:12`
- `createWebNotificationsAPI@desktop/packages/web/src/api/notifications.ts:65`
- `createWebPermissionsAPI@desktop/packages/web/src/api/permissions.ts:3`
- `createWebSettingsAPI@desktop/packages/web/src/api/settings.ts:14`
- `createWebTerminalAPI@desktop/packages/web/src/api/terminal.ts:32`
- `createWebToolsAPI@desktop/packages/web/src/api/tools.ts:4`

### Tests
- `packages/ax-code/test/cli/tui/desktop-handoff.test.ts`
- `packages/ax-code/test/desktop/webui.test.ts`
- `packages/ax-code/test/fixture/workflow/verified-bug-sweep-seeded/src/auth.ts`
- `packages/ax-code/test/fixture/workflow/verified-bug-sweep-seeded/src/cache.ts`
- `packages/ax-code/test/fixture/workflow/verified-bug-sweep-seeded/src/render.ts`
- `packages/ax-code/test/fixture/workflow/verified-bug-sweep-seeded/src/retry.ts`
- `packages/ax-code/test/script/desktop-release-workflow.test.ts`
- `packages/ax-code/test/tool/webfetch.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (14) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags desktop | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `454d79d0603392b8` |
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
