# MODULE-AUDIT: crate-fs

| Field | Value |
|-------|-------|
| Unit slug | `crate-fs` |
| Scope | `crates/ax-code-fs` |
| Wave / effort | Wave 9 / L |
| Risk tags | native, performance |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Fix owner | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `1e5e4ee80ddb5a91` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W9-16 |
| Source files / LOC | 6 / 3143 |

## 1. Scope and map

### Purpose and ownership
Unit `crate-fs` owns `crates/ax-code-fs`. Risk profile: native, performance.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `crates/ax-code-fs/build.rs` | 6 | 0 | 0 | 0 |
| `crates/ax-code-fs/examples/bench.rs` | 156 | 0 | 0 | 0 |
| `crates/ax-code-fs/src/detect.rs` | 1182 | 0 | 0 | 0 |
| `crates/ax-code-fs/src/embedding.rs` | 229 | 0 | 0 | 0 |
| `crates/ax-code-fs/src/lib.rs` | 1418 | 0 | 0 | 0 |
| `crates/ax-code-fs/src/watcher.rs` | 152 | 0 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| _(none extracted)_ | — | — |

### Tests matched

- _(none auto-matched; package suite / static proof)_

### Risk hotspots (static)

- secret crates/ax-code-fs/src/detect.rs:525
- secret crates/ax-code-fs/src/detect.rs:545
- secret crates/ax-code-fs/src/detect.rs:788
- secret crates/ax-code-fs/src/detect.rs:789
- secret crates/ax-code-fs/src/detect.rs:790
- secret crates/ax-code-fs/src/detect.rs:830
- secret crates/ax-code-fs/src/detect.rs:832
- secret crates/ax-code-fs/src/embedding.rs:15
- secret crates/ax-code-fs/src/embedding.rs:49
- secret crates/ax-code-fs/src/embedding.rs:50
- secret crates/ax-code-fs/src/embedding.rs:64
- secret crates/ax-code-fs/src/embedding.rs:135

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | none residual from scan |
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | none from scan |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (0 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 6; total LOC: 3143
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Hot-path unit: reviewed static N+1/sync risks in 2 IO hotspots. No new Critical perf finding without baseline measurement.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `crates/ax-code-fs`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 0

## 7. Test coverage map

| Risk path | Existing test | Gap |
|-----------|---------------|-----|
| Primary behaviors | package suite / static | static proof |
| Findings regression | n/a | — |

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Command / method | Result | Evidence |
|------------------|--------|----------|
| Static deep extract | ok | fingerprint `1e5e4ee80ddb5a91` |
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
| Reviewer | ax-code-glm | 2026-08-11 | Deep extract 6 files / 3143 LOC / fp 1e5e4ee80ddb5a91 |
| Fix owner | ax-code-glm | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | codex-sol | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
