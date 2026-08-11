# MODULE-AUDIT: format

| Field | Value |
|-------|-------|
| Unit slug | `format` |
| Scope | `packages/ax-code/src/format` |
| Resolved root | `packages/ax-code/src/format` |
| XL filter | no |
| Wave / effort | Wave 10 / S |
| Risk tags | quality |
| Status | REVIEWING |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `5fefa00cdc847667d3ba3d38509a751498ee4180` |
| Analysis fingerprint | `332eb93fdc75cd8b` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 2 / 637 |
| Inventory ID | W10-03 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/format/formatter.ts` | 434 | 27 | 0 | 0 |
| `packages/ax-code/src/format/index.ts` | 203 | 5 | 0 | 0 |

### Exports (sample)
- `Info@packages/ax-code/src/format/formatter.ts:17`
- `gofmt@packages/ax-code/src/format/formatter.ts:64`
- `mix@packages/ax-code/src/format/formatter.ts:73`
- `prettier@packages/ax-code/src/format/formatter.ts:82`
- `oxfmt@packages/ax-code/src/format/formatter.ts:128`
- `biome@packages/ax-code/src/format/formatter.ts:148`
- `zig@packages/ax-code/src/format/formatter.ts:192`
- `clang@packages/ax-code/src/format/formatter.ts:201`
- `ktlint@packages/ax-code/src/format/formatter.ts:211`
- `ruff@packages/ax-code/src/format/formatter.ts:220`
- `rlang@packages/ax-code/src/format/formatter.ts:250`
- `uvformat@packages/ax-code/src/format/formatter.ts:274`
- `rubocop@packages/ax-code/src/format/formatter.ts:289`
- `standardrb@packages/ax-code/src/format/formatter.ts:298`
- `htmlbeautifier@packages/ax-code/src/format/formatter.ts:307`
- `dart@packages/ax-code/src/format/formatter.ts:316`
- `ocamlformat@packages/ax-code/src/format/formatter.ts:325`
- `terraform@packages/ax-code/src/format/formatter.ts:336`
- `latexindent@packages/ax-code/src/format/formatter.ts:345`
- `gleam@packages/ax-code/src/format/formatter.ts:354`

### Tests
- `packages/ax-code/test/cli/cmd/tui/routes/session/format.test.ts`
- `packages/ax-code/test/cli/tui/session-format.test.ts`
- `packages/ax-code/test/cli/uninstall-format-size.test.ts`
- `packages/ax-code/test/format/format.test.ts`
- `packages/ax-code/test/quality/dre-graph-format.test.ts`
- `packages/ax-code/test/util/format.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (32) | static map |
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
| Static extract | ok fp `332eb93fdc75cd8b` |
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
