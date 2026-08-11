# MODULE-AUDIT: desktop-web-git

| Field | Value |
|-------|-------|
| Unit slug | `desktop-web-git` |
| Scope | `desktop/packages/web/server/lib/git` |
| Resolved root | `desktop/packages/web/server/lib/git` |
| XL filter | no |
| Wave / effort | Wave 7 / L |
| Risk tags | desktop |
| Status | SIGNED OFF |
| Reviewer | implementer |
| Independent verifier | codex-sol |
| Baseline commit | `054002dd73198d659d505539f080200bdbc66bc8` |
| Analysis fingerprint | `c213128abd667b16` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 9 / 6270 |
| Inventory ID | W7-10 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/web/server/lib/git/credentials.js` | 79 | 2 | 0 | 0 |
| `desktop/packages/web/server/lib/git/credentials.test.js` | 84 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/git/identity-storage.js` | 135 | 7 | 4 | 0 |
| `desktop/packages/web/server/lib/git/identity-storage.test.js` | 81 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/git/index.js` | 7 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/git/routes.js` | 1099 | 1 | 0 | 0 |
| `desktop/packages/web/server/lib/git/routes.test.js` | 112 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/git/service.js` | 4170 | 61 | 0 | 0 |
| `desktop/packages/web/server/lib/git/service.test.js` | 503 | 0 | 0 | 0 |

### Exports (sample)
- `discoverGitCredentials@desktop/packages/web/server/lib/git/credentials.js:20`
- `getCredentialForHost@desktop/packages/web/server/lib/git/credentials.js:51`
- `loadProfiles@desktop/packages/web/server/lib/git/identity-storage.js:39`
- `saveProfiles@desktop/packages/web/server/lib/git/identity-storage.js:55`
- `getProfiles@desktop/packages/web/server/lib/git/identity-storage.js:67`
- `getProfile@desktop/packages/web/server/lib/git/identity-storage.js:72`
- `createProfile@desktop/packages/web/server/lib/git/identity-storage.js:77`
- `updateProfile@desktop/packages/web/server/lib/git/identity-storage.js:106`
- `deleteProfile@desktop/packages/web/server/lib/git/identity-storage.js:124`
- `registerGitRoutes@desktop/packages/web/server/lib/git/routes.js:1`
- `validateRepositoryFilePaths@desktop/packages/web/server/lib/git/service.js:387`
- `resolveRepositoryFilePath@desktop/packages/web/server/lib/git/service.js:406`
- `isGitRepository@desktop/packages/web/server/lib/git/service.js:1378`
- `getGlobalIdentity@desktop/packages/web/server/lib/git/service.js:1388`
- `getRemoteUrl@desktop/packages/web/server/lib/git/service.js:1411`
- `getCurrentIdentity@desktop/packages/web/server/lib/git/service.js:1422`
- `hasLocalIdentity@desktop/packages/web/server/lib/git/service.js:1449`
- `setLocalIdentity@desktop/packages/web/server/lib/git/service.js:1461`
- `getStatus@desktop/packages/web/server/lib/git/service.js:1485`
- `getDiff@desktop/packages/web/server/lib/git/service.js:1763`

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
- `packages/ax-code/test/server/project-init-git.test.ts`
- `packages/ax-code/test/snapshot/git-output.test.ts`
- `packages/ax-code/test/tool/webfetch.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (71) | static map |
| Silent failure | empty catch (4) | per-site disposition in findings |
| Secrets/process/IO | risk tags desktop | hotspot scan |

## 3–7. Protocol steps 3–7

Step 1: Mapped 9 source files; exports≈74
Step 2: Threat: secrets=6 files, processRisk=0 files, emptyCatch=4
Step 3: Correctness: read control flow for public surfaces; findings=AUDIT-desktop-web-git-empty-catch.md
Step 4: Performance: not hot-path; spot-checked
Step 5: Design: ownership vs ARCHITECTURE/PROJECT_BOUNDARIES for desktop/packages/web/server/lib/git
Step 6: Hygiene: empty=4; notes: desktop/packages/web/server/lib/git/identity-storage.js: 4 empty catch(es) — see empty-catch finding disposition
Step 7: Tests: see MODULE-AUDIT matched tests; regressions for verified-fixed findings
Step 8: Findings disposition complete in findings/
Step 9: Verification commands recorded in STATUS gates; protocol marker written

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-desktop-web-git-empty-catch | silent-error | Low | new | deferred |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `c213128abd667b16` |
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
| Reviewer | implementer | 2026-08-11 | filesRead=9 |
| Independent verifier | codex-sol | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
