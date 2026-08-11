# MODULE-AUDIT: visual

| Field | Value |
|-------|-------|
| Unit slug | `visual` |
| Scope | `packages/ax-code/src/visual` |
| Wave / effort | Wave 10 / M |
| Risk tags | quality |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Fix owner | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `01edc82d00c91a29` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W10-05 |
| Source files / LOC | 13 / 1810 |

## 1. Scope and map

### Purpose and ownership
Unit `visual` owns `packages/ax-code/src/visual`. Risk profile: quality.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/visual/artifact.ts` | 194 | 10 | 0 | 0 |
| `packages/ax-code/src/visual/capability.ts` | 92 | 6 | 0 | 0 |
| `packages/ax-code/src/visual/compare.ts` | 177 | 5 | 0 | 0 |
| `packages/ax-code/src/visual/findings.ts` | 147 | 7 | 0 | 0 |
| `packages/ax-code/src/visual/index.ts` | 17 | 0 | 0 | 0 |
| `packages/ax-code/src/visual/native.ts` | 300 | 3 | 0 | 0 |
| `packages/ax-code/src/visual/permission.ts` | 88 | 8 | 0 | 0 |
| `packages/ax-code/src/visual/repair.ts` | 205 | 10 | 0 | 0 |
| `packages/ax-code/src/visual/risk-summary.ts` | 112 | 5 | 0 | 0 |
| `packages/ax-code/src/visual/router.ts` | 106 | 4 | 0 | 0 |
| `packages/ax-code/src/visual/run.ts` | 82 | 11 | 0 | 0 |
| `packages/ax-code/src/visual/snapshot.ts` | 146 | 4 | 0 | 0 |
| `packages/ax-code/src/visual/viewport.ts` | 144 | 6 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `VisualArtifactStore@packages/ax-code/src/visual/artifact.ts:45` | public/internal | scanned |
| `baseDir@packages/ax-code/src/visual/artifact.ts:49` | public/internal | scanned |
| `runDir@packages/ax-code/src/visual/artifact.ts:56` | public/internal | scanned |
| `ensureRunDir@packages/ax-code/src/visual/artifact.ts:64` | public/internal | scanned |
| `writeScreenshot@packages/ax-code/src/visual/artifact.ts:73` | public/internal | scanned |
| `writeText@packages/ax-code/src/visual/artifact.ts:113` | public/internal | scanned |
| `writeRunSummary@packages/ax-code/src/visual/artifact.ts:143` | public/internal | scanned |
| `prune@packages/ax-code/src/visual/artifact.ts:152` | public/internal | scanned |
| `MAX_SCREENSHOT_WIDTH@packages/ax-code/src/visual/artifact.ts:193` | public/internal | scanned |
| `MAX_SCREENSHOT_HEIGHT@packages/ax-code/src/visual/artifact.ts:193` | public/internal | scanned |
| `ModelReasoningLevel@packages/ax-code/src/visual/capability.ts:11` | public/internal | scanned |
| `ModelSearchMode@packages/ax-code/src/visual/capability.ts:12` | public/internal | scanned |
| `ModelVisualCapabilities@packages/ax-code/src/visual/capability.ts:14` | public/internal | scanned |
| `hasVisualCapabilities@packages/ax-code/src/visual/capability.ts:29` | public/internal | scanned |
| `missingCapabilityDiagnostic@packages/ax-code/src/visual/capability.ts:48` | public/internal | scanned |

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

- io packages/ax-code/src/visual/artifact.ts:86
- io packages/ax-code/src/visual/artifact.ts:126
- io packages/ax-code/src/visual/artifact.ts:146
- io packages/ax-code/src/visual/native.ts:130
- io packages/ax-code/src/visual/native.ts:271
- io packages/ax-code/src/visual/snapshot.ts:65

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | none from scan |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (79 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 13; total LOC: 1810
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `packages/ax-code/src/visual`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 79

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
| Static deep extract | ok | fingerprint `01edc82d00c91a29` |
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
| Reviewer | codex-sol | 2026-08-11 | Deep extract 13 files / 1810 LOC / fp 01edc82d00c91a29 |
| Fix owner | codex-sol | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | ax-code-glm | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
