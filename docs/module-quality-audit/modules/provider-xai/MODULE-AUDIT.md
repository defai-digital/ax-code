# MODULE-AUDIT: provider-xai

| Field | Value |
|-------|-------|
| Unit slug | `provider-xai` |
| Scope | `packages/ax-code/src/provider/xai` |
| Resolved root | `packages/ax-code/src/provider/xai` |
| XL filter | no |
| Wave / effort | Wave 5 / M |
| Risk tags | security |
| Status | REVIEWING |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `94e95c161c7deb8e055d8806a5f285e516285715` |
| Analysis fingerprint | `b797ab1c5a2c4bb3` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 2 / 196 |
| Inventory ID | W5-04 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/provider/xai/auth-plugin.ts` | 120 | 1 | 0 | 0 |
| `packages/ax-code/src/provider/xai/server-tools.ts` | 76 | 3 | 0 | 0 |

### Exports (sample)
- `xaiAuthPlugin@packages/ax-code/src/provider/xai/auth-plugin.ts:119`
- `LiveSearchConfig@packages/ax-code/src/provider/xai/server-tools.ts:32`
- `supportsLiveSearch@packages/ax-code/src/provider/xai/server-tools.ts:56`
- `buildSearchParameters@packages/ax-code/src/provider/xai/server-tools.ts:68`

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
| Module contract | public exports (4) | static map |
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
| Static extract | ok fp `b797ab1c5a2c4bb3` |
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
