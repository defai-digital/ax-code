# MODULE-AUDIT: sdk

| Field | Value |
|-------|-------|
| Unit slug | `sdk` |
| Scope | `packages/ax-code/src/sdk` |
| Resolved root | `packages/ax-code/src/sdk` |
| XL filter | no |
| Wave / effort | Wave 4 / M |
| Risk tags | api |
| Status | REVIEWING |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `94e95c161c7deb8e055d8806a5f285e516285715` |
| Analysis fingerprint | `9a9511d9510c2b76` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 2 / 1193 |
| Inventory ID | W4-11 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/sdk/programmatic-impl.ts` | 1191 | 2 | 0 | 0 |
| `packages/ax-code/src/sdk/programmatic.ts` | 2 | 0 | 0 | 0 |

### Exports (sample)
- `formatToolArgumentsForPrompt@packages/ax-code/src/sdk/programmatic-impl.ts:96`
- `createAgent@packages/ax-code/src/sdk/programmatic-impl.ts:922`

### Tests
- `packages/ax-code/test/acp/sdk-client-naming.test.ts`
- `packages/ax-code/test/cli/tui/p-permission-question-reply-sdk-error.test.ts`
- `packages/ax-code/test/cli/tui/s-dialog-session-list-rename-sdk-error.test.ts`
- `packages/ax-code/test/cli/tui/sdk-client-naming.test.ts`
- `packages/ax-code/test/sdk/programmatic.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (2) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags api | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `9a9511d9510c2b76` |
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
