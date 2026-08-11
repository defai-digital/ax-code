# MODULE-AUDIT: cli-cmd-registry

| Field | Value |
|-------|-------|
| Unit slug | `cli-cmd-registry` |
| Scope | `packages/ax-code/src/cli/cmd registry/shims` |
| Resolved root | `packages/ax-code/src/cli/cmd` |
| XL filter | yes |
| Wave / effort | Wave 6 / M |
| Risk tags | cli |
| Status | REVIEWING |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `046510f0ca8a215f632e99fa92aa0633d684cbb9` |
| Analysis fingerprint | `f3a85f9da38e6067` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 1 / 8 |
| Inventory ID | W6-01 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/cli/cmd/cmd.ts` | 8 | 1 | 0 | 0 |

### Exports (sample)
- `cmd@packages/ax-code/src/cli/cmd/cmd.ts:5`

### Tests
- `packages/ax-code/test/acp/sdk-client-naming.test.ts`
- `packages/ax-code/test/cli/account.test.ts`
- `packages/ax-code/test/cli/acp.test.ts`
- `packages/ax-code/test/cli/agent.test.ts`
- `packages/ax-code/test/cli/audit.test.ts`
- `packages/ax-code/test/cli/boot.test.ts`
- `packages/ax-code/test/cli/bootstrap/windows-console.test.ts`
- `packages/ax-code/test/cli/capability.test.ts`
- `packages/ax-code/test/cli/cmd/tui/component/slash-frecency.test.ts`
- `packages/ax-code/test/cli/cmd/tui/prompt-part.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/autonomous-active.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/coalesce.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/footer-view-model.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/format.test.ts`
- `packages/ax-code/test/cli/cmd/tui/ui/glyphs.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (1) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags cli | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `f3a85f9da38e6067` |
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
