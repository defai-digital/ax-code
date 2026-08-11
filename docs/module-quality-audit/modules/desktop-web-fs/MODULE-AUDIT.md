# MODULE-AUDIT: desktop-web-fs

| Field | Value |
|-------|-------|
| Unit slug | `desktop-web-fs` |
| Scope | `desktop/packages/web/server/lib/fs` |
| Resolved root | `desktop/packages/web/server/lib/fs` |
| XL filter | no |
| Wave / effort | Wave 7 / M |
| Risk tags | desktop, security |
| Status | REVIEWING |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `5fefa00cdc847667d3ba3d38509a751498ee4180` |
| Analysis fingerprint | `bff13b0ed5e712e4` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 3 / 2335 |
| Inventory ID | W7-09 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/web/server/lib/fs/routes.js` | 1505 | 6 | 3 | 0 |
| `desktop/packages/web/server/lib/fs/routes.test.js` | 589 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/fs/search.js` | 241 | 1 | 0 | 0 |

### Exports (sample)
- `isPathWithinRoot@desktop/packages/web/server/lib/fs/routes.js:59`
- `resolveApprovedPathFromSettings@desktop/packages/web/server/lib/fs/routes.js:89`
- `resolveWorkspaceOrApprovedPathFromContext@desktop/packages/web/server/lib/fs/routes.js:220`
- `deriveCloneDirectoryName@desktop/packages/web/server/lib/fs/routes.js:252`
- `isPlansDirectoryPath@desktop/packages/web/server/lib/fs/routes.js:271`
- `registerFsRoutes@desktop/packages/web/server/lib/fs/routes.js:427`
- `createFsSearchRuntime@desktop/packages/web/server/lib/fs/search.js:98`

### Tests
- `packages/ax-code/test/cli/tui/desktop-handoff.test.ts`
- `packages/ax-code/test/desktop/webui.test.ts`
- `packages/ax-code/test/script/desktop-release-workflow.test.ts`
- `packages/ax-code/test/tool/webfetch.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (7) | static map |
| Silent failure | empty catch (3) | per-site disposition in findings |
| Secrets/process/IO | risk tags desktop,security | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-desktop-web-fs-empty-catch | silent-error | Low | new | deferred |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `bff13b0ed5e712e4` |
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
