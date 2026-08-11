# MODULE-AUDIT: permission

| Field | Value |
|-------|-------|
| Unit slug | `permission` |
| Scope | `packages/ax-code/src/permission` |
| Resolved root | `packages/ax-code/src/permission` |
| XL filter | no |
| Wave / effort | Wave 3 / L |
| Risk tags | security, trust |
| Status | REVIEWING |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8a38b90b950855545c6b2479220274357904f111` |
| Analysis fingerprint | `1f3cc633b17d6cb8` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 5 / 948 |
| Inventory ID | W3-01 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/permission/arity.ts` | 164 | 2 | 0 | 0 |
| `packages/ax-code/src/permission/evaluate.ts` | 16 | 1 | 0 | 0 |
| `packages/ax-code/src/permission/index.ts` | 683 | 29 | 0 | 0 |
| `packages/ax-code/src/permission/risk-classes.ts` | 79 | 1 | 0 | 0 |
| `packages/ax-code/src/permission/schema.ts` | 6 | 2 | 0 | 0 |

### Exports (sample)
- `BashArity@packages/ax-code/src/permission/arity.ts:1`
- `prefix@packages/ax-code/src/permission/arity.ts:2`
- `evaluate@packages/ax-code/src/permission/evaluate.ts:9`
- `Permission@packages/ax-code/src/permission/index.ts:26`
- `Action@packages/ax-code/src/permission/index.ts:29`
- `Action@packages/ax-code/src/permission/index.ts:32`
- `Rule@packages/ax-code/src/permission/index.ts:34`
- `Rule@packages/ax-code/src/permission/index.ts:43`
- `Ruleset@packages/ax-code/src/permission/index.ts:45`
- `Ruleset@packages/ax-code/src/permission/index.ts:48`
- `Request@packages/ax-code/src/permission/index.ts:50`
- `Request@packages/ax-code/src/permission/index.ts:68`
- `Reply@packages/ax-code/src/permission/index.ts:70`
- `Reply@packages/ax-code/src/permission/index.ts:71`
- `Event@packages/ax-code/src/permission/index.ts:73`
- `RejectedError@packages/ax-code/src/permission/index.ts:85`
- `CorrectedError@packages/ax-code/src/permission/index.ts:93`
- `DeniedError@packages/ax-code/src/permission/index.ts:124`
- `Error@packages/ax-code/src/permission/index.ts:142`
- `AskInput@packages/ax-code/src/permission/index.ts:144`

### Tests
- `packages/ax-code/test/cli/tui/p-permission-question-reply-sdk-error.test.ts`
- `packages/ax-code/test/cli/tui/permission-submit-latch.test.ts`
- `packages/ax-code/test/config/permission-env.test.ts`
- `packages/ax-code/test/mcp/permission-contract.test.ts`
- `packages/ax-code/test/mcp/permission-pattern.test.ts`
- `packages/ax-code/test/permission/arity.test.ts`
- `packages/ax-code/test/permission/next.test.ts`
- `packages/ax-code/test/permission/risk-classes.test.ts`
- `packages/ax-code/test/permission-task.test.ts`
- `packages/ax-code/test/tool/network-search-permission.test.ts`
- `packages/ax-code/test/visual/permission.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (35) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags security,trust | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-permission-001 | security | Critical | prior/new | verified-fixed |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `1f3cc633b17d6cb8` |
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
