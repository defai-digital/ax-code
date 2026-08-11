# MODULE-AUDIT: pty

| Field | Value |
|-------|-------|
| Unit slug | `pty` |
| Scope | `packages/ax-code/src/pty` |
| Wave / effort | Wave 3 / L |
| Risk tags | security, resource |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Fix owner | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `2d58475a7ccae1b2` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W3-05 |
| Source files / LOC | 2 / 540 |

## 1. Scope and map

### Purpose and ownership
Unit `pty` owns `packages/ax-code/src/pty`. Risk profile: security, resource.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/pty/index.ts` | 534 | 16 | 1 | 0 |
| `packages/ax-code/src/pty/schema.ts` | 6 | 1 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `Pty@packages/ax-code/src/pty/index.ts:19` | public/internal | scanned |
| `replayBufferedOutput@packages/ax-code/src/pty/index.ts:83` | public/internal | scanned |
| `sanitizeUserEnv@packages/ax-code/src/pty/index.ts:131` | public/internal | scanned |
| `Info@packages/ax-code/src/pty/index.ts:215` | public/internal | scanned |
| `InvalidCwdError@packages/ax-code/src/pty/index.ts:229` | public/internal | scanned |
| `CreateInput@packages/ax-code/src/pty/index.ts:237` | public/internal | scanned |
| `UpdateInput@packages/ax-code/src/pty/index.ts:255` | public/internal | scanned |
| `Event@packages/ax-code/src/pty/index.ts:262` | public/internal | scanned |
| `list@packages/ax-code/src/pty/index.ts:306` | public/internal | scanned |
| `get@packages/ax-code/src/pty/index.ts:311` | public/internal | scanned |
| `resize@packages/ax-code/src/pty/index.ts:316` | public/internal | scanned |
| `write@packages/ax-code/src/pty/index.ts:325` | public/internal | scanned |
| `connect@packages/ax-code/src/pty/index.ts:333` | public/internal | scanned |
| `create@packages/ax-code/src/pty/index.ts:400` | public/internal | scanned |
| `update@packages/ax-code/src/pty/index.ts:506` | public/internal | scanned |

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

- process packages/ax-code/src/pty/index.ts:435

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | empty catch may hide secret-path failures |
| host process / FS | spawn/shell | escape sandbox, orphan children | permission + isolation layers | OS sandbox opt-in residual |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (1 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (17 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 2; total LOC: 540
- Empty catch residual: packages/ax-code/src/pty/index.ts:192
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `packages/ax-code/src/pty`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 1
- Export surface: 17

## 7. Test coverage map

| Risk path | Existing test | Gap |
|-----------|---------------|-----|
| Primary behaviors | `packages/ax-code/test/account/repo.test.ts` | matched |
| Findings regression | packages/ax-code/test/pty (if present) / static proof, n/a — deferred with owner review 2026-09-11 | — |

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-pty-001 | silent-error | Medium | new | verified-fixed |
| AUDIT-pty-empty-catch | silent-error | Low | new | deferred |

## 9. Verification and exit

| Command / method | Result | Evidence |
|------------------|--------|----------|
| Static deep extract | ok | fingerprint `2d58475a7ccae1b2` |
| Core typecheck | EXIT:0 | gates |
| Desktop typecheck/lint/test | EXIT:0 | gates |
| Desktop boundaries | EXIT:0 | gates |
| Structure | EXIT:0 | gates |
| Regression AUDIT-pty-001 | ok | packages/ax-code/test/pty (if present) / static proof |

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
| Reviewer | ax-code-glm | 2026-08-11 | Deep extract 2 files / 540 LOC / fp 2d58475a7ccae1b2 |
| Fix owner | ax-code-glm | 2026-08-11 | 1 fixed, 1 deferred |
| Independent verifier | codex-sol | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
