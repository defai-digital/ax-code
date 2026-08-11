# MODULE-AUDIT: agent

| Field | Value |
|-------|-------|
| Unit slug | `agent` |
| Scope | `packages/ax-code/src/agent` |
| Resolved root | `packages/ax-code/src/agent` |
| XL filter | no |
| Wave / effort | Wave 2 / L |
| Risk tags | hot-path, security |
| Status | REVIEWING |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `8a38b90b950855545c6b2479220274357904f111` |
| Analysis fingerprint | `e89c06ebea0f46c9` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 2 / 856 |
| Inventory ID | W2-04 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/agent/agent.ts` | 513 | 9 | 0 | 0 |
| `packages/ax-code/src/agent/router.ts` | 343 | 5 | 0 | 0 |

### Exports (sample)
- `Agent@packages/ax-code/src/agent/agent.ts:31`
- `Info@packages/ax-code/src/agent/agent.ts:34`
- `Info@packages/ax-code/src/agent/agent.ts:61`
- `Tier@packages/ax-code/src/agent/agent.ts:63`
- `resolveTier@packages/ax-code/src/agent/agent.ts:65`
- `get@packages/ax-code/src/agent/agent.ts:453`
- `list@packages/ax-code/src/agent/agent.ts:457`
- `defaultAgent@packages/ax-code/src/agent/agent.ts:461`
- `generate@packages/ax-code/src/agent/agent.ts:465`
- `RouteResult@packages/ax-code/src/agent/router.ts:235`
- `route@packages/ax-code/src/agent/router.ts:246`
- `MessageAnalysis@packages/ax-code/src/agent/router.ts:299`
- `classifyComplexity@packages/ax-code/src/agent/router.ts:303`
- `formatComplexityFailureError@packages/ax-code/src/agent/router.ts:340`

### Tests
- `packages/ax-code/test/acp/agent-adapter.test.ts`
- `packages/ax-code/test/acp/agent-interface.test.ts`
- `packages/ax-code/test/acp/agent-prompt.test.ts`
- `packages/ax-code/test/agent/agent.test.ts`
- `packages/ax-code/test/agent/router.test.ts`
- `packages/ax-code/test/cli/agent.test.ts`
- `packages/ax-code/test/cli/debug-agent.test.ts`
- `packages/ax-code/test/cli/github-agent-git-config.test.ts`
- `packages/ax-code/test/cli/github-agent-pr.test.ts`
- `packages/ax-code/test/cli/github-agent-prompts.test.ts`
- `packages/ax-code/test/cli/github-agent-run-context.test.ts`
- `packages/ax-code/test/cli/tui/agent-control-activity.test.ts`
- `packages/ax-code/test/cli/tui/subagent-status-view.test.ts`
- `packages/ax-code/test/config/agent-color.test.ts`
- `packages/ax-code/test/context/long-agent-packer.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (14) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags hot-path,security | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `e89c06ebea0f46c9` |
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
