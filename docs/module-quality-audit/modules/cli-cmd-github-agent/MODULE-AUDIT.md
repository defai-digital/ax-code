# MODULE-AUDIT: cli-cmd-github-agent

| Field | Value |
|-------|-------|
| Unit slug | `cli-cmd-github-agent` |
| Scope | `packages/ax-code/src/cli/cmd/github-agent` |
| Resolved root | `packages/ax-code/src/cli/cmd/github-agent` |
| XL filter | no |
| Wave / effort | Wave 6 / L |
| Risk tags | cli |
| Status | SIGNED OFF |
| Reviewer | implementer |
| Independent verifier | ax-code-glm |
| Baseline commit | `054002dd73198d659d505539f080200bdbc66bc8` |
| Analysis fingerprint | `db2efc3168cf09af` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 8 / 1968 |
| Inventory ID | W6-15 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/cli/cmd/github-agent/git-ops.ts` | 218 | 16 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/github-agent/github-api.ts` | 290 | 11 | 1 | 0 |
| `packages/ax-code/src/cli/cmd/github-agent/index.ts` | 21 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/github-agent/install.ts` | 229 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/github-agent/pr.ts` | 160 | 4 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/github-agent/prompts.ts` | 362 | 9 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/github-agent/run.ts` | 511 | 6 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/github-agent/types.ts` | 177 | 23 | 0 | 0 |

### Exports (sample)
- `GitRunner@packages/ax-code/src/cli/cmd/github-agent/git-ops.ts:6`
- `GitTextRunner@packages/ax-code/src/cli/cmd/github-agent/git-ops.ts:7`
- `GitStatusRunner@packages/ax-code/src/cli/cmd/github-agent/git-ops.ts:8`
- `createGitHelpers@packages/ax-code/src/cli/cmd/github-agent/git-ops.ts:10`
- `commitChanges@packages/ax-code/src/cli/cmd/github-agent/git-ops.ts:36`
- `generateBranchName@packages/ax-code/src/cli/cmd/github-agent/git-ops.ts:42`
- `checkoutNewBranch@packages/ax-code/src/cli/cmd/github-agent/git-ops.ts:56`
- `checkoutLocalBranch@packages/ax-code/src/cli/cmd/github-agent/git-ops.ts:63`
- `checkoutForkBranch@packages/ax-code/src/cli/cmd/github-agent/git-ops.ts:71`
- `pushToNewBranch@packages/ax-code/src/cli/cmd/github-agent/git-ops.ts:91`
- `pushToLocalBranch@packages/ax-code/src/cli/cmd/github-agent/git-ops.ts:102`
- `pushToForkBranch@packages/ax-code/src/cli/cmd/github-agent/git-ops.ts:108`
- `branchIsDirty@packages/ax-code/src/cli/cmd/github-agent/git-ops.ts:119`
- `hasNewCommits@packages/ax-code/src/cli/cmd/github-agent/git-ops.ts:145`
- `configureGit@packages/ax-code/src/cli/cmd/github-agent/git-ops.ts:159`
- `restoreGitConfig@packages/ax-code/src/cli/cmd/github-agent/git-ops.ts:195`
- `GitHubClients@packages/ax-code/src/cli/cmd/github-agent/github-api.ts:9`
- `getOidcToken@packages/ax-code/src/cli/cmd/github-agent/github-api.ts:16`
- `exchangeForAppToken@packages/ax-code/src/cli/cmd/github-agent/github-api.ts:27`
- `revokeAppToken@packages/ax-code/src/cli/cmd/github-agent/github-api.ts:65`

### Tests
- `packages/ax-code/test/acp/agent-adapter.test.ts`
- `packages/ax-code/test/acp/agent-interface.test.ts`
- `packages/ax-code/test/acp/agent-prompt.test.ts`
- `packages/ax-code/test/acp/sdk-client-naming.test.ts`
- `packages/ax-code/test/agent/agent.test.ts`
- `packages/ax-code/test/agent/router.test.ts`
- `packages/ax-code/test/cli/account.test.ts`
- `packages/ax-code/test/cli/acp.test.ts`
- `packages/ax-code/test/cli/agent.test.ts`
- `packages/ax-code/test/cli/audit.test.ts`
- `packages/ax-code/test/cli/boot.test.ts`
- `packages/ax-code/test/cli/bootstrap/windows-console.test.ts`
- `packages/ax-code/test/cli/capability.test.ts`
- `packages/ax-code/test/cli/cmd/tui/component/slash-frecency.test.ts`
- `packages/ax-code/test/cli/cmd/tui/prompt-part.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (71) | static map |
| Silent failure | empty catch (1) | per-site disposition in findings |
| Secrets/process/IO | risk tags cli | hotspot scan |

## 3–7. Protocol steps 3–7

Step 1: Mapped 8 source files; exports≈73
Step 2: Threat: secrets=5 files, processRisk=1 files, emptyCatch=1
Step 3: Correctness: read control flow for public surfaces; findings=AUDIT-cli-cmd-github-agent-empty-catch.md
Step 4: Performance: not hot-path; spot-checked
Step 5: Design: ownership vs ARCHITECTURE/PROJECT_BOUNDARIES for packages/ax-code/src/cli/cmd/github-agent
Step 6: Hygiene: empty=1; notes: packages/ax-code/src/cli/cmd/github-agent/github-api.ts: 1 empty catch(es) — see empty-catch finding disposition
Step 7: Tests: see MODULE-AUDIT matched tests; regressions for verified-fixed findings
Step 8: Findings disposition complete in findings/
Step 9: Verification commands recorded in STATUS gates; protocol marker written

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-cli-cmd-github-agent-empty-catch | silent-error | Low | new | deferred |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `db2efc3168cf09af` |
| Dual-agent protocol | complete |
| Critical independent verify | ax-code-glm |

### Exit checklist
- [x] Full 9-step protocol by dual-agent/implementer
- [x] Map with unit-scoped files (XL filters applied when configured)
- [x] Findings ledger consistent with findings/ files
- [x] Sign-off roles complete

### Sign-off

| Role | Name | Date | Evidence |
|------|------|------|----------|
| Reviewer | implementer | 2026-08-11 | filesRead=8 |
| Independent verifier | ax-code-glm | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
