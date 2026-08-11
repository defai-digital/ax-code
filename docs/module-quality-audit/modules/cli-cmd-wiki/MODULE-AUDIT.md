# MODULE-AUDIT: cli-cmd-wiki

| Field | Value |
|-------|-------|
| Unit slug | `cli-cmd-wiki` |
| Scope | `packages/ax-code/src/cli/cmd/wiki` |
| Resolved root | `packages/ax-code/src/cli/cmd/wiki.ts` |
| XL filter | no |
| Wave / effort | Wave 6 / M |
| Risk tags | cli |
| Status | REVIEWING |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `8a38b90b950855545c6b2479220274357904f111` |
| Analysis fingerprint | `3de233291f45a6ce` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 1 / 322 |
| Inventory ID | W6-20 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/cli/cmd/wiki.ts` | 322 | 10 | 0 | 0 |

### Exports (sample)
- `WikiStatusCommand@packages/ax-code/src/cli/cmd/wiki.ts:67`
- `WikiDoctorCommand@packages/ax-code/src/cli/cmd/wiki.ts:81`
- `WikiPlanCommand@packages/ax-code/src/cli/cmd/wiki.ts:116`
- `WikiEnsureAgentsCommand@packages/ax-code/src/cli/cmd/wiki.ts:134`
- `WikiGenerateCommand@packages/ax-code/src/cli/cmd/wiki.ts:214`
- `WikiUpdateCommand@packages/ax-code/src/cli/cmd/wiki.ts:221`
- `WikiLintCommand@packages/ax-code/src/cli/cmd/wiki.ts:228`
- `WikiCardsCommand@packages/ax-code/src/cli/cmd/wiki.ts:255`
- `WikiRelatedCommand@packages/ax-code/src/cli/cmd/wiki.ts:277`
- `WikiCommand@packages/ax-code/src/cli/cmd/wiki.ts:305`

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
| Module contract | public exports (10) | static map |
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
| Static extract | ok fp `3de233291f45a6ce` |
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
