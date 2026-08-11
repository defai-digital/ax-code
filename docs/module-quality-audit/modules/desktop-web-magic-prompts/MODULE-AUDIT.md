# MODULE-AUDIT: desktop-web-magic-prompts

| Field | Value |
|-------|-------|
| Unit slug | `desktop-web-magic-prompts` |
| Scope | `desktop/packages/web/server/lib/magic-prompts` |
| Resolved root | `desktop/packages/web/server/lib/magic-prompts` |
| XL filter | no |
| Wave / effort | Wave 7 / S |
| Risk tags | desktop |
| Status | REVIEWING |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `5fefa00cdc847667d3ba3d38509a751498ee4180` |
| Analysis fingerprint | `16e6a7201e088ef1` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 3 / 272 |
| Inventory ID | W7-12 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/web/server/lib/magic-prompts/routes.js` | 63 | 1 | 0 | 0 |
| `desktop/packages/web/server/lib/magic-prompts/runtime.js` | 131 | 1 | 0 | 0 |
| `desktop/packages/web/server/lib/magic-prompts/runtime.test.js` | 78 | 0 | 0 | 0 |

### Exports (sample)
- `registerMagicPromptRoutes@desktop/packages/web/server/lib/magic-prompts/routes.js:3`
- `createMagicPromptRuntime@desktop/packages/web/server/lib/magic-prompts/runtime.js:35`

### Tests
- `packages/ax-code/test/cli/github-agent-prompts.test.ts`
- `packages/ax-code/test/cli/tui/desktop-handoff.test.ts`
- `packages/ax-code/test/desktop/webui.test.ts`
- `packages/ax-code/test/script/desktop-release-workflow.test.ts`
- `packages/ax-code/test/session/debug-workflow-prompts.test.ts`
- `packages/ax-code/test/tool/webfetch.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (2) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags desktop | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `16e6a7201e088ef1` |
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
