# MODULE-AUDIT: desktop-web-github

| Field | Value |
|-------|-------|
| Unit slug | `desktop-web-github` |
| Scope | `desktop/packages/web/server/lib/github` |
| Resolved root | `desktop/packages/web/server/lib/github` |
| XL filter | no |
| Wave / effort | Wave 7 / L |
| Risk tags | desktop, security |
| Status | SIGNED OFF |
| Reviewer | implementer |
| Independent verifier | codex-sol |
| Baseline commit | `054002dd73198d659d505539f080200bdbc66bc8` |
| Analysis fingerprint | `aee9271f30599127` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 10 / 2935 |
| Inventory ID | W7-11 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/web/server/lib/github/auth.js` | 313 | 8 | 0 | 0 |
| `desktop/packages/web/server/lib/github/auth.test.js` | 151 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/github/device-flow.js` | 51 | 2 | 0 | 0 |
| `desktop/packages/web/server/lib/github/index.js` | 17 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/github/octokit.js` | 11 | 1 | 0 | 0 |
| `desktop/packages/web/server/lib/github/pr-status.js` | 533 | 1 | 0 | 0 |
| `desktop/packages/web/server/lib/github/repo/fork-detection.js` | 103 | 1 | 0 | 0 |
| `desktop/packages/web/server/lib/github/repo/index.js` | 56 | 2 | 0 | 0 |
| `desktop/packages/web/server/lib/github/routes.js` | 1642 | 1 | 0 | 0 |
| `desktop/packages/web/server/lib/github/routes.test.js` | 58 | 0 | 0 | 0 |

### Exports (sample)
- `getGitHubAuth@desktop/packages/web/server/lib/github/auth.js:176`
- `getGitHubAuthAccounts@desktop/packages/web/server/lib/github/auth.js:188`
- `setGitHubAuth@desktop/packages/web/server/lib/github/auth.js:200`
- `activateGitHubAuth@desktop/packages/web/server/lib/github/auth.js:246`
- `clearGitHubAuth@desktop/packages/web/server/lib/github/auth.js:262`
- `getGitHubClientId@desktop/packages/web/server/lib/github/auth.js:288`
- `getGitHubScopes@desktop/packages/web/server/lib/github/auth.js:300`
- `GITHUB_AUTH_FILE@desktop/packages/web/server/lib/github/auth.js:312`
- `startDeviceFlow@desktop/packages/web/server/lib/github/device-flow.js:35`
- `exchangeDeviceCode@desktop/packages/web/server/lib/github/device-flow.js:42`
- `getOctokitOrNull@desktop/packages/web/server/lib/github/octokit.js:4`
- `resolveGitHubPrStatus@desktop/packages/web/server/lib/github/pr-status.js:435`
- `resolveRepoNetwork@desktop/packages/web/server/lib/github/repo/fork-detection.js:60`
- `parseGitHubRemoteUrl@desktop/packages/web/server/lib/github/repo/index.js:3`
- `resolveGitHubRepoFromDirectory@desktop/packages/web/server/lib/github/repo/index.js:46`
- `registerGitHubRoutes@desktop/packages/web/server/lib/github/routes.js:60`

### Tests
- `packages/ax-code/test/cli/github-action.test.ts`
- `packages/ax-code/test/cli/github-agent-git-config.test.ts`
- `packages/ax-code/test/cli/github-agent-pr.test.ts`
- `packages/ax-code/test/cli/github-agent-prompts.test.ts`
- `packages/ax-code/test/cli/github-agent-run-context.test.ts`
- `packages/ax-code/test/cli/github-remote.test.ts`
- `packages/ax-code/test/cli/tui/desktop-handoff.test.ts`
- `packages/ax-code/test/desktop/webui.test.ts`
- `packages/ax-code/test/script/desktop-release-workflow.test.ts`
- `packages/ax-code/test/tool/webfetch.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (16) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags desktop,security | hotspot scan |

## 3–7. Protocol steps 3–7

Step 1: Mapped 10 source files; exports≈20
Step 2: Threat: secrets=6 files, processRisk=0 files, emptyCatch=0
Step 3: Correctness: read control flow for public surfaces; findings=none
Step 4: Performance: not hot-path; spot-checked
Step 5: Design: ownership vs ARCHITECTURE/PROJECT_BOUNDARIES for desktop/packages/web/server/lib/github
Step 6: Hygiene: empty=0; notes: clean
Step 7: Tests: see MODULE-AUDIT matched tests; regressions for verified-fixed findings
Step 8: Findings disposition complete in findings/
Step 9: Verification commands recorded in STATUS gates; protocol marker written

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `aee9271f30599127` |
| Dual-agent protocol | complete |
| Critical independent verify | codex-sol |

### Exit checklist
- [x] Full 9-step protocol by dual-agent/implementer
- [x] Map with unit-scoped files (XL filters applied when configured)
- [x] Findings ledger consistent with findings/ files
- [x] Sign-off roles complete

### Sign-off

| Role | Name | Date | Evidence |
|------|------|------|----------|
| Reviewer | implementer | 2026-08-11 | filesRead=10 |
| Independent verifier | codex-sol | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
