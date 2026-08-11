# MODULE-AUDIT: server-routes-file

| Field | Value |
|-------|-------|
| Unit slug | `server-routes-file` |
| Scope | `packages/ax-code/src/server/routes/file.ts` |
| Resolved root | `packages/ax-code/src/server/routes/file.ts` |
| XL filter | no |
| Wave / effort | Wave 4 / S |
| Risk tags | network, api |
| Status | REVIEWING |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `046510f0ca8a215f632e99fa92aa0633d684cbb9` |
| Analysis fingerprint | `f4872e3fb9d97e67` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 1 / 192 |
| Inventory ID | W4-03-12 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/server/routes/file.ts` | 192 | 1 | 0 | 0 |

### Exports (sample)
- `FileRoutes@packages/ax-code/src/server/routes/file.ts:17`

### Tests
- `packages/ax-code/test/cli/cmd/tui/routes/session/autonomous-active.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/coalesce.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/footer-view-model.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/format.test.ts`
- `packages/ax-code/test/cli/tui/prompt-filepath.test.ts`
- `packages/ax-code/test/cli/tui/spinner-profile.test.ts`
- `packages/ax-code/test/code-intelligence/lockfile.test.ts`
- `packages/ax-code/test/command/file-command.test.ts`
- `packages/ax-code/test/control-plane/workspace-server-sse.test.ts`
- `packages/ax-code/test/file/fsmonitor.test.ts`
- `packages/ax-code/test/file/ignore-drift.test.ts`
- `packages/ax-code/test/file/ignore.test.ts`
- `packages/ax-code/test/file/index.test.ts`
- `packages/ax-code/test/file/path-traversal.test.ts`
- `packages/ax-code/test/file/ripgrep.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (1) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags network,api | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `f4872e3fb9d97e67` |
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
