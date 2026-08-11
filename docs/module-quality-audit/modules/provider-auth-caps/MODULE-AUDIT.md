# MODULE-AUDIT: provider-auth-caps

| Field | Value |
|-------|-------|
| Unit slug | `provider-auth-caps` |
| Scope | `packages/ax-code/src/provider (auth/capabilities)` |
| Resolved root | `packages/ax-code/src/provider` |
| XL filter | yes |
| Wave / effort | Wave 5 / M |
| Risk tags | security |
| Status | REVIEWING |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `046510f0ca8a215f632e99fa92aa0633d684cbb9` |
| Analysis fingerprint | `ffc83ed09bc97f7d` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 4 / 996 |
| Inventory ID | W5-01c |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/provider/auth.ts` | 236 | 13 | 0 | 0 |
| `packages/ax-code/src/provider/model-capabilities.ts` | 585 | 11 | 0 | 0 |
| `packages/ax-code/src/provider/model-selectability.ts` | 55 | 3 | 0 | 0 |
| `packages/ax-code/src/provider/xai/auth-plugin.ts` | 120 | 1 | 0 | 0 |

### Exports (sample)
- `ProviderAuth@packages/ax-code/src/provider/auth.ts:9`
- `Method@packages/ax-code/src/provider/auth.ts:10`
- `Method@packages/ax-code/src/provider/auth.ts:56`
- `Authorization@packages/ax-code/src/provider/auth.ts:58`
- `Authorization@packages/ax-code/src/provider/auth.ts:67`
- `OauthMissing@packages/ax-code/src/provider/auth.ts:69`
- `OauthCodeMissing@packages/ax-code/src/provider/auth.ts:71`
- `OauthCallbackFailed@packages/ax-code/src/provider/auth.ts:76`
- `ValidationFailed@packages/ax-code/src/provider/auth.ts:78`
- `Error@packages/ax-code/src/provider/auth.ts:86`
- `methods@packages/ax-code/src/provider/auth.ts:112`
- `authorize@packages/ax-code/src/provider/auth.ts:145`
- `callback@packages/ax-code/src/provider/auth.ts:186`
- `RateLimitTier@packages/ax-code/src/provider/model-capabilities.ts:27`
- `FeatureSupport@packages/ax-code/src/provider/model-capabilities.ts:35`
- `ModelCapabilities@packages/ax-code/src/provider/model-capabilities.ts:43`
- `ModelRegistration@packages/ax-code/src/provider/model-capabilities.ts:96`
- `getModelCapabilities@packages/ax-code/src/provider/model-capabilities.ts:478`
- `supportsLongAgent@packages/ax-code/src/provider/model-capabilities.ts:506`
- `getContextPackBudget@packages/ax-code/src/provider/model-capabilities.ts:527`

### Tests
- `packages/ax-code/test/auth/auth.test.ts`
- `packages/ax-code/test/auth/encryption.test.ts`
- `packages/ax-code/test/cli/plugin-auth-picker.test.ts`
- `packages/ax-code/test/cli/providers.test.ts`
- `packages/ax-code/test/cli/tui/c-dialog-provider-auth-errors.test.ts`
- `packages/ax-code/test/cli/tui/dialog-provider-options.test.ts`
- `packages/ax-code/test/fixture/workflow/verified-bug-sweep-seeded/src/auth.ts`
- `packages/ax-code/test/image/provider.test.ts`
- `packages/ax-code/test/mcp/auth.test.ts`
- `packages/ax-code/test/mcp/oauth-auto-connect.test.ts`
- `packages/ax-code/test/mcp/oauth-browser.test.ts`
- `packages/ax-code/test/mcp/oauth-callback.test.ts`
- `packages/ax-code/test/plugin/auth-override.test.ts`
- `packages/ax-code/test/provider/agent-optimization-profile.test.ts`
- `packages/ax-code/test/provider/ax-engine/delete.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (28) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags security | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `ffc83ed09bc97f7d` |
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
