# MODULE-AUDIT: pkg-script

| Field | Value |
|-------|-------|
| Unit slug | `pkg-script` |
| Scope | `packages/script` |
| Resolved root | `packages/script` |
| XL filter | no |
| Wave / effort | Wave 9 / L |
| Risk tags | quality |
| Status | REVIEWING |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `94e95c161c7deb8e055d8806a5f285e516285715` |
| Analysis fingerprint | `20d1e1733de4dd4d` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 2 / 76 |
| Inventory ID | W9-04 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/script/src/index.ts` | 66 | 1 | 0 | 0 |
| `packages/script/sst-env.d.ts` | 10 | 0 | 0 | 0 |

### Exports (sample)
- `Script@packages/script/src/index.ts:48`

### Tests
- `packages/ax-code/test/acp/event-subscription.test.ts`
- `packages/ax-code/test/cli/tui/sync-subscription.test.ts`
- `packages/ax-code/test/cli/tui/transcript.test.ts`
- `packages/ax-code/test/script/bench-scripts.test.ts`
- `packages/ax-code/test/script/build-deps.test.ts`
- `packages/ax-code/test/script/check-bare-json-parse.test.ts`
- `packages/ax-code/test/script/check-no-effect-solid-in-v4.test.ts`
- `packages/ax-code/test/script/check-tui-layering.test.ts`
- `packages/ax-code/test/script/desktop-release-workflow.test.ts`
- `packages/ax-code/test/script/docs-safety-contract.test.ts`
- `packages/ax-code/test/script/embedded-path.test.ts`
- `packages/ax-code/test/script/esbuild-solid-plugin.test.ts`
- `packages/ax-code/test/script/homebrew-source.test.ts`
- `packages/ax-code/test/script/install-script.test.ts`
- `packages/ax-code/test/script/node-gyp-python.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (1) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags quality | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `20d1e1733de4dd4d` |
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
