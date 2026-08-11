# MODULE-AUDIT: server-routes-provider

| Field | Value |
|-------|-------|
| Unit slug | `server-routes-provider` |
| Scope | `packages/ax-code/src/server/routes/provider.ts` |
| Resolved root | `packages/ax-code/src/server/routes/provider.ts` |
| XL filter | no |
| Wave / effort | Wave 4 / S |
| Risk tags | network, api |
| Status | REVIEWING |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `046510f0ca8a215f632e99fa92aa0633d684cbb9` |
| Analysis fingerprint | `c1467b9b1a296ab2` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 1 / 728 |
| Inventory ID | W4-03-21 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/server/routes/provider.ts` | 728 | 6 | 0 | 0 |

### Exports (sample)
- `shouldShowProviderInList@packages/ax-code/src/server/routes/provider.ts:53`
- `AxEnginePrepareBody@packages/ax-code/src/server/routes/provider.ts:64`
- `AxEngineStartBody@packages/ax-code/src/server/routes/provider.ts:76`
- `AxEngineModelActionBody@packages/ax-code/src/server/routes/provider.ts:87`
- `AxEngineConnectionBody@packages/ax-code/src/server/routes/provider.ts:94`
- `ProviderRoutes@packages/ax-code/src/server/routes/provider.ts:186`

### Tests
- `packages/ax-code/test/cli/cmd/tui/routes/session/autonomous-active.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/coalesce.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/footer-view-model.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/format.test.ts`
- `packages/ax-code/test/cli/providers.test.ts`
- `packages/ax-code/test/cli/tui/c-dialog-provider-auth-errors.test.ts`
- `packages/ax-code/test/cli/tui/dialog-provider-options.test.ts`
- `packages/ax-code/test/control-plane/workspace-server-sse.test.ts`
- `packages/ax-code/test/image/provider.test.ts`
- `packages/ax-code/test/lsp/server-config.test.ts`
- `packages/ax-code/test/lsp/server-defs.test.ts`
- `packages/ax-code/test/lsp/server-helpers.test.ts`
- `packages/ax-code/test/lsp/server-profile.test.ts`
- `packages/ax-code/test/provider/agent-optimization-profile.test.ts`
- `packages/ax-code/test/provider/ax-engine/delete.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (6) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags network,api | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `c1467b9b1a296ab2` |
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
