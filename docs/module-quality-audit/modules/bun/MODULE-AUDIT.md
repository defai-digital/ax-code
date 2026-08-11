# MODULE-AUDIT: bun

| Field | Value |
|-------|-------|
| Unit slug | `bun` |
| Scope | `packages/ax-code/src/bun` |
| Resolved root | `packages/ax-code/src/bun` |
| XL filter | no |
| Wave / effort | Wave 3 / S |
| Risk tags | quality |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `994f9287e497666e104644eccea299595a35b39a` |
| Analysis fingerprint | `afa9c6db21bb6663` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 5 / 837 |
| Inventory ID | W3-11 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/bun/bun-global.d.ts` | 137 | 3 | 0 | 0 |
| `packages/ax-code/src/bun/index.ts` | 241 | 8 | 0 | 0 |
| `packages/ax-code/src/bun/node-compat.ts` | 339 | 5 | 0 | 0 |
| `packages/ax-code/src/bun/package-manager.ts` | 67 | 4 | 0 | 0 |
| `packages/ax-code/src/bun/registry.ts` | 53 | 3 | 0 | 0 |

### Exports (sample)
- `Glob@packages/ax-code/src/bun/bun-global.d.ts:122`
- `dlopen@packages/ax-code/src/bun/bun-global.d.ts:133`
- `ptr@packages/ax-code/src/bun/bun-global.d.ts:135`
- `BunProc@packages/ax-code/src/bun/index.ts:15`
- `run@packages/ax-code/src/bun/index.ts:18`
- `resolveExecutable@packages/ax-code/src/bun/index.ts:44`
- `which@packages/ax-code/src/bun/index.ts:62`
- `installCacheWorkaroundArgs@packages/ax-code/src/bun/index.ts:82`
- `InstallFailedError@packages/ax-code/src/bun/index.ts:88`
- `installArgs@packages/ax-code/src/bun/index.ts:96`
- `install@packages/ax-code/src/bun/index.ts:145`
- `hash@packages/ax-code/src/bun/node-compat.ts:163`
- `Glob@packages/ax-code/src/bun/node-compat.ts:173`
- `stringWidth@packages/ax-code/src/bun/node-compat.ts:279`
- `resolveSync@packages/ax-code/src/bun/node-compat.ts:289`
- `installNodeBunCompat@packages/ax-code/src/bun/node-compat.ts:319`
- `PackageManagerKind@packages/ax-code/src/bun/package-manager.ts:17`
- `packageManagerKind@packages/ax-code/src/bun/package-manager.ts:19`
- `toolRunner@packages/ax-code/src/bun/package-manager.ts:43`
- `NpmManager@packages/ax-code/src/bun/package-manager.ts:52`

### Tests
- `packages/ax-code/test/bun/bun-proc.test.ts`
- `packages/ax-code/test/bun/node-compat.test.ts`
- `packages/ax-code/test/bun/package-manager.test.ts`
- `packages/ax-code/test/bun.test.ts`
- `packages/ax-code/test/quality/promotion-decision-bundle.test.ts`
- `packages/ax-code/test/quality/promotion-export-bundle.test.ts`
- `packages/ax-code/test/quality/promotion-submission-bundle.test.ts`
- `packages/ax-code/test/support/bun-shell.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (23) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags quality | hotspot scan |

## 3–7. Protocol steps 3–7

Completed by dual-agent; see agent-protocol.json

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `afa9c6db21bb6663` |
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
| Reviewer | codex-sol | 2026-08-11 | filesRead=18 |
| Independent verifier | ax-code-glm | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
