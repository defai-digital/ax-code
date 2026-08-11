# MODULE-AUDIT: shell

| Field | Value |
|-------|-------|
| Unit slug | `shell` |
| Scope | `packages/ax-code/src/shell` |
| Resolved root | `packages/ax-code/src/shell` |
| XL filter | no |
| Wave / effort | Wave 3 / L |
| Risk tags | security |
| Status | REVIEWING |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8a38b90b950855545c6b2479220274357904f111` |
| Analysis fingerprint | `de00b2924e381514` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 1 / 111 |
| Inventory ID | W3-04 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/shell/shell.ts` | 111 | 5 | 0 | 0 |

### Exports (sample)
- `Shell@packages/ax-code/src/shell/shell.ts:15`
- `killTree@packages/ax-code/src/shell/shell.ts:16`
- `isAcceptable@packages/ax-code/src/shell/shell.ts:63`
- `preferred@packages/ax-code/src/shell/shell.ts:93`
- `acceptable@packages/ax-code/src/shell/shell.ts:98`

### Tests
- `packages/ax-code/test/runtime/shell-env.test.ts`
- `packages/ax-code/test/session/prompt-shell-command.test.ts`
- `packages/ax-code/test/shell/shell.test.ts`
- `packages/ax-code/test/support/bun-shell.ts`
- `packages/ax-code/test/util/shell-args.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (5) | static map |
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
| Static extract | ok fp `de00b2924e381514` |
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
