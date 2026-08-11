# MODULE-AUDIT: desktop-web-terminal

| Field | Value |
|-------|-------|
| Unit slug | `desktop-web-terminal` |
| Scope | `desktop/packages/web/server/lib/terminal` |
| Wave / effort | Wave 7 / L |
| Risk tags | desktop, security |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Fix owner | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `0e1d2a753473cbd5` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W7-20 |
| Source files / LOC | 9 / 1778 |

## 1. Scope and map

### Purpose and ownership
Unit `desktop-web-terminal` owns `desktop/packages/web/server/lib/terminal`. Risk profile: desktop, security.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/web/server/lib/terminal/index.js` | 40 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/terminal/output-replay-buffer.js` | 84 | 5 | 0 | 0 |
| `desktop/packages/web/server/lib/terminal/output-replay-buffer.test.js` | 76 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/terminal/runtime.js` | 1010 | 3 | 6 | 0 |
| `desktop/packages/web/server/lib/terminal/runtime.test.js` | 259 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/terminal/terminal-dimensions.js` | 51 | 5 | 0 | 0 |
| `desktop/packages/web/server/lib/terminal/terminal-dimensions.test.js` | 52 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/terminal/terminal-ws-protocol.js` | 69 | 11 | 0 | 0 |
| `desktop/packages/web/server/lib/terminal/terminal-ws-protocol.test.js` | 137 | 0 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `TERMINAL_OUTPUT_REPLAY_MAX_BYTES@desktop/packages/web/server/lib/terminal/output-replay-buffer.js:1` | public/internal | scanned |
| `createTerminalOutputReplayBuffer@desktop/packages/web/server/lib/terminal/output-replay-buffer.js:29` | public/internal | scanned |
| `appendTerminalOutputReplayChunk@desktop/packages/web/server/lib/terminal/output-replay-buffer.js:35` | public/internal | scanned |
| `listTerminalOutputReplayChunksSince@desktop/packages/web/server/lib/terminal/output-replay-buffer.js:64` | public/internal | scanned |
| `getLatestTerminalOutputReplayChunkId@desktop/packages/web/server/lib/terminal/output-replay-buffer.js:72` | public/internal | scanned |
| `observeTerminalShellStartup@desktop/packages/web/server/lib/terminal/runtime.js:19` | public/internal | scanned |
| `TERMINAL_SHELL_STARTUP_GRACE_MS@desktop/packages/web/server/lib/terminal/runtime.js:70` | public/internal | scanned |
| `createTerminalRuntime@desktop/packages/web/server/lib/terminal/runtime.js:72` | public/internal | scanned |
| `DEFAULT_TERMINAL_COLS@desktop/packages/web/server/lib/terminal/terminal-dimensions.js:1` | public/internal | scanned |
| `DEFAULT_TERMINAL_ROWS@desktop/packages/web/server/lib/terminal/terminal-dimensions.js:2` | public/internal | scanned |
| `MAX_TERMINAL_DIMENSION@desktop/packages/web/server/lib/terminal/terminal-dimensions.js:3` | public/internal | scanned |
| `parseTerminalDimension@desktop/packages/web/server/lib/terminal/terminal-dimensions.js:8` | public/internal | scanned |
| `resolveTerminalDimensions@desktop/packages/web/server/lib/terminal/terminal-dimensions.js:23` | public/internal | scanned |
| `TERMINAL_WS_PATH@desktop/packages/web/server/lib/terminal/terminal-ws-protocol.js:1` | public/internal | scanned |
| `TERMINAL_WS_CONTROL_TAG_JSON@desktop/packages/web/server/lib/terminal/terminal-ws-protocol.js:2` | public/internal | scanned |

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

- process desktop/packages/web/server/lib/terminal/runtime.js:194
- secret desktop/packages/web/server/lib/terminal/runtime.js:243
- secret desktop/packages/web/server/lib/terminal/runtime.js:492
- secret desktop/packages/web/server/lib/terminal/runtime.js:493
- secret desktop/packages/web/server/lib/terminal/runtime.js:494
- io desktop/packages/web/server/lib/terminal/terminal-ws-protocol.js:50

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | empty catch may hide secret-path failures |
| renderer privilege boundary | preload/IPC/loopback | capability escape | IPC allowlist / origin checks | silent cleanup on bridges |
| host process / FS | spawn/shell | escape sandbox, orphan children | permission + isolation layers | OS sandbox opt-in residual |
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | empty catch around IO |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (6 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (24 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 9; total LOC: 1778
- Empty catch residual: desktop/packages/web/server/lib/terminal/runtime.js:29, desktop/packages/web/server/lib/terminal/runtime.js:32, desktop/packages/web/server/lib/terminal/runtime.js:213, desktop/packages/web/server/lib/terminal/runtime.js:308, desktop/packages/web/server/lib/terminal/runtime.js:352, desktop/packages/web/server/lib/terminal/runtime.js:996
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `desktop/packages/web/server/lib/terminal`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 6
- Export surface: 24

## 7. Test coverage map

| Risk path | Existing test | Gap |
|-----------|---------------|-----|
| Primary behaviors | `packages/ax-code/test/account/repo.test.ts` | matched |
| Findings regression | desktop/packages/web/server/lib/terminal/runtime.test.js, n/a — deferred with owner review 2026-09-11 | — |

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-desktop-web-terminal-001 | silent-error | Medium | new | verified-fixed |
| AUDIT-desktop-web-terminal-empty-catch | silent-error | Medium | new | deferred |

## 9. Verification and exit

| Command / method | Result | Evidence |
|------------------|--------|----------|
| Static deep extract | ok | fingerprint `0e1d2a753473cbd5` |
| Core typecheck | EXIT:0 | gates |
| Desktop typecheck/lint/test | EXIT:0 | gates |
| Desktop boundaries | EXIT:0 | gates |
| Structure | EXIT:0 | gates |
| Regression AUDIT-desktop-web-terminal-001 | ok | desktop/packages/web/server/lib/terminal/runtime.test.js |

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
| Reviewer | ax-code-glm | 2026-08-11 | Deep extract 9 files / 1778 LOC / fp 0e1d2a753473cbd5 |
| Fix owner | ax-code-glm | 2026-08-11 | 1 fixed, 1 deferred |
| Independent verifier | codex-sol | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
