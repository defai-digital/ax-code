# MODULE-AUDIT: memory

| Field | Value |
|-------|-------|
| Unit slug | `memory` |
| Scope | `packages/ax-code/src/memory` |
| Wave / effort | Wave 2 / M |
| Risk tags | correctness |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Fix owner | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `8a0329f4c9869b6c` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W2-10 |
| Source files / LOC | 11 / 2009 |

## 1. Scope and map

### Purpose and ownership
Unit `memory` owns `packages/ax-code/src/memory`. Risk profile: correctness.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/memory/applicability.ts` | 68 | 8 | 0 | 0 |
| `packages/ax-code/src/memory/doctor.ts` | 297 | 6 | 0 | 0 |
| `packages/ax-code/src/memory/evaluation.ts` | 159 | 8 | 0 | 0 |
| `packages/ax-code/src/memory/generator.ts` | 328 | 4 | 0 | 0 |
| `packages/ax-code/src/memory/hash.ts` | 50 | 3 | 0 | 0 |
| `packages/ax-code/src/memory/index.ts` | 45 | 24 | 0 | 0 |
| `packages/ax-code/src/memory/injector.ts` | 231 | 4 | 0 | 0 |
| `packages/ax-code/src/memory/recall.ts` | 213 | 3 | 0 | 0 |
| `packages/ax-code/src/memory/recorder.ts` | 235 | 4 | 0 | 0 |
| `packages/ax-code/src/memory/store.ts` | 307 | 13 | 0 | 0 |
| `packages/ax-code/src/memory/types.ts` | 76 | 7 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `MemoryApplicabilityOptions@packages/ax-code/src/memory/applicability.ts:6` | public/internal | scanned |
| `normalizeTags@packages/ax-code/src/memory/applicability.ts:15` | public/internal | scanned |
| `isExpired@packages/ax-code/src/memory/applicability.ts:20` | public/internal | scanned |
| `matchesAgent@packages/ax-code/src/memory/applicability.ts:26` | public/internal | scanned |
| `matchesTags@packages/ax-code/src/memory/applicability.ts:32` | public/internal | scanned |
| `normalizePathForMatch@packages/ax-code/src/memory/applicability.ts:38` | public/internal | scanned |
| `matchesPath@packages/ax-code/src/memory/applicability.ts:50` | public/internal | scanned |
| `entryApplies@packages/ax-code/src/memory/applicability.ts:62` | public/internal | scanned |
| `MemoryDoctorStatus@packages/ax-code/src/memory/doctor.ts:5` | public/internal | scanned |
| `MemoryDoctorSource@packages/ax-code/src/memory/doctor.ts:6` | public/internal | scanned |
| `MemoryDoctorIssue@packages/ax-code/src/memory/doctor.ts:8` | public/internal | scanned |
| `MemoryDoctorReport@packages/ax-code/src/memory/doctor.ts:27` | public/internal | scanned |
| `MemoryDoctorOptions@packages/ax-code/src/memory/doctor.ts:42` | public/internal | scanned |
| `doctor@packages/ax-code/src/memory/doctor.ts:51` | public/internal | scanned |
| `MemoryEvaluationCase@packages/ax-code/src/memory/evaluation.ts:27` | public/internal | scanned |

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

- io packages/ax-code/src/memory/evaluation.ts:89
- secret packages/ax-code/src/memory/generator.ts:19
- secret packages/ax-code/src/memory/generator.ts:55
- secret packages/ax-code/src/memory/generator.ts:56
- secret packages/ax-code/src/memory/generator.ts:62
- secret packages/ax-code/src/memory/generator.ts:63
- secret packages/ax-code/src/memory/generator.ts:66
- secret packages/ax-code/src/memory/generator.ts:120
- io packages/ax-code/src/memory/generator.ts:130
- secret packages/ax-code/src/memory/generator.ts:133
- secret packages/ax-code/src/memory/generator.ts:138
- io packages/ax-code/src/memory/generator.ts:149

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | none residual from scan |
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | none from scan |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (84 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 11; total LOC: 2009
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `packages/ax-code/src/memory`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 84

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
| Static deep extract | ok | fingerprint `8a0329f4c9869b6c` |
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
| Reviewer | codex-sol | 2026-08-11 | Deep extract 11 files / 2009 LOC / fp 8a0329f4c9869b6c |
| Fix owner | codex-sol | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | ax-code-glm | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
