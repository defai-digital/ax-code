# MODULE-AUDIT: provider-registry

| Field | Value |
|-------|-------|
| Unit slug | `provider-registry` |
| Scope | `packages/ax-code/src/provider (registry/routing)` |
| Resolved root | `packages/ax-code/src/provider` |
| XL filter | yes |
| Wave / effort | Wave 5 / L |
| Risk tags | hot-path, correctness |
| Status | REVIEWING |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8a38b90b950855545c6b2479220274357904f111` |
| Analysis fingerprint | `94435cd205296fca` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 9 / 2666 |
| Inventory ID | W5-01a |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/provider/model-capabilities.ts` | 585 | 11 | 0 | 0 |
| `packages/ax-code/src/provider/model-id.ts` | 16 | 2 | 0 | 0 |
| `packages/ax-code/src/provider/model-info.ts` | 191 | 5 | 0 | 0 |
| `packages/ax-code/src/provider/model-key.ts` | 34 | 5 | 0 | 0 |
| `packages/ax-code/src/provider/model-selectability.ts` | 55 | 3 | 0 | 0 |
| `packages/ax-code/src/provider/model-support.ts` | 98 | 5 | 0 | 0 |
| `packages/ax-code/src/provider/models.ts` | 270 | 7 | 0 | 0 |
| `packages/ax-code/src/provider/provider-impl.ts` | 1415 | 25 | 0 | 0 |
| `packages/ax-code/src/provider/provider.ts` | 2 | 0 | 0 | 0 |

### Exports (sample)
- `RateLimitTier@packages/ax-code/src/provider/model-capabilities.ts:27`
- `FeatureSupport@packages/ax-code/src/provider/model-capabilities.ts:35`
- `ModelCapabilities@packages/ax-code/src/provider/model-capabilities.ts:43`
- `ModelRegistration@packages/ax-code/src/provider/model-capabilities.ts:96`
- `getModelCapabilities@packages/ax-code/src/provider/model-capabilities.ts:478`
- `supportsLongAgent@packages/ax-code/src/provider/model-capabilities.ts:506`
- `getContextPackBudget@packages/ax-code/src/provider/model-capabilities.ts:527`
- `isQwen37MaxModel@packages/ax-code/src/provider/model-capabilities.ts:547`
- `isQwen37PlusModel@packages/ax-code/src/provider/model-capabilities.ts:560`
- `isQwen37MaxOrPlusModel@packages/ax-code/src/provider/model-capabilities.ts:571`
- `listRegisteredModels@packages/ax-code/src/provider/model-capabilities.ts:582`
- `normalizeProviderModelId@packages/ax-code/src/provider/model-id.ts:5`
- `modelIdFinalSegment@packages/ax-code/src/provider/model-id.ts:13`
- `ProviderModel@packages/ax-code/src/provider/model-info.ts:11`
- `ProviderModel@packages/ax-code/src/provider/model-info.ts:62`
- `ProviderInfo@packages/ax-code/src/provider/model-info.ts:64`
- `ProviderInfo@packages/ax-code/src/provider/model-info.ts:77`
- `fromModelsDevProvider@packages/ax-code/src/provider/model-info.ts:164`
- `ProviderModelKeyInput@packages/ax-code/src/provider/model-key.ts:1`
- `providerModelKey@packages/ax-code/src/provider/model-key.ts:6`

### Tests
- `packages/ax-code/test/cli/providers.test.ts`
- `packages/ax-code/test/cli/tui/c-dialog-provider-auth-errors.test.ts`
- `packages/ax-code/test/cli/tui/dialog-provider-options.test.ts`
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
- `packages/ax-code/test/provider/cli/cli-language-model.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (63) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags hot-path,correctness | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `94435cd205296fca` |
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
