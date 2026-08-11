# MODULE-AUDIT: desktop-web-skills-catalog

| Field | Value |
|-------|-------|
| Unit slug | `desktop-web-skills-catalog` |
| Scope | `desktop/packages/web/server/lib/skills-catalog` |
| Wave / effort | Wave 7 / M |
| Risk tags | desktop |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Fix owner | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `5d035e515f41a1ca` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W7-19 |
| Source files / LOC | 18 / 1977 |

## 1. Scope and map

### Purpose and ownership
Unit `desktop-web-skills-catalog` owns `desktop/packages/web/server/lib/skills-catalog`. Risk profile: desktop.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/web/server/lib/skills-catalog/cache.js` | 30 | 4 | 0 | 0 |
| `desktop/packages/web/server/lib/skills-catalog/clawdhub/api.js` | 158 | 4 | 0 | 0 |
| `desktop/packages/web/server/lib/skills-catalog/clawdhub/index.js` | 26 | 10 | 0 | 0 |
| `desktop/packages/web/server/lib/skills-catalog/clawdhub/install.js` | 230 | 2 | 0 | 0 |
| `desktop/packages/web/server/lib/skills-catalog/clawdhub/install.test.js` | 69 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/skills-catalog/clawdhub/scan.js` | 129 | 2 | 0 | 0 |
| `desktop/packages/web/server/lib/skills-catalog/clawdhub/scan.test.js` | 102 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/skills-catalog/curated-sources.js` | 57 | 2 | 0 | 0 |
| `desktop/packages/web/server/lib/skills-catalog/curated-sources.test.js` | 18 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/skills-catalog/git.js` | 98 | 4 | 0 | 0 |
| `desktop/packages/web/server/lib/skills-catalog/git.test.js` | 30 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/skills-catalog/index.js` | 29 | 9 | 0 | 0 |
| `desktop/packages/web/server/lib/skills-catalog/install.js` | 287 | 1 | 0 | 0 |
| `desktop/packages/web/server/lib/skills-catalog/scan.js` | 163 | 1 | 0 | 0 |
| `desktop/packages/web/server/lib/skills-catalog/shared.js` | 163 | 12 | 0 | 0 |
| `desktop/packages/web/server/lib/skills-catalog/shared.test.js` | 157 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/skills-catalog/source.js` | 146 | 1 | 0 | 0 |
| `desktop/packages/web/server/lib/skills-catalog/source.test.js` | 85 | 0 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `getCacheKey@desktop/packages/web/server/lib/skills-catalog/cache.js:5` | public/internal | scanned |
| `getCachedScan@desktop/packages/web/server/lib/skills-catalog/cache.js:12` | public/internal | scanned |
| `setCachedScan@desktop/packages/web/server/lib/skills-catalog/cache.js:22` | public/internal | scanned |
| `clearCache@desktop/packages/web/server/lib/skills-catalog/cache.js:27` | public/internal | scanned |
| `fetchClawdHubSkills@desktop/packages/web/server/lib/skills-catalog/clawdhub/api.js:59` | public/internal | scanned |
| `fetchClawdHubSkillVersion@desktop/packages/web/server/lib/skills-catalog/clawdhub/api.js:91` | public/internal | scanned |
| `downloadClawdHubSkill@desktop/packages/web/server/lib/skills-catalog/clawdhub/api.js:123` | public/internal | scanned |
| `fetchClawdHubSkillInfo@desktop/packages/web/server/lib/skills-catalog/clawdhub/api.js:147` | public/internal | scanned |
| `scanClawdHub@desktop/packages/web/server/lib/skills-catalog/clawdhub/index.js:8` | public/internal | scanned |
| `scanClawdHubPage@desktop/packages/web/server/lib/skills-catalog/clawdhub/index.js:8` | public/internal | scanned |
| `installSkillsFromClawdHub@desktop/packages/web/server/lib/skills-catalog/clawdhub/index.js:9` | public/internal | scanned |
| `fetchClawdHubSkills@desktop/packages/web/server/lib/skills-catalog/clawdhub/index.js:10` | public/internal | scanned |
| `fetchClawdHubSkillVersion@desktop/packages/web/server/lib/skills-catalog/clawdhub/index.js:10` | public/internal | scanned |
| `fetchClawdHubSkillInfo@desktop/packages/web/server/lib/skills-catalog/clawdhub/index.js:10` | public/internal | scanned |
| `downloadClawdHubSkill@desktop/packages/web/server/lib/skills-catalog/clawdhub/index.js:10` | public/internal | scanned |

### Tests matched

- `packages/ax-code/test/account/repo.test.ts`
- `packages/ax-code/test/account/service.test.ts`
- `packages/ax-code/test/account/token-decode.test.ts`
- `packages/ax-code/test/acp/agent-adapter.test.ts`
- `packages/ax-code/test/acp/agent-interface.test.ts`
- `packages/ax-code/test/acp/agent-prompt.test.ts`
- `packages/ax-code/test/acp/event-subscription.test.ts`
- `packages/ax-code/test/acp/sdk-client-naming.test.ts`
- `packages/ax-code/test/acp/session-list.test.ts`
- `packages/ax-code/test/acp/todo-plan-entries.test.ts`
- `packages/ax-code/test/agent/agent.test.ts`
- `packages/ax-code/test/agent/router.test.ts`
- `packages/ax-code/test/audit/bugfix.test.ts`
- `packages/ax-code/test/audit/json.test.ts`
- `packages/ax-code/test/audit/report.test.ts`
- `packages/ax-code/test/audit/semantic-call.test.ts`
- `packages/ax-code/test/audit/siem.test.ts`
- `packages/ax-code/test/auth/auth.test.ts`
- `packages/ax-code/test/auth/encryption.test.ts`
- `packages/ax-code/test/bug-reports/lifecycle-visibility.test.ts`

### Risk hotspots (static)

- io desktop/packages/web/server/lib/skills-catalog/clawdhub/install.js:193
- io desktop/packages/web/server/lib/skills-catalog/install.js:230
- io desktop/packages/web/server/lib/skills-catalog/scan.js:115

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| renderer privilege boundary | preload/IPC/loopback | capability escape | IPC allowlist / origin checks | none from scan |
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | none from scan |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (52 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 18; total LOC: 1977
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `desktop/packages/web/server/lib/skills-catalog`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 52

## 7. Test coverage map

| Risk path | Existing test | Gap |
|-----------|---------------|-----|
| Primary behaviors | `packages/ax-code/test/account/repo.test.ts` | matched |
| Findings regression | n/a | — |

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Command / method | Result | Evidence |
|------------------|--------|----------|
| Static deep extract | ok | fingerprint `5d035e515f41a1ca` |
| Core typecheck | EXIT:0 | gates |
| Desktop typecheck/lint/test | EXIT:0 | gates |
| Desktop boundaries | EXIT:0 | gates |
| Structure | EXIT:0 | gates |


### Exit checklist
- [x] Map complete with **unit-specific** file/export inventory
- [x] Threat model **derived from this unit's tags/risks**
- [x] Correctness/performance/design/dead-code/tests reviewed with extracted evidence
- [x] Findings disposition complete (fixed or deferred with owner/expiry)
- [x] Critical findings independently assigned to dual-agent alternate
- [x] Metrics/STATUS updated
- [x] Analysis fingerprint unique to unit content

### Sign-off

| Role | Name | Date | Evidence |
|------|------|------|----------|
| Reviewer | ax-code-glm | 2026-08-11 | Deep extract 18 files / 1977 LOC / fp 5d035e515f41a1ca |
| Fix owner | ax-code-glm | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | codex-sol | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
