# MODULE-AUDIT: provider-retry-errors

| Field | Value |
|-------|-------|
| Unit slug | `provider-retry-errors` |
| Scope | `packages/ax-code/src/provider (retry/error translation)` |
| Resolved root | `packages/ax-code/src/provider` |
| XL filter | yes |
| Wave / effort | Wave 5 / M |
| Risk tags | stability |
| Status | REVIEWING |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `ad9a854c3f8f6cc3ffc48c356a2546d3f23e9945` |
| Analysis fingerprint | `f13bc833500a025c` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 3 / 455 |
| Inventory ID | W5-01d |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/provider/cli/effort.ts` | 31 | 4 | 0 | 0 |
| `packages/ax-code/src/provider/effort-label.ts` | 157 | 7 | 0 | 0 |
| `packages/ax-code/src/provider/error.ts` | 267 | 7 | 0 | 0 |

### Exports (sample)
- `cliEffortLevels@packages/ax-code/src/provider/cli/effort.ts:7`
- `cliEffortVariants@packages/ax-code/src/provider/cli/effort.ts:11`
- `cliEffortFromProviderOptions@packages/ax-code/src/provider/cli/effort.ts:15`
- `cliEffortArgs@packages/ax-code/src/provider/cli/effort.ts:24`
- `EffortOption@packages/ax-code/src/provider/effort-label.ts:9`
- `effortLabel@packages/ax-code/src/provider/effort-label.ts:77`
- `effortDescription@packages/ax-code/src/provider/effort-label.ts:85`
- `effortDisplay@packages/ax-code/src/provider/effort-label.ts:99`
- `effortChangeMessage@packages/ax-code/src/provider/effort-label.ts:104`
- `effortOptions@packages/ax-code/src/provider/effort-label.ts:120`
- `clampEffort@packages/ax-code/src/provider/effort-label.ts:149`
- `ProviderError@packages/ax-code/src/provider/error.ts:10`
- `parseJsonRecord@packages/ax-code/src/provider/error.ts:77`
- `responseBodyErrorMessage@packages/ax-code/src/provider/error.ts:81`
- `ParsedStreamError@packages/ax-code/src/provider/error.ts:154`
- `parseStreamError@packages/ax-code/src/provider/error.ts:167`
- `ParsedAPICallError@packages/ax-code/src/provider/error.ts:206`
- `parseAPICallError@packages/ax-code/src/provider/error.ts:222`

### Tests
- `packages/ax-code/test/cli/providers.test.ts`
- `packages/ax-code/test/cli/tui/c-dialog-provider-auth-errors.test.ts`
- `packages/ax-code/test/cli/tui/dialog-provider-options.test.ts`
- `packages/ax-code/test/fixture/workflow/verified-bug-sweep-seeded/src/retry.ts`
- `packages/ax-code/test/image/provider.test.ts`
- `packages/ax-code/test/provider/agent-optimization-profile.test.ts`
- `packages/ax-code/test/provider/ax-engine/delete.test.ts`
- `packages/ax-code/test/provider/ax-engine/download-job.test.ts`
- `packages/ax-code/test/provider/ax-engine/download-progress.test.ts`
- `packages/ax-code/test/provider/ax-engine/hf-cache.test.ts`
- `packages/ax-code/test/provider/ax-engine/install.test.ts`
- `packages/ax-code/test/provider/ax-engine/lifecycle.test.ts`
- `packages/ax-code/test/provider/ax-engine/python.test.ts`
- `packages/ax-code/test/provider/ax-engine.test.ts`
- `packages/ax-code/test/provider/cli/attachments.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (18) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags stability | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `f13bc833500a025c` |
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
