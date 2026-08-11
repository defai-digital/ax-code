# MODULE-AUDIT: desktop-web-projects

| Field | Value |
|-------|-------|
| Unit slug | `desktop-web-projects` |
| Scope | `desktop/packages/web/server/lib/projects` |
| Resolved root | `desktop/packages/web/server/lib/projects` |
| XL filter | no |
| Wave / effort | Wave 7 / L |
| Risk tags | desktop |
| Status | REVIEWING |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `5fefa00cdc847667d3ba3d38509a751498ee4180` |
| Analysis fingerprint | `617912f90adfa9ff` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 5 / 1210 |
| Inventory ID | W7-15 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/web/server/lib/projects/discover-external.js` | 269 | 4 | 0 | 0 |
| `desktop/packages/web/server/lib/projects/discover-external.test.js` | 131 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/projects/project-config.js` | 518 | 1 | 1 | 0 |
| `desktop/packages/web/server/lib/projects/project-config.test.js` | 278 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/projects/project-id.js` | 14 | 1 | 0 | 0 |

### Exports (sample)
- `parseCodexProjectsToml@desktop/packages/web/server/lib/projects/discover-external.js:40`
- `parseKimiWorkspacesJson@desktop/packages/web/server/lib/projects/discover-external.js:76`
- `discoverExternalProjects@desktop/packages/web/server/lib/projects/discover-external.js:128`
- `registerDiscoverExternalProjectRoutes@desktop/packages/web/server/lib/projects/discover-external.js:225`
- `createProjectConfigRuntime@desktop/packages/web/server/lib/projects/project-config.js:292`
- `createProjectIdFromPath@desktop/packages/web/server/lib/projects/project-id.js:6`

### Tests
- `packages/ax-code/test/cli/tui/desktop-handoff.test.ts`
- `packages/ax-code/test/desktop/webui.test.ts`
- `packages/ax-code/test/script/desktop-release-workflow.test.ts`
- `packages/ax-code/test/tool/webfetch.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (6) | static map |
| Silent failure | empty catch (1) | per-site disposition in findings |
| Secrets/process/IO | risk tags desktop | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-desktop-web-projects-empty-catch | silent-error | Low | new | deferred |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `617912f90adfa9ff` |
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
