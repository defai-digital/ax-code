# MODULE-AUDIT: cli-parent

| Field | Value |
|-------|-------|
| Unit slug | `cli-parent` |
| Scope | `packages/ax-code/src/cli` |
| Resolved root | `packages/ax-code/src/cli` |
| XL filter | no |
| Wave / effort | Wave 6 / L |
| Risk tags | cli |
| Status | REVIEWING |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `ad9a854c3f8f6cc3ffc48c356a2546d3f23e9945` |
| Analysis fingerprint | `07014f7df0c0521f` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 330 / 55659 |
| Inventory ID | W6-00 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/cli/attach-auth.ts` | 11 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/boolean-flag.ts` | 27 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/boot-node.ts` | 153 | 6 | 0 | 0 |
| `packages/ax-code/src/cli/boot.ts` | 278 | 7 | 0 | 0 |
| `packages/ax-code/src/cli/bootstrap/env.ts` | 187 | 11 | 0 | 0 |
| `packages/ax-code/src/cli/bootstrap/fatal.ts` | 78 | 3 | 0 | 0 |
| `packages/ax-code/src/cli/bootstrap/migrate.ts` | 65 | 2 | 0 | 0 |
| `packages/ax-code/src/cli/bootstrap/windows-console.ts` | 58 | 3 | 0 | 0 |
| `packages/ax-code/src/cli/bootstrap.ts` | 18 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/account.ts` | 269 | 8 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/acp.ts` | 100 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/agent.ts` | 272 | 5 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/audit.ts` | 210 | 3 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/branch.ts` | 71 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/capability.ts` | 54 | 2 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/cmd.ts` | 8 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/compare.ts` | 191 | 2 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/context.ts` | 130 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/db.ts` | 2 | 0 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/debug/agent.ts` | 178 | 4 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/debug/config.ts` | 17 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/debug/explain-impl.ts` | 1203 | 11 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/debug/explain.ts` | 2 | 0 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/debug/file.ts` | 98 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/debug/index.ts` | 58 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/debug/lsp.ts` | 54 | 3 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/debug/perf.ts` | 588 | 8 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/debug/replay.ts` | 248 | 2 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/debug/ripgrep.ts` | 88 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/debug/scrap.ts` | 17 | 1 | 0 | 0 |

### Exports (sample)
- `buildAttachAuthHeaders@packages/ax-code/src/cli/attach-auth.ts:3`
- `cliBooleanFlagValue@packages/ax-code/src/cli/boolean-flag.ts:4`
- `hooks@packages/ax-code/src/cli/boot-node.ts:39`
- `clearForcedExitTimer@packages/ax-code/src/cli/boot-node.ts:46`
- `FORCED_EXIT_GRACE_MS@packages/ax-code/src/cli/boot-node.ts:53`
- `scheduleForcedExit@packages/ax-code/src/cli/boot-node.ts:55`
- `cli@packages/ax-code/src/cli/boot-node.ts:65`
- `run@packages/ax-code/src/cli/boot-node.ts:136`
- `clearForcedExitTimer@packages/ax-code/src/cli/boot.ts:131`
- `FORCED_EXIT_GRACE_MS@packages/ax-code/src/cli/boot.ts:138`
- `scheduleForcedExit@packages/ax-code/src/cli/boot.ts:140`
- `hooks@packages/ax-code/src/cli/boot.ts:150`
- `removeHooks@packages/ax-code/src/cli/boot.ts:157`
- `cli@packages/ax-code/src/cli/boot.ts:164`
- `run@packages/ax-code/src/cli/boot.ts:236`
- `Opts@packages/ax-code/src/cli/bootstrap/env.ts:14`
- `InitDep@packages/ax-code/src/cli/bootstrap/env.ts:23`
- `RestoreOriginalCwdDep@packages/ax-code/src/cli/bootstrap/env.ts:36`
- `RuntimeFlagOptions@packages/ax-code/src/cli/bootstrap/env.ts:42`
- `seedRuntimeFlags@packages/ax-code/src/cli/bootstrap/env.ts:55`

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
| Module contract | public exports (1229) | static map |
| Silent failure | empty catch (4) | per-site disposition in findings |
| Secrets/process/IO | risk tags cli | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-cli-parent-empty-catch | silent-error | Low | new | deferred |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `07014f7df0c0521f` |
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
