# MODULE-AUDIT: server-routes-workflow

| Field | Value |
|-------|-------|
| Unit slug | `server-routes-workflow` |
| Scope | `packages/ax-code/src/server/routes/workflow.ts` |
| Resolved root | `packages/ax-code/src/server/routes/workflow.ts` |
| XL filter | no |
| Wave / effort | Wave 4 / S |
| Risk tags | network, api |
| Status | REVIEWING |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `046510f0ca8a215f632e99fa92aa0633d684cbb9` |
| Analysis fingerprint | `7dbd1739cfd4c097` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 1 / 645 |
| Inventory ID | W4-03-36 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/server/routes/workflow.ts` | 645 | 3 | 0 | 0 |

### Exports (sample)
- `WorkflowRunRoutes@packages/ax-code/src/server/routes/workflow.ts:167`
- `WorkflowTemplateRoutes@packages/ax-code/src/server/routes/workflow.ts:492`
- `WorkflowRoutineRoutes@packages/ax-code/src/server/routes/workflow.ts:568`

### Tests
- `packages/ax-code/test/cli/cmd/tui/routes/session/autonomous-active.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/coalesce.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/footer-view-model.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/format.test.ts`
- `packages/ax-code/test/cli/tui/session-workflow-status.test.ts`
- `packages/ax-code/test/cli/tui/workflow-dashboard.test.ts`
- `packages/ax-code/test/cli/workflow.test.ts`
- `packages/ax-code/test/control-plane/workspace-server-sse.test.ts`
- `packages/ax-code/test/fixture/workflow/verified-bug-sweep-seeded/src/auth.ts`
- `packages/ax-code/test/fixture/workflow/verified-bug-sweep-seeded/src/cache.ts`
- `packages/ax-code/test/fixture/workflow/verified-bug-sweep-seeded/src/render.ts`
- `packages/ax-code/test/fixture/workflow/verified-bug-sweep-seeded/src/retry.ts`
- `packages/ax-code/test/lsp/server-config.test.ts`
- `packages/ax-code/test/lsp/server-defs.test.ts`
- `packages/ax-code/test/lsp/server-helpers.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (3) | static map |
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
| Static extract | ok fp `7dbd1739cfd4c097` |
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
