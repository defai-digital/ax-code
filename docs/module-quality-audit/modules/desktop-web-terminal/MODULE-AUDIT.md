# MODULE-AUDIT: desktop-web-terminal

| Field | Value |
|-------|-------|
| Unit slug | `desktop-web-terminal` |
| Scope | `desktop/packages/web/server/lib/terminal` |
| Resolved root | `desktop/packages/web/server/lib/terminal` |
| XL filter | no |
| Wave / effort | Wave 7 / L |
| Risk tags | desktop, security |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `994f9287e497666e104644eccea299595a35b39a` |
| Analysis fingerprint | `5575a9ce46c4081f` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 9 / 1778 |
| Inventory ID | W7-20 |

## 1. Scope and map

### Source inventory

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

### Exports (sample)
- `TERMINAL_OUTPUT_REPLAY_MAX_BYTES@desktop/packages/web/server/lib/terminal/output-replay-buffer.js:1`
- `createTerminalOutputReplayBuffer@desktop/packages/web/server/lib/terminal/output-replay-buffer.js:29`
- `appendTerminalOutputReplayChunk@desktop/packages/web/server/lib/terminal/output-replay-buffer.js:35`
- `listTerminalOutputReplayChunksSince@desktop/packages/web/server/lib/terminal/output-replay-buffer.js:64`
- `getLatestTerminalOutputReplayChunkId@desktop/packages/web/server/lib/terminal/output-replay-buffer.js:72`
- `observeTerminalShellStartup@desktop/packages/web/server/lib/terminal/runtime.js:19`
- `TERMINAL_SHELL_STARTUP_GRACE_MS@desktop/packages/web/server/lib/terminal/runtime.js:70`
- `createTerminalRuntime@desktop/packages/web/server/lib/terminal/runtime.js:72`
- `DEFAULT_TERMINAL_COLS@desktop/packages/web/server/lib/terminal/terminal-dimensions.js:1`
- `DEFAULT_TERMINAL_ROWS@desktop/packages/web/server/lib/terminal/terminal-dimensions.js:2`
- `MAX_TERMINAL_DIMENSION@desktop/packages/web/server/lib/terminal/terminal-dimensions.js:3`
- `parseTerminalDimension@desktop/packages/web/server/lib/terminal/terminal-dimensions.js:8`
- `resolveTerminalDimensions@desktop/packages/web/server/lib/terminal/terminal-dimensions.js:23`
- `TERMINAL_WS_PATH@desktop/packages/web/server/lib/terminal/terminal-ws-protocol.js:1`
- `TERMINAL_WS_CONTROL_TAG_JSON@desktop/packages/web/server/lib/terminal/terminal-ws-protocol.js:2`
- `TERMINAL_WS_MAX_PAYLOAD_BYTES@desktop/packages/web/server/lib/terminal/terminal-ws-protocol.js:3`
- `parseRequestPathname@desktop/packages/web/server/lib/terminal/terminal-ws-protocol.js:5`
- `isTerminalWsPathname@desktop/packages/web/server/lib/terminal/terminal-ws-protocol.js:17`
- `normalizeTerminalWsMessageToBuffer@desktop/packages/web/server/lib/terminal/terminal-ws-protocol.js:19`
- `normalizeTerminalWsMessageToText@desktop/packages/web/server/lib/terminal/terminal-ws-protocol.js:31`

### Tests
- `packages/ax-code/test/cli/tui/desktop-handoff.test.ts`
- `packages/ax-code/test/cli/tui/terminal-cleanup.test.ts`
- `packages/ax-code/test/cli/tui/terminal-suspend.test.ts`
- `packages/ax-code/test/desktop/webui.test.ts`
- `packages/ax-code/test/script/desktop-release-workflow.test.ts`
- `packages/ax-code/test/tool/webfetch.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (24) | static map |
| Silent failure | empty catch (6) | per-site disposition in findings |
| Secrets/process/IO | risk tags desktop,security | hotspot scan |

## 3–7. Protocol steps 3–7

Completed by dual-agent; see agent-protocol.json

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-desktop-web-terminal-001 | silent-error | Medium | prior/new | verified-fixed |
| AUDIT-desktop-web-terminal-empty-catch | silent-error | Low | new | deferred |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `5575a9ce46c4081f` |
| Dual-agent protocol | complete |
| Critical independent verify | codex-sol |

### Exit checklist
- [x] Full 9-step protocol by dual-agent/implementer
- [x] Map with unit-scoped files (XL filters applied when configured)
- [x] Findings ledger consistent with findings/ files
- [x] Sign-off roles complete

### Sign-off

| Role | Name | Date | Evidence |
|------|------|------|----------|
| Reviewer | ax-code-glm | 2026-08-11 | filesRead=13 |
| Independent verifier | codex-sol | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
