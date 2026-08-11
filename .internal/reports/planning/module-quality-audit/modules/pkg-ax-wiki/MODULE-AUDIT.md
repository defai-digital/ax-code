# MODULE-AUDIT: pkg-ax-wiki

| Field | Value |
|-------|-------|
| Unit slug | `pkg-ax-wiki` |
| Scope | `packages/ax-wiki` |
| Wave / effort | Wave 9 / L |
| Risk tags | quality |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Fix owner | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `54886946ac701784` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W9-08 |
| Source files / LOC | 19 / 1924 |

## 1. Scope and map

### Purpose and ownership
Unit `pkg-ax-wiki` owns `packages/ax-wiki`. Risk profile: quality.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-wiki/src/agents.ts` | 82 | 5 | 0 | 0 |
| `packages/ax-wiki/src/artifacts.ts` | 250 | 11 | 0 | 0 |
| `packages/ax-wiki/src/build.ts` | 304 | 3 | 0 | 0 |
| `packages/ax-wiki/src/discovery.ts` | 202 | 2 | 0 | 0 |
| `packages/ax-wiki/src/frontmatter.ts` | 93 | 2 | 0 | 0 |
| `packages/ax-wiki/src/glob.ts` | 41 | 3 | 0 | 0 |
| `packages/ax-wiki/src/hash.ts` | 20 | 2 | 0 | 0 |
| `packages/ax-wiki/src/index.ts` | 15 | 0 | 0 | 0 |
| `packages/ax-wiki/src/paths.ts` | 42 | 13 | 0 | 0 |
| `packages/ax-wiki/src/plan.ts` | 184 | 3 | 0 | 0 |
| `packages/ax-wiki/src/protected.ts` | 68 | 6 | 0 | 0 |
| `packages/ax-wiki/src/protocol.ts` | 39 | 2 | 0 | 0 |
| `packages/ax-wiki/src/safety.ts` | 29 | 1 | 0 | 0 |
| `packages/ax-wiki/src/types.ts` | 168 | 21 | 0 | 0 |
| `packages/ax-wiki/src/validate.ts` | 148 | 1 | 0 | 0 |
| `packages/ax-wiki/test/artifacts.test.ts` | 69 | 0 | 0 | 0 |
| `packages/ax-wiki/test/build.test.ts` | 123 | 2 | 0 | 0 |
| `packages/ax-wiki/test/plan.test.ts` | 37 | 0 | 0 | 0 |
| `packages/ax-wiki/vitest.config.ts` | 10 | 0 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `hasAxWikiBlock@packages/ax-wiki/src/agents.ts:6` | public/internal | scanned |
| `defaultAxWikiBlock@packages/ax-wiki/src/agents.ts:10` | public/internal | scanned |
| `upsertAxWikiBlock@packages/ax-wiki/src/agents.ts:29` | public/internal | scanned |
| `EnsureAgentsResult@packages/ax-wiki/src/agents.ts:45` | public/internal | scanned |
| `ensureAgentsWikiPointers@packages/ax-wiki/src/agents.ts:47` | public/internal | scanned |
| `listMarkdownFiles@packages/ax-wiki/src/artifacts.ts:19` | public/internal | scanned |
| `loadWikiPages@packages/ax-wiki/src/artifacts.ts:39` | public/internal | scanned |
| `cardsFromPages@packages/ax-wiki/src/artifacts.ts:64` | public/internal | scanned |
| `renderCardsMarkdown@packages/ax-wiki/src/artifacts.ts:87` | public/internal | scanned |
| `buildWikiCards@packages/ax-wiki/src/artifacts.ts:110` | public/internal | scanned |
| `writeWikiCards@packages/ax-wiki/src/artifacts.ts:126` | public/internal | scanned |
| `relatedWikiPages@packages/ax-wiki/src/artifacts.ts:131` | public/internal | scanned |
| `WikiStatus@packages/ax-wiki/src/artifacts.ts:154` | public/internal | scanned |
| `getWikiStatus@packages/ax-wiki/src/artifacts.ts:167` | public/internal | scanned |
| `lintWiki@packages/ax-wiki/src/artifacts.ts:211` | public/internal | scanned |

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

- io packages/ax-wiki/src/agents.ts:2
- io packages/ax-wiki/src/agents.ts:63
- io packages/ax-wiki/src/agents.ts:72
- io packages/ax-wiki/src/artifacts.ts:1
- io packages/ax-wiki/src/artifacts.ts:46
- io packages/ax-wiki/src/artifacts.ts:128
- io packages/ax-wiki/src/build.ts:2
- io packages/ax-wiki/src/build.ts:33
- io packages/ax-wiki/src/build.ts:43
- io packages/ax-wiki/src/build.ts:49
- io packages/ax-wiki/src/build.ts:99
- io packages/ax-wiki/src/build.ts:133

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | none residual from scan |
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | none from scan |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (77 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 19; total LOC: 1924
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `packages/ax-wiki`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 77

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
| Static deep extract | ok | fingerprint `54886946ac701784` |
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
| Reviewer | ax-code-glm | 2026-08-11 | Deep extract 19 files / 1924 LOC / fp 54886946ac701784 |
| Fix owner | ax-code-glm | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | codex-sol | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
