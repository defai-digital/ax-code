# MODULE-AUDIT: server-routes-file

| Field | Value |
|-------|-------|
| Unit slug | `server-routes-file` |
| Scope | `packages/ax-code/src/server/routes/file.ts` |
| Resolved root | `packages/ax-code/src/server/routes/file.ts` |
| XL filter | no |
| Wave / effort | Wave 4 / S |
| Risk tags | network, api |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `994f9287e497666e104644eccea299595a35b39a` |
| Analysis fingerprint | `f4872e3fb9d97e67` |
| Protocol marker | agent-protocol.json complete |
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

Completed by dual-agent; see agent-protocol.json

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `f4872e3fb9d97e67` |
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
| Reviewer | codex-sol | 2026-08-11 | filesRead=22 |
| Independent verifier | ax-code-glm | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
