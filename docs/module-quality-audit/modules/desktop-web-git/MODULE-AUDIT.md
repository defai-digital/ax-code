# MODULE-AUDIT: desktop-web-git

| Field | Value |
|-------|-------|
| Unit slug | `desktop-web-git` |
| Scope | `desktop/packages/web/server/lib/git` |
| Resolved root | `desktop/packages/web/server/lib/git` |
| XL filter | no |
| Wave / effort | Wave 7 / L |
| Risk tags | desktop |
| Status | REVIEWING |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `ad9a854c3f8f6cc3ffc48c356a2546d3f23e9945` |
| Analysis fingerprint | `c213128abd667b16` |
| Protocol marker | pending dual-agent 9-step |
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

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-desktop-web-git-empty-catch | silent-error | Low | new | deferred |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `c213128abd667b16` |
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
