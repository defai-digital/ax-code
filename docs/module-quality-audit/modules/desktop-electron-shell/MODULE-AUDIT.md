# MODULE-AUDIT: desktop-electron-shell

| Field | Value |
|-------|-------|
| Unit slug | `desktop-electron-shell` |
| Scope | `desktop/packages/electron/src (shell/window)` |
| Resolved root | `desktop/packages/electron/src` |
| XL filter | no |
| Wave / effort | Wave 7 / L |
| Risk tags | desktop |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `994f9287e497666e104644eccea299595a35b39a` |
| Analysis fingerprint | `abaa92677805f79e` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 49 / 6080 |
| Inventory ID | W7-01 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/electron/src/desktop-boot-outcome.js` | 11 | 0 | 0 | 0 |
| `desktop/packages/electron/src/desktop-boot-outcome.test.mjs` | 23 | 0 | 0 | 0 |
| `desktop/packages/electron/src/desktop-browser-capture-policy.js` | 16 | 0 | 0 | 0 |
| `desktop/packages/electron/src/desktop-browser-capture-policy.test.mjs` | 54 | 0 | 0 | 0 |
| `desktop/packages/electron/src/desktop-capture-page-policy.test.mjs` | 56 | 0 | 0 | 0 |
| `desktop/packages/electron/src/desktop-dialog.js` | 58 | 0 | 0 | 0 |
| `desktop/packages/electron/src/desktop-dialog.test.mjs` | 69 | 0 | 0 | 0 |
| `desktop/packages/electron/src/desktop-file-search.js` | 24 | 0 | 0 | 0 |
| `desktop/packages/electron/src/desktop-file-search.test.mjs` | 34 | 0 | 0 | 0 |
| `desktop/packages/electron/src/desktop-hosts.js` | 224 | 0 | 0 | 0 |
| `desktop/packages/electron/src/desktop-hosts.test.mjs` | 358 | 0 | 0 | 0 |
| `desktop/packages/electron/src/desktop-lan-address.js` | 93 | 0 | 0 | 0 |
| `desktop/packages/electron/src/desktop-lan-address.test.mjs` | 100 | 0 | 0 | 0 |
| `desktop/packages/electron/src/desktop-read-file-policy.js` | 65 | 0 | 0 | 0 |
| `desktop/packages/electron/src/desktop-read-file-policy.test.mjs` | 77 | 0 | 0 | 0 |
| `desktop/packages/electron/src/desktop-window-title.js` | 18 | 0 | 0 | 0 |
| `desktop/packages/electron/src/desktop-window-title.test.mjs` | 23 | 0 | 0 | 0 |
| `desktop/packages/electron/src/external-url.js` | 29 | 0 | 0 | 0 |
| `desktop/packages/electron/src/external-url.test.mjs` | 24 | 0 | 0 | 0 |
| `desktop/packages/electron/src/installed-apps-cache.js` | 32 | 0 | 0 | 0 |
| `desktop/packages/electron/src/installed-apps-cache.test.mjs` | 59 | 0 | 0 | 0 |
| `desktop/packages/electron/src/main.js` | 2767 | 0 | 3 | 0 |
| `desktop/packages/electron/src/mini-chat-tray-action.test.mjs` | 19 | 0 | 0 | 0 |
| `desktop/packages/electron/src/open-paths.js` | 88 | 0 | 0 | 0 |
| `desktop/packages/electron/src/open-paths.test.mjs` | 107 | 0 | 0 | 0 |
| `desktop/packages/electron/src/preload-ipc-policy.js` | 70 | 0 | 0 | 0 |
| `desktop/packages/electron/src/preload-ipc-policy.test.mjs` | 26 | 0 | 0 | 0 |
| `desktop/packages/electron/src/preload.js` | 75 | 0 | 0 | 0 |
| `desktop/packages/electron/src/renderer-crash-policy.js` | 34 | 0 | 0 | 0 |
| `desktop/packages/electron/src/renderer-crash-policy.test.mjs` | 66 | 0 | 0 | 0 |

### Exports (sample)
- `createTrayController@desktop/packages/electron/src/tray.mjs:97`

### Tests
- `packages/ax-code/test/cli/tui/desktop-handoff.test.ts`
- `packages/ax-code/test/desktop/webui.test.ts`
- `packages/ax-code/test/runtime/shell-env.test.ts`
- `packages/ax-code/test/script/desktop-release-workflow.test.ts`
- `packages/ax-code/test/session/prompt-shell-command.test.ts`
- `packages/ax-code/test/shell/shell.test.ts`
- `packages/ax-code/test/support/bun-shell.ts`
- `packages/ax-code/test/util/shell-args.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (1) | static map |
| Silent failure | empty catch (5) | per-site disposition in findings |
| Secrets/process/IO | risk tags desktop | hotspot scan |

## 3–7. Protocol steps 3–7

Completed by dual-agent; see agent-protocol.json

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-desktop-electron-shell-empty-catch | silent-error | Low | new | deferred |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `abaa92677805f79e` |
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
| Reviewer | ax-code-glm | 2026-08-11 | filesRead=23 |
| Independent verifier | codex-sol | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
