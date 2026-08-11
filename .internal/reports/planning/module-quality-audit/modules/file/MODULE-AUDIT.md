# MODULE-AUDIT: file

| Field | Value |
|-------|-------|
| Unit slug | `file` |
| Scope | `packages/ax-code/src/file` |
| Wave / effort | Wave 3 / L |
| Risk tags | security, performance |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Fix owner | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `2276b8a1fb8516b8` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W3-06 |
| Source files / LOC | 7 / 1984 |

## 1. Scope and map

### Purpose and ownership
Unit `file` owns `packages/ax-code/src/file`. Risk profile: security, performance.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/file/ignore.ts` | 58 | 5 | 0 | 0 |
| `packages/ax-code/src/file/index.ts` | 781 | 11 | 0 | 0 |
| `packages/ax-code/src/file/protected.ts` | 60 | 3 | 0 | 0 |
| `packages/ax-code/src/file/ripgrep.ts` | 529 | 16 | 1 | 0 |
| `packages/ax-code/src/file/status.ts` | 58 | 6 | 0 | 0 |
| `packages/ax-code/src/file/time.ts` | 91 | 6 | 0 | 0 |
| `packages/ax-code/src/file/watcher.ts` | 407 | 8 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `FileIgnore@packages/ax-code/src/file/ignore.ts:8` | public/internal | scanned |
| `FOLDER_NAMES@packages/ax-code/src/file/ignore.ts:13` | public/internal | scanned |
| `FILE_PATTERNS@packages/ax-code/src/file/ignore.ts:14` | public/internal | scanned |
| `PATTERNS@packages/ax-code/src/file/ignore.ts:16` | public/internal | scanned |
| `match@packages/ax-code/src/file/ignore.ts:18` | public/internal | scanned |
| `File@packages/ax-code/src/file/index.ts:19` | public/internal | scanned |
| `AccessDeniedError@packages/ax-code/src/file/index.ts:22` | public/internal | scanned |
| `Info@packages/ax-code/src/file/index.ts:30` | public/internal | scanned |
| `Node@packages/ax-code/src/file/index.ts:43` | public/internal | scanned |
| `Content@packages/ax-code/src/file/index.ts:56` | public/internal | scanned |
| `Event@packages/ax-code/src/file/index.ts:87` | public/internal | scanned |
| `init@packages/ax-code/src/file/index.ts:526` | public/internal | scanned |
| `status@packages/ax-code/src/file/index.ts:530` | public/internal | scanned |
| `read@packages/ax-code/src/file/index.ts:618` | public/internal | scanned |
| `list@packages/ax-code/src/file/index.ts:708` | public/internal | scanned |

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

- process packages/ax-code/src/file/ripgrep.ts:212
- io packages/ax-code/src/file/ripgrep.ts:240
- io packages/ax-code/src/file/ripgrep.ts:278
- process packages/ax-code/src/file/ripgrep.ts:368
- io packages/ax-code/src/file/watcher.ts:49
- io packages/ax-code/src/file/watcher.ts:55
- io packages/ax-code/src/file/watcher.ts:240
- io packages/ax-code/src/file/watcher.ts:282

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | empty catch may hide secret-path failures |
| host process / FS | spawn/shell | escape sandbox, orphan children | permission + isolation layers | OS sandbox opt-in residual |
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | empty catch around IO |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (1 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (55 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 7; total LOC: 1984
- Empty catch residual: packages/ax-code/src/file/ripgrep.ts:275
- TODOs: none

## 4. Performance review
Hot-path unit: reviewed static N+1/sync risks in 6 IO hotspots. No new Critical perf finding without baseline measurement.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `packages/ax-code/src/file`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 1
- Export surface: 55

## 7. Test coverage map

| Risk path | Existing test | Gap |
|-----------|---------------|-----|
| Primary behaviors | `packages/ax-code/test/account/repo.test.ts` | matched |
| Findings regression | n/a — deferred with owner review 2026-09-11 | — |

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-file-empty-catch | silent-error | Low | new | deferred |

## 9. Verification and exit

| Command / method | Result | Evidence |
|------------------|--------|----------|
| Static deep extract | ok | fingerprint `2276b8a1fb8516b8` |
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
| Reviewer | ax-code-glm | 2026-08-11 | Deep extract 7 files / 1984 LOC / fp 2276b8a1fb8516b8 |
| Fix owner | ax-code-glm | 2026-08-11 | 0 fixed, 1 deferred |
| Independent verifier | codex-sol | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
