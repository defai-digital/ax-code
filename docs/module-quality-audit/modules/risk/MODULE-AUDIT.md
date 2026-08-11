# MODULE-AUDIT: risk

| Field | Value |
|-------|-------|
| Unit slug | `risk` |
| Scope | `packages/ax-code/src/risk` |
| Resolved root | `packages/ax-code/src/risk` |
| XL filter | no |
| Wave / effort | Wave 1 / M |
| Risk tags | security |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `cab6c0089e3b7b3410f050bc9d824c06a3c3a814` |
| Analysis fingerprint | `331aa49c0e0bbf5a` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 1 / 565 |
| Inventory ID | W1-08 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/risk/score.ts` | 565 | 19 | 0 | 0 |

### Exports (sample)
- `Risk@packages/ax-code/src/risk/score.ts:15`
- `Level@packages/ax-code/src/risk/score.ts:16`
- `ValidationState@packages/ax-code/src/risk/score.ts:17`
- `DiffState@packages/ax-code/src/risk/score.ts:18`
- `SemanticRisk@packages/ax-code/src/risk/score.ts:19`
- `Readiness@packages/ax-code/src/risk/score.ts:20`
- `Signals@packages/ax-code/src/risk/score.ts:22`
- `NormalizedSignals@packages/ax-code/src/risk/score.ts:45`
- `Assessment@packages/ax-code/src/risk/score.ts:64`
- `Factor@packages/ax-code/src/risk/score.ts:77`
- `SessionDiffJsonDecodeResult@packages/ax-code/src/risk/score.ts:84`
- `decodeSessionDiffValue@packages/ax-code/src/risk/score.ts:88`
- `decodeSessionDiffJson@packages/ax-code/src/risk/score.ts:93`
- `assess@packages/ax-code/src/risk/score.ts:235`
- `fromSession@packages/ax-code/src/risk/score.ts:395`
- `levelForScore@packages/ax-code/src/risk/score.ts:512`
- `top@packages/ax-code/src/risk/score.ts:545`
- `explain@packages/ax-code/src/risk/score.ts:549`
- `render@packages/ax-code/src/risk/score.ts:553`

### Tests
- `packages/ax-code/test/cli/risk-view.test.ts`
- `packages/ax-code/test/cli/tui/sync-risk-url.test.ts`
- `packages/ax-code/test/cli/tui/sync-session-risk.test.ts`
- `packages/ax-code/test/permission/risk-classes.test.ts`
- `packages/ax-code/test/quality/dre-graph-risk-section.test.ts`
- `packages/ax-code/test/server/session-risk.test.ts`
- `packages/ax-code/test/session/risk.test.ts`
- `packages/ax-code/test/visual/risk-summary.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (19) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags security | hotspot scan |

## 3–7. Protocol steps 3–7

Completed by dual-agent; see agent-protocol.json

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `331aa49c0e0bbf5a` |
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
| Reviewer | ax-code-glm | 2026-08-11 | filesRead=2 |
| Independent verifier | codex-sol | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
