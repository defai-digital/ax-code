# MODULE-AUDIT: provider-stream

| Field | Value |
|-------|-------|
| Unit slug | `provider-stream` |
| Scope | `packages/ax-code/src/provider (stream transforms)` |
| Resolved root | `packages/ax-code/src/provider` |
| XL filter | yes |
| Wave / effort | Wave 5 / L |
| Risk tags | hot-path, stability |
| Status | REVIEWING |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8a38b90b950855545c6b2479220274357904f111` |
| Analysis fingerprint | `ca7d50f9fc9c6c48` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 2 / 841 |
| Inventory ID | W5-01b |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/provider/transform.ts` | 791 | 13 | 0 | 0 |
| `packages/ax-code/src/provider/usage.ts` | 50 | 4 | 0 | 0 |

### Exports (sample)
- `ProviderTransform@packages/ax-code/src/provider/transform.ts:24`
- `OUTPUT_TOKEN_MAX@packages/ax-code/src/provider/transform.ts:25`
- `message@packages/ax-code/src/provider/transform.ts:231`
- `temperature@packages/ax-code/src/provider/transform.ts:237`
- `topP@packages/ax-code/src/provider/transform.ts:245`
- `topK@packages/ax-code/src/provider/transform.ts:251`
- `variants@packages/ax-code/src/provider/transform.ts:355`
- `options@packages/ax-code/src/provider/transform.ts:481`
- `sanitizeOptions@packages/ax-code/src/provider/transform.ts:582`
- `smallOptions@packages/ax-code/src/provider/transform.ts:637`
- `providerOptions@packages/ax-code/src/provider/transform.ts:662`
- `maxOutputTokens@packages/ax-code/src/provider/transform.ts:667`
- `schema@packages/ax-code/src/provider/transform.ts:693`
- `USAGE_SOURCE_KEY@packages/ax-code/src/provider/usage.ts:3`
- `UsageSource@packages/ax-code/src/provider/usage.ts:5`
- `markEstimatedUsage@packages/ax-code/src/provider/usage.ts:19`
- `usageSource@packages/ax-code/src/provider/usage.ts:28`

### Tests
- `packages/ax-code/test/cli/providers.test.ts`
- `packages/ax-code/test/cli/tui/c-dialog-provider-auth-errors.test.ts`
- `packages/ax-code/test/cli/tui/coalesce-stream-events.test.ts`
- `packages/ax-code/test/cli/tui/dialog-provider-options.test.ts`
- `packages/ax-code/test/cli/tui/stream-paint.test.ts`
- `packages/ax-code/test/cli/tui/stream-resilience.test.ts`
- `packages/ax-code/test/cli/tui/worker-event-stream.test.ts`
- `packages/ax-code/test/image/provider.test.ts`
- `packages/ax-code/test/provider/agent-optimization-profile.test.ts`
- `packages/ax-code/test/provider/ax-engine/delete.test.ts`
- `packages/ax-code/test/provider/ax-engine/download-job.test.ts`
- `packages/ax-code/test/provider/ax-engine/download-progress.test.ts`
- `packages/ax-code/test/provider/ax-engine/hf-cache.test.ts`
- `packages/ax-code/test/provider/ax-engine/install.test.ts`
- `packages/ax-code/test/provider/ax-engine/lifecycle.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (17) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags hot-path,stability | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `ca7d50f9fc9c6c48` |
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
