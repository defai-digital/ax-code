# MODULE-AUDIT: isolation

| Field | Value |
|-------|-------|
| Unit slug | `isolation` |
| Scope | `packages/ax-code/src/isolation` |
| Resolved root | `packages/ax-code/src/isolation` |
| XL filter | no |
| Wave / effort | Wave 3 / L |
| Risk tags | security, sandbox |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `994f9287e497666e104644eccea299595a35b39a` |
| Analysis fingerprint | `8f20139566cb50c8` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 2 / 625 |
| Inventory ID | W3-02 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/isolation/index.ts` | 292 | 18 | 0 | 0 |
| `packages/ax-code/src/isolation/os-sandbox.ts` | 333 | 12 | 0 | 0 |

### Exports (sample)
- `Isolation@packages/ax-code/src/isolation/index.ts:9`
- `DEFAULT_PROTECTED@packages/ax-code/src/isolation/index.ts:10`
- `OsSandbox@packages/ax-code/src/isolation/index.ts:11`
- `NETWORK_COMMANDS@packages/ax-code/src/isolation/index.ts:20`
- `Mode@packages/ax-code/src/isolation/index.ts:36`
- `Backend@packages/ax-code/src/isolation/index.ts:37`
- `State@packages/ax-code/src/isolation/index.ts:39`
- `DEFAULT_MODE@packages/ax-code/src/isolation/index.ts:59`
- `DEFAULT_BACKEND@packages/ax-code/src/isolation/index.ts:60`
- `DeniedError@packages/ax-code/src/isolation/index.ts:114`
- `resolve@packages/ax-code/src/isolation/index.ts:125`
- `shouldUseOsSandbox@packages/ax-code/src/isolation/index.ts:152`
- `isProtected@packages/ax-code/src/isolation/index.ts:162`
- `canWrite@packages/ax-code/src/isolation/index.ts:193`
- `assertWrite@packages/ax-code/src/isolation/index.ts:210`
- `assertNetwork@packages/ax-code/src/isolation/index.ts:223`
- `assertBashNetwork@packages/ax-code/src/isolation/index.ts:238`
- `assertBash@packages/ax-code/src/isolation/index.ts:254`
- `OsSandbox@packages/ax-code/src/isolation/os-sandbox.ts:26`
- `Backend@packages/ax-code/src/isolation/os-sandbox.ts:29`

### Tests
- `packages/ax-code/test/isolation/isolation.test.ts`
- `packages/ax-code/test/isolation/os-sandbox-integration.test.ts`
- `packages/ax-code/test/isolation/os-sandbox.test.ts`
- `packages/ax-code/test/pty/pty-output-isolation.test.ts`
- `packages/ax-code/test/server/isolation.test.ts`
- `packages/ax-code/test/session/write-isolation.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (30) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags security,sandbox | hotspot scan |

## 3–7. Protocol steps 3–7

Completed by dual-agent; see agent-protocol.json

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `8f20139566cb50c8` |
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
