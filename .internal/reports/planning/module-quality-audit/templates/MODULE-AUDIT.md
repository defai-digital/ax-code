# Module Audit: `<human-readable unit name>`

| Field | Value |
|-------|-------|
| Unit slug | `<stable-module-slug>` |
| Scope | `<repository path or named sub-surface>` |
| Wave / effort | `<wave>` / `<S, M, L, or split XL>` |
| Risk tags | `<security, persistence, concurrency, hot-path, UI, native, ...>` |
| Status | `MAPPING` |
| Reviewer | `<name/agent>` |
| Fix owner | `<name/agent or none>` |
| Independent verifier | `<required for Critical; otherwise optional>` |
| Baseline commit | `<full commit SHA>` |
| Started / last updated | `YYYY-MM-DD` / `YYYY-MM-DD` |
| Parent / child reports | `<links or none>` |

> Copy this file to `modules/<module-slug>/MODULE-AUDIT.md`. Resolve every
> placeholder. Do not mark the unit signed off until the final checklist is complete.

## 1. Scope and map

### Purpose and ownership

`<What product/runtime responsibility does this unit own? What must it not own?>`

### Source, tests, and artifacts

| Kind | Paths / links | Notes |
|------|---------------|-------|
| Source | `<paths>` | `<hand-written/generated/native/platform>` |
| Tests | `<paths>` | `<unit/integration/e2e/recovery/live/source-pin>` |
| Config/schema | `<paths or none>` | `<defaults and validation boundary>` |
| Persistence/migrations | `<paths or none>` | `<format, locking, retention>` |
| Generated/build artifacts | `<paths or none>` | `<generator and drift check>` |
| Documentation/prior art | `<links>` | `<known contracts, not assumed current proof>` |

### Public API and registrations

| Export / command / route / event | Consumers | Contract and validation | Stability |
|----------------------------------|-----------|-------------------------|-----------|
| `<symbol>` | `<callers>` | `<input/output/error contract>` | `<public/internal/compat>` |

### Callers, callees, and data flow

`<Describe the main control/data flows. Add a compact diagram when three or more
boundaries make the behavior difficult to explain linearly.>`

### Resources and lifecycle

| Resource | Created | Released | Abort/dispose behavior | Persistence/recovery |
|----------|---------|----------|------------------------|----------------------|
| `<timer/process/socket/listener/lock/cache/native handle>` | `<path:symbol>` | `<path:symbol>` | `<behavior>` | `<behavior>` |

### Boundaries

- Ownership/import boundaries: `<core/CLI/server/Desktop/native rules>`
- Trust boundaries: `<repository/user/model/renderer/network/plugin/MCP/provider/FFI>`
- Config/env/CLI surface: `<keys, sources, precedence, validation>`
- Filesystem/network/process scope: `<what can be touched and under whose authority>`

## 2. Threat and failure model

| Asset/invariant | Boundary or trigger | Failure/abuse path | User/system impact | Existing defense | Evidence/test gap |
|-----------------|---------------------|--------------------|--------------------|------------------|-------------------|
| `<asset>` | `<input/lifecycle/race>` | `<path>` | `<impact>` | `<defense>` | `<gap or covered>` |

Required cases considered:

- [ ] malformed, empty, extreme-size, and adversarial inputs
- [ ] untrusted repository/plugin/skill/hook/model/renderer/network input as applicable
- [ ] cancellation, timeout, retry exhaustion, and partial completion
- [ ] concurrent invocation, duplicate delivery, stale callback, and teardown races
- [ ] process/network/native failure and restart/recovery
- [ ] data loss/corruption, secret exposure, privilege expansion, and silent degradation

## 3. Correctness review

### Invariants

1. `<invariant>`
2. `<invariant>`

### Path analysis

| Path | Expected contract | Observed implementation | Evidence/tests | Disposition |
|------|-------------------|-------------------------|----------------|-------------|
| Success | `<contract>` | `<observation>` | `<path/test>` | `<clear/finding>` |
| Empty/invalid | `<contract>` | `<observation>` | `<path/test>` | `<clear/finding>` |
| Retryable failure | `<contract>` | `<observation>` | `<path/test>` | `<clear/finding>` |
| Terminal failure | `<contract>` | `<observation>` | `<path/test>` | `<clear/finding>` |
| Abort/timeout | `<contract>` | `<observation>` | `<path/test>` | `<clear/finding>` |
| Disposal/restart | `<contract>` | `<observation>` | `<path/test>` | `<clear/finding>` |

Review notes:

- Boundary validation: `<result>`
- `Result`/throw/error translation: `<result>`
- Retry/backoff/caps/idempotency: `<result>`
- Abort/cancellation propagation: `<result>`
- Resource/transaction cleanup: `<result>`
- Exit/status/error visibility: `<result>`

## 4. Performance review

### Hot paths and growth risks

| Path/workload | Complexity/IO | Growth bound/cache | Event-loop/render/native impact | Evidence |
|---------------|---------------|--------------------|---------------------------------|----------|
| `<path>` | `<O(), calls, bytes>` | `<bound/invalidation>` | `<impact>` | `<trace/benchmark/static proof>` |

### Baseline and result

