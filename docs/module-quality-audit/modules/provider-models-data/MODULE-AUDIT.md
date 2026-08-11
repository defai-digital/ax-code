# MODULE-AUDIT: provider-models-data

| Field | Value |
|-------|-------|
| Unit slug | `provider-models-data` |
| Scope | `packages/ax-code/src/provider (models-snapshot/model data)` |
| Resolved root | `packages/ax-code/src/provider` |
| XL filter | yes |
| Wave / effort | Wave 5 / M |
| Risk tags | correctness |
| Status | REVIEWING |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `046510f0ca8a215f632e99fa92aa0633d684cbb9` |
| Analysis fingerprint | `3c6b1814c1f045df` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 4 / 339 |
| Inventory ID | W5-01e |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/provider/model-id.ts` | 16 | 2 | 0 | 0 |
| `packages/ax-code/src/provider/model-info.ts` | 191 | 5 | 0 | 0 |
| `packages/ax-code/src/provider/model-key.ts` | 34 | 5 | 0 | 0 |
| `packages/ax-code/src/provider/model-support.ts` | 98 | 5 | 0 | 0 |

### Exports (sample)
- `normalizeProviderModelId@packages/ax-code/src/provider/model-id.ts:5`
- `modelIdFinalSegment@packages/ax-code/src/provider/model-id.ts:13`
- `ProviderModel@packages/ax-code/src/provider/model-info.ts:11`
- `ProviderModel@packages/ax-code/src/provider/model-info.ts:62`
- `ProviderInfo@packages/ax-code/src/provider/model-info.ts:64`
- `ProviderInfo@packages/ax-code/src/provider/model-info.ts:77`
- `fromModelsDevProvider@packages/ax-code/src/provider/model-info.ts:164`
- `ProviderModelKeyInput@packages/ax-code/src/provider/model-key.ts:1`
- `providerModelKey@packages/ax-code/src/provider/model-key.ts:6`
- `providerModelEquals@packages/ax-code/src/provider/model-key.ts:10`
- `isProviderModelKeyInput@packages/ax-code/src/provider/model-key.ts:14`
- `providerModelList@packages/ax-code/src/provider/model-key.ts:27`
- `buildModelProbes@packages/ax-code/src/provider/model-support.ts:27`
- `isModelSupportedForProvider@packages/ax-code/src/provider/model-support.ts:33`
- `supportsOpenAIGptModels@packages/ax-code/src/provider/model-support.ts:70`
- `supportsGrok41OrAllowedCodingModel@packages/ax-code/src/provider/model-support.ts:80`
- `supportsGlmModels@packages/ax-code/src/provider/model-support.ts:85`

### Tests
- `packages/ax-code/test/cli/providers.test.ts`
- `packages/ax-code/test/cli/tui/c-dialog-provider-auth-errors.test.ts`
- `packages/ax-code/test/cli/tui/dialog-provider-options.test.ts`
- `packages/ax-code/test/cli/tui/session-list-data.test.ts`
- `packages/ax-code/test/cli/tui/skill-list-data.test.ts`
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

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (17) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags correctness | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `3c6b1814c1f045df` |
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
