# MODULE-AUDIT: ide

| Field | Value |
|-------|-------|
| Unit slug | `ide` |
| Scope | `packages/ax-code/src/ide` |
| Resolved root | `packages/ax-code/src/ide` |
| XL filter | no |
| Wave / effort | Wave 5 / M |
| Risk tags | api |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `5fefa00cdc847667d3ba3d38509a751498ee4180` |
| Analysis fingerprint | `4efe9427464f15e1` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 1 / 75 |
| Inventory ID | W5-11 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/ide/index.ts` | 75 | 7 | 0 | 0 |

### Exports (sample)
- `Ide@packages/ax-code/src/ide/index.ts:16`
- `Event@packages/ax-code/src/ide/index.ts:19`
- `AlreadyInstalledError@packages/ax-code/src/ide/index.ts:28`
- `InstallFailedError@packages/ax-code/src/ide/index.ts:30`
- `ide@packages/ax-code/src/ide/index.ts:37`
- `alreadyInstalled@packages/ax-code/src/ide/index.ts:47`
- `install@packages/ax-code/src/ide/index.ts:51`

### Tests
- `packages/ax-code/test/cli/providers.test.ts`
- `packages/ax-code/test/cli/tui/c-dialog-provider-auth-errors.test.ts`
- `packages/ax-code/test/cli/tui/dialog-provider-options.test.ts`
- `packages/ax-code/test/cli/tui/session-sidebar-index.test.ts`
- `packages/ax-code/test/ide/ide.test.ts`
- `packages/ax-code/test/image/provider.test.ts`
- `packages/ax-code/test/perf/sidebar-activity-recent.test.ts`
- `packages/ax-code/test/perf/sidebar-rollback-points.test.ts`
- `packages/ax-code/test/plugin/auth-override.test.ts`
- `packages/ax-code/test/provider/agent-optimization-profile.test.ts`
- `packages/ax-code/test/provider/ax-engine/delete.test.ts`
- `packages/ax-code/test/provider/ax-engine/download-job.test.ts`
- `packages/ax-code/test/provider/ax-engine/download-progress.test.ts`
- `packages/ax-code/test/provider/ax-engine/hf-cache.test.ts`
- `packages/ax-code/test/provider/ax-engine/install.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (7) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags api | hotspot scan |

## 3–7. Protocol steps 3–7

Completed by dual-agent; see agent-protocol.json

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `4efe9427464f15e1` |
| Dual-agent protocol | complete |
| Critical independent verify | codex-sol |

### Exit checklist
- [x] Full 9-step protocol by dual-agent/implementer
- [x] Map with unit-scoped files (XL filters applied when configured)
- [x] Findings ledger consistent with findings/ files
- [x] Sign-off roles complete

### Sign-off

| Role | Name | Date | Evidence |
|------|------|------|----------|
| Reviewer | ax-code-glm | 2026-08-11 | filesRead=6 |
| Independent verifier | codex-sol | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