| Metric | Environment/workload | Before | After | Variance/repetitions | Finding |
|--------|----------------------|--------|-------|----------------------|---------|
| `<latency/CPU/memory/IO/listeners/startup/bundle>` | `<details>` | `<value>` | `<value or N/A>` | `<details>` | `<ID or clear>` |

Explicitly checked:

- [ ] N+1 IO/RPC and repeated parsing/compilation
- [ ] unbounded collections, queues, listeners, logs, or retained UI/session state
- [ ] synchronous work on Node/Electron event loops
- [ ] missing/stale/unsafe caches and avoidable serialization/copies
- [ ] native versus fallback cost and behavioral equivalence

## 5. Design and boundary review

| Concern | Evidence | Cost/risk | Finding or rationale |
|---------|----------|-----------|----------------------|
| Cohesion/public surface | `<evidence>` | `<cost>` | `<ID/clear>` |
| God file/control flow | `<evidence>` | `<cost>` | `<ID/clear>` |
| Duplicate policy/logic | `<evidence>` | `<cost>` | `<ID/clear>` |
| Policy versus IO | `<evidence>` | `<cost>` | `<ID/clear>` |
| Ownership/import boundary | `<evidence>` | `<cost>` | `<ID/clear>` |
| Validation/testability | `<evidence>` | `<cost>` | `<ID/clear>` |

Architecture and Desktop-boundary conformance: `<result and command/evidence>`

## 6. Dead code and hygiene

| Candidate | Registration/reachability proof | Disposition | Finding |
|-----------|---------------------------------|-------------|---------|
| `<export/branch/flag/TODO/suppression/commented code/docs drift>` | `<proof>` | `<live/dead/deferred>` | `<ID or none>` |

Explicitly checked:

- [ ] unused exports and dynamic/static registrations
- [ ] unreachable/error branches and disabled/platform paths
- [ ] stale flags, compatibility shims, TODO/FIXME/HACK, and commented-out code
- [ ] unsafe casts/suppressions and schema/docs/config drift
- [ ] generated/vendored provenance and retired artifacts

## 7. Test coverage map

| Invariant/risk path | Existing test | Test level | Gap | Added/changed test |
|---------------------|---------------|------------|-----|--------------------|
| `<path>` | `<link or none>` | `<unit/e2e/recovery/etc.>` | `<gap>` | `<link or planned>` |

Coverage or risk-path baseline: `<metric, tool, command, and limitations>`

## 8. Finding register and fix plan

| Finding | Category | Severity | Origin | Status | Fix owner | Target/expiry |
|---------|----------|----------|--------|--------|-----------|---------------|
| [`AUDIT-<slug>-001`](./findings/AUDIT-<slug>-001.md) | `<category>` | `<severity>` | `<new/prior-review/etc.>` | `<state>` | `<owner>` | `<date>` |

### Fix order and blast radius

1. `<finding, minimal approach, impacted units, migration/rollback>`

### Deferrals

| Finding | Rationale | Residual risk/mitigation | Owner | Review/expiry | Approval/ADR |
|---------|-----------|--------------------------|-------|---------------|--------------|
| `<ID>` | `<why not now>` | `<risk/mitigation>` | `<owner>` | `<date>` | `<link>` |

## 9. Verification and exit

### Commands actually run

| Command | Date/environment | Result | Evidence/notes |
|---------|------------------|--------|----------------|
| `<exact command>` | `<date, versions/platform if relevant>` | `<pass/fail/skipped>` | `<summary/artifact>` |

Skipped required gates and reason: `<none or explicit rationale/owner>`

### Delta review

- Baseline-to-signoff source changes: `<commit range and affected paths>`
- Overlapping changes re-reviewed: `<yes/no and evidence>`
- Cross-module impacts acknowledged: `<links or none>`

### Exit checklist

- [ ] Map is complete: purpose, API, callers/callees, ownership, config, persistence,
      resources, generated/native surfaces, and tests.
- [ ] Threat/failure model covers applicable trust, crash, data-loss, silent-failure,
      concurrency, teardown, and recovery paths.
- [ ] Correctness, performance, design, dead-code/hygiene, and tests were reviewed.
- [ ] Every candidate has an evidence-backed disposition.
- [ ] Every accepted finding is `verified-fixed` or policy-compliant `deferred`.
- [ ] Regression tests landed before/with accepted behavioral fixes, or the approved
      alternate proof is documented.
- [ ] Exact affected tests/typechecks/build/boundary commands passed or justified.
- [ ] Critical findings and fixes have independent verification.
- [ ] Metrics and `STATUS.md` are updated.
- [ ] Delta review found no unreviewed overlap since baseline.

### Sign-off

| Role | Name | Date | Evidence/statement |
|------|------|------|--------------------|
| Reviewer | `<name>` | `YYYY-MM-DD` | `<all protocol steps complete>` |
| Fix owner | `<name or N/A>` | `YYYY-MM-DD` | `<accepted fixes/deferrals complete>` |
| Independent verifier | `<name or N/A>` | `YYYY-MM-DD` | `<Critical second-pass evidence>` |
| Module owner | `<name>` | `YYYY-MM-DD` | `<SIGNED OFF approval>` |

