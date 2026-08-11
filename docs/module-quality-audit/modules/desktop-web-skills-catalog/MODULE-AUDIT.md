# MODULE-AUDIT: desktop-web-skills-catalog

| Field | Value |
|-------|-------|
| Unit slug | `desktop-web-skills-catalog` |
| Scope | `desktop/packages/web/server/lib/skills-catalog` |
| Resolved root | `desktop/packages/web/server/lib/skills-catalog` |
| XL filter | no |
| Wave / effort | Wave 7 / M |
| Risk tags | desktop |
| Status | REVIEWING |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `046510f0ca8a215f632e99fa92aa0633d684cbb9` |
| Analysis fingerprint | `06ddcb243f38f846` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 18 / 1977 |
| Inventory ID | W7-19 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/web/server/lib/skills-catalog/cache.js` | 30 | 4 | 0 | 0 |
| `desktop/packages/web/server/lib/skills-catalog/clawdhub/api.js` | 158 | 4 | 0 | 0 |
| `desktop/packages/web/server/lib/skills-catalog/clawdhub/index.js` | 26 | 3 | 0 | 0 |
| `desktop/packages/web/server/lib/skills-catalog/clawdhub/install.js` | 230 | 2 | 0 | 0 |
| `desktop/packages/web/server/lib/skills-catalog/clawdhub/install.test.js` | 69 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/skills-catalog/clawdhub/scan.js` | 129 | 2 | 0 | 0 |
| `desktop/packages/web/server/lib/skills-catalog/clawdhub/scan.test.js` | 102 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/skills-catalog/curated-sources.js` | 57 | 2 | 0 | 0 |
| `desktop/packages/web/server/lib/skills-catalog/curated-sources.test.js` | 18 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/skills-catalog/git.js` | 98 | 4 | 0 | 0 |
| `desktop/packages/web/server/lib/skills-catalog/git.test.js` | 30 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/skills-catalog/index.js` | 29 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/skills-catalog/install.js` | 287 | 1 | 0 | 0 |
| `desktop/packages/web/server/lib/skills-catalog/scan.js` | 163 | 1 | 0 | 0 |
| `desktop/packages/web/server/lib/skills-catalog/shared.js` | 163 | 12 | 0 | 0 |
| `desktop/packages/web/server/lib/skills-catalog/shared.test.js` | 157 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/skills-catalog/source.js` | 146 | 1 | 0 | 0 |
| `desktop/packages/web/server/lib/skills-catalog/source.test.js` | 85 | 0 | 0 | 0 |

### Exports (sample)
- `getCacheKey@desktop/packages/web/server/lib/skills-catalog/cache.js:5`
- `getCachedScan@desktop/packages/web/server/lib/skills-catalog/cache.js:12`
- `setCachedScan@desktop/packages/web/server/lib/skills-catalog/cache.js:22`
- `clearCache@desktop/packages/web/server/lib/skills-catalog/cache.js:27`
- `fetchClawdHubSkills@desktop/packages/web/server/lib/skills-catalog/clawdhub/api.js:59`
- `fetchClawdHubSkillVersion@desktop/packages/web/server/lib/skills-catalog/clawdhub/api.js:91`
- `downloadClawdHubSkill@desktop/packages/web/server/lib/skills-catalog/clawdhub/api.js:123`
- `fetchClawdHubSkillInfo@desktop/packages/web/server/lib/skills-catalog/clawdhub/api.js:147`
- `isClawdHubSource@desktop/packages/web/server/lib/skills-catalog/clawdhub/index.js:17`
- `CLAWDHUB_SOURCE_ID@desktop/packages/web/server/lib/skills-catalog/clawdhub/index.js:24`
- `CLAWDHUB_SOURCE_STRING@desktop/packages/web/server/lib/skills-catalog/clawdhub/index.js:25`
- `validateClawdHubZipEntries@desktop/packages/web/server/lib/skills-catalog/clawdhub/install.js:25`
- `installSkillsFromClawdHub@desktop/packages/web/server/lib/skills-catalog/clawdhub/install.js:46`
- `scanClawdHub@desktop/packages/web/server/lib/skills-catalog/clawdhub/scan.js:52`
- `scanClawdHubPage@desktop/packages/web/server/lib/skills-catalog/clawdhub/scan.js:101`
- `CURATED_SKILLS_SOURCES@desktop/packages/web/server/lib/skills-catalog/curated-sources.js:1`
- `getCuratedSkillsSources@desktop/packages/web/server/lib/skills-catalog/curated-sources.js:54`
- `looksLikeAuthError@desktop/packages/web/server/lib/skills-catalog/git.js:13`
- `runGit@desktop/packages/web/server/lib/skills-catalog/git.js:24`
- `cloneRepo@desktop/packages/web/server/lib/skills-catalog/git.js:75`

### Tests
- `packages/ax-code/test/cli/tui/capability-catalog.test.ts`
- `packages/ax-code/test/cli/tui/desktop-handoff.test.ts`
- `packages/ax-code/test/desktop/webui.test.ts`
- `packages/ax-code/test/script/desktop-release-workflow.test.ts`
- `packages/ax-code/test/tool/webfetch.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (36) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags desktop | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `06ddcb243f38f846` |
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
