# MODULE-AUDIT: server-routes-app-context

| Field | Value |
|-------|-------|
| Unit slug | `server-routes-app-context` |
| Scope | `packages/ax-code/src/server/routes/app-context.ts` |
| Resolved root | `packages/ax-code/src/server/routes/app-context.ts` |
| XL filter | no |
| Wave / effort | Wave 4 / S |
| Risk tags | network, api |
| Status | REVIEWING |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `94e95c161c7deb8e055d8806a5f285e516285715` |
| Analysis fingerprint | `54021eb97b977ac9` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 1 / 182 |
| Inventory ID | W4-03-04 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/server/routes/app-context.ts` | 182 | 1 | 0 | 0 |

### Exports (sample)
- `AppContextRoutes@packages/ax-code/src/server/routes/app-context.ts:18`

### Tests
- `packages/ax-code/test/cli/cmd/tui/routes/session/autonomous-active.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/coalesce.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/footer-view-model.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/format.test.ts`
- `packages/ax-code/test/cli/github-agent-run-context.test.ts`
- `packages/ax-code/test/cli/tui/context-kv-race.test.ts`
- `packages/ax-code/test/code-intelligence/graph-context.test.ts`
- `packages/ax-code/test/context/analyzer.test.ts`
- `packages/ax-code/test/context/generator.test.ts`
- `packages/ax-code/test/context/long-agent-packer.test.ts`
- `packages/ax-code/test/control-plane/workspace-server-sse.test.ts`
- `packages/ax-code/test/lsp/server-config.test.ts`
- `packages/ax-code/test/lsp/server-defs.test.ts`
- `packages/ax-code/test/lsp/server-helpers.test.ts`
- `packages/ax-code/test/lsp/server-profile.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (1) | static map |
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
| Static extract | ok fp `54021eb97b977ac9` |
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
