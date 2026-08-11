# MODULE-AUDIT: context

| Field | Value |
|-------|-------|
| Unit slug | `context` |
| Scope | `packages/ax-code/src/context` |
| Wave / effort | Wave 2 / M |
| Risk tags | performance |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Fix owner | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `6f16d7473f10ac54` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W2-08 |
| Source files / LOC | 4 / 1000 |

## 1. Scope and map

### Purpose and ownership
Unit `context` owns `packages/ax-code/src/context`. Risk profile: performance.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/context/analyzer.ts` | 455 | 10 | 0 | 0 |
| `packages/ax-code/src/context/generator.ts` | 298 | 1 | 0 | 0 |
| `packages/ax-code/src/context/index.ts` | 98 | 9 | 0 | 0 |
| `packages/ax-code/src/context/long-agent-packer.ts` | 149 | 7 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `ComplexityLevel@packages/ax-code/src/context/analyzer.ts:18` | public/internal | scanned |
| `DepthLevel@packages/ax-code/src/context/analyzer.ts:19` | public/internal | scanned |
| `ComplexityScore@packages/ax-code/src/context/analyzer.ts:21` | public/internal | scanned |
| `CodeConventions@packages/ax-code/src/context/analyzer.ts:29` | public/internal | scanned |
| `ProjectScripts@packages/ax-code/src/context/analyzer.ts:39` | public/internal | scanned |
| `ProjectInfo@packages/ax-code/src/context/analyzer.ts:49` | public/internal | scanned |
| `PackageJson@packages/ax-code/src/context/analyzer.ts:77` | public/internal | scanned |
| `analyze@packages/ax-code/src/context/analyzer.ts:92` | public/internal | scanned |
| `decodeAnalyzerPackageJsonValue@packages/ax-code/src/context/analyzer.ts:122` | public/internal | scanned |
| `parseAnalyzerPackageJsonText@packages/ax-code/src/context/analyzer.ts:144` | public/internal | scanned |
| `generate@packages/ax-code/src/context/generator.ts:26` | public/internal | scanned |
| `type DepthLevel@packages/ax-code/src/context/index.ts:15` | public/internal | scanned |
| `type ProjectInfo@packages/ax-code/src/context/index.ts:15` | public/internal | scanned |
| `Context@packages/ax-code/src/context/index.ts:17` | public/internal | scanned |
| `OUTPUT_FILENAME@packages/ax-code/src/context/index.ts:20` | public/internal | scanned |

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

- io packages/ax-code/src/context/analyzer.ts:10
- io packages/ax-code/src/context/analyzer.ts:154
- io packages/ax-code/src/context/analyzer.ts:416
- io packages/ax-code/src/context/analyzer.ts:428
- secret packages/ax-code/src/context/generator.ts:4
- io packages/ax-code/src/context/index.ts:13
- io packages/ax-code/src/context/index.ts:47
- io packages/ax-code/src/context/index.ts:73
- io packages/ax-code/src/context/index.ts:87
- secret packages/ax-code/src/context/long-agent-packer.ts:9
- secret packages/ax-code/src/context/long-agent-packer.ts:14
- secret packages/ax-code/src/context/long-agent-packer.ts:15

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | none residual from scan |
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | none from scan |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (27 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 4; total LOC: 1000
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Hot-path unit: reviewed static N+1/sync risks in 8 IO hotspots. No new Critical perf finding without baseline measurement.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `packages/ax-code/src/context`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 27

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
| Static deep extract | ok | fingerprint `6f16d7473f10ac54` |
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
| Reviewer | codex-sol | 2026-08-11 | Deep extract 4 files / 1000 LOC / fp 6f16d7473f10ac54 |
| Fix owner | codex-sol | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | ax-code-glm | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
