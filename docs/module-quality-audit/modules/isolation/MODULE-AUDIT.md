# MODULE-AUDIT: isolation

| Field | Value |
|-------|-------|
| Unit slug | `isolation` |
| Scope | `packages/ax-code/src/isolation` |
| Resolved root | `packages/ax-code/src/isolation` |
| XL filter | no |
| Wave / effort | Wave 3 / L |
| Risk tags | security, sandbox |
| Status | REVIEWING |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8a38b90b950855545c6b2479220274357904f111` |
| Analysis fingerprint | `8f20139566cb50c8` |
| Protocol marker | pending dual-agent 9-step |
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

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `8f20139566cb50c8` |
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
