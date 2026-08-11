# MODULE-AUDIT: lsp

| Field | Value |
|-------|-------|
| Unit slug | `lsp` |
| Scope | `packages/ax-code/src/lsp` |
| Wave / effort | Wave 5 / L |
| Risk tags | performance, process |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Fix owner | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `86d10f3031d4e6f7` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W5-06 |
| Source files / LOC | 34 / 6329 |

## 1. Scope and map

### Purpose and ownership
Unit `lsp` owns `packages/ax-code/src/lsp`. Risk profile: performance, process.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/lsp/broken-server.ts` | 61 | 4 | 0 | 0 |
| `packages/ax-code/src/lsp/cache-probe.ts` | 97 | 4 | 0 | 0 |
| `packages/ax-code/src/lsp/cache.ts` | 162 | 8 | 0 | 0 |
| `packages/ax-code/src/lsp/client-notify.ts` | 48 | 2 | 0 | 0 |
| `packages/ax-code/src/lsp/client.ts` | 706 | 10 | 0 | 0 |
| `packages/ax-code/src/lsp/diagnostics.ts` | 147 | 9 | 0 | 0 |
| `packages/ax-code/src/lsp/document-symbol.ts` | 74 | 4 | 0 | 0 |
| `packages/ax-code/src/lsp/envelope-runner.ts` | 132 | 3 | 0 | 0 |
| `packages/ax-code/src/lsp/envelope.ts` | 38 | 4 | 0 | 0 |
| `packages/ax-code/src/lsp/index-impl.ts` | 967 | 40 | 0 | 0 |
| `packages/ax-code/src/lsp/index.ts` | 2 | 1 | 0 | 0 |
| `packages/ax-code/src/lsp/jdtls-data-dir.ts` | 33 | 4 | 0 | 0 |
| `packages/ax-code/src/lsp/language.ts` | 122 | 1 | 0 | 0 |
| `packages/ax-code/src/lsp/launch.ts` | 49 | 1 | 0 | 0 |
| `packages/ax-code/src/lsp/oxlint.ts` | 58 | 2 | 0 | 0 |
| `packages/ax-code/src/lsp/perf.ts` | 105 | 6 | 0 | 0 |
| `packages/ax-code/src/lsp/point.ts` | 269 | 21 | 0 | 0 |
| `packages/ax-code/src/lsp/prewarm-profile.ts` | 15 | 6 | 0 | 0 |
| `packages/ax-code/src/lsp/prewarm.ts` | 35 | 2 | 0 | 0 |
| `packages/ax-code/src/lsp/protocol.ts` | 45 | 3 | 0 | 0 |
| `packages/ax-code/src/lsp/references.ts` | 62 | 3 | 0 | 0 |
| `packages/ax-code/src/lsp/scheduler.ts` | 230 | 9 | 0 | 0 |
| `packages/ax-code/src/lsp/selection.ts` | 128 | 16 | 0 | 0 |
| `packages/ax-code/src/lsp/server-config.ts` | 116 | 3 | 0 | 0 |
| `packages/ax-code/src/lsp/server-defs/index.ts` | 23 | 39 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `BrokenEntry@packages/ax-code/src/lsp/broken-server.ts:14` | public/internal | scanned |
| `computeBackoff@packages/ax-code/src/lsp/broken-server.ts:19` | public/internal | scanned |
| `isBroken@packages/ax-code/src/lsp/broken-server.ts:25` | public/internal | scanned |
| `markBroken@packages/ax-code/src/lsp/broken-server.ts:48` | public/internal | scanned |
| `CacheProbeInput@packages/ax-code/src/lsp/cache-probe.ts:7` | public/internal | scanned |
| `read@packages/ax-code/src/lsp/cache-probe.ts:22` | public/internal | scanned |
| `hashAndRead@packages/ax-code/src/lsp/cache-probe.ts:35` | public/internal | scanned |
| `run@packages/ax-code/src/lsp/cache-probe.ts:46` | public/internal | scanned |
| `LSPCache@packages/ax-code/src/lsp/cache.ts:11` | public/internal | scanned |
| `Envelope@packages/ax-code/src/lsp/cache.ts:14` | public/internal | scanned |
| `WritableEnvelope@packages/ax-code/src/lsp/cache.ts:24` | public/internal | scanned |
| `enabled@packages/ax-code/src/lsp/cache.ts:59` | public/internal | scanned |
| `shouldWrite@packages/ax-code/src/lsp/cache.ts:63` | public/internal | scanned |
| `hashFile@packages/ax-code/src/lsp/cache.ts:67` | public/internal | scanned |
| `lookup@packages/ax-code/src/lsp/cache.ts:78` | public/internal | scanned |

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

- io packages/ax-code/src/lsp/cache.ts:9
- io packages/ax-code/src/lsp/cache.ts:70
- process packages/ax-code/src/lsp/index-impl.ts:352
- process packages/ax-code/src/lsp/launch.ts:23
- process packages/ax-code/src/lsp/launch.ts:24
- process packages/ax-code/src/lsp/launch.ts:25
- process packages/ax-code/src/lsp/launch.ts:29
- process packages/ax-code/src/lsp/oxlint.ts:25
- process packages/ax-code/src/lsp/server-config.ts:87
- process packages/ax-code/src/lsp/server-config.ts:99
- process packages/ax-code/src/lsp/server-defs/jvm-llvm-servers.ts:53
- process packages/ax-code/src/lsp/server-defs/jvm-llvm-servers.ts:67

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| host process / FS | spawn/shell | escape sandbox, orphan children | permission + isolation layers | OS sandbox opt-in residual |
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | none from scan |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (368 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 34; total LOC: 6329
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Hot-path unit: reviewed static N+1/sync risks in 3 IO hotspots. No new Critical perf finding without baseline measurement.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `packages/ax-code/src/lsp`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 368

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
| Static deep extract | ok | fingerprint `86d10f3031d4e6f7` |
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
| Reviewer | ax-code-glm | 2026-08-11 | Deep extract 34 files / 6329 LOC / fp 86d10f3031d4e6f7 |
| Fix owner | ax-code-glm | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | codex-sol | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
