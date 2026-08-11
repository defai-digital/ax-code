# MODULE-AUDIT: cli-cmd-github-agent

| Field | Value |
|-------|-------|
| Unit slug | `cli-cmd-github-agent` |
| Scope | `packages/ax-code/src/cli/cmd/github-agent` |
| Resolved root | `packages/ax-code/src/cli/cmd/github-agent` |
| XL filter | no |
| Wave / effort | Wave 6 / L |
| Risk tags | cli |
| Status | REVIEWING |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `ad9a854c3f8f6cc3ffc48c356a2546d3f23e9945` |
| Analysis fingerprint | `db2efc3168cf09af` |
| Protocol marker | pending dual-agent 9-step |
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

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-cli-cmd-github-agent-empty-catch | silent-error | Low | new | deferred |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `db2efc3168cf09af` |
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
