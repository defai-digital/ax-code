# Bug Reports

## Status (2026-04-28, ACP / MCP / control-plane / LSP triage)

Triage pass over 13 reports covering ACP agent lifecycle, MCP OAuth flow,
control-plane SSE handling, and LSP client memory bounds. 8 fixed in this
pass, 3 deferred (real but require larger investigation), 2 false positives
self-acknowledged in their own reports.

### Fixed in this pass

| ID | Severity | Component | What changed |
|----|----------|-----------|--------------|
| acp-permission-writeTextFile-not-awaited | Low | `acp/agent.ts` | The `connection.writeTextFile(...)` call after a granted edit-permission is now awaited. Previously the promise was discarded, swallowing write errors and letting `permission.reply` race ahead of the file change. |
| mcp-remote-auth-error-does-not-close-first-transport | High | `mcp/index.ts` | In the `needs_auth` path the failing transport is now stored in `pendingOAuthTransports` **without** first calling `closeIfPossible(client, ...)`. In the real MCP SDK `client.close()` chains down to `transport.close()`, so the previous order would close the transport we needed `finishAuth` to reuse — every OAuth-required server failed silently with a dead transport. `closeIfPossible(client, ...)` is now only called on the registration-failure and non-auth-error branches where the client is genuinely no longer needed. |
| mcp-auth-lock-key-vs-filepath-lock-key-mismatch | Medium | `mcp/auth.ts`, `mcp/oauth-provider.ts` | `invalidateCredentials` was acquiring `withLock(this.mcpName, ...)` and then calling `set()` / `remove()` which acquire `withLock(filepath, ...)` — two different lock instances, so a parallel `updateTokens` for the same server could resurrect a token between our `get` and `set`. Added `McpAuth.clearClientInfo` / `McpAuth.clearTokens` that go through `withFileEntryLock` (the same `filepath` key as every other mutation), and `invalidateCredentials` now dispatches to `remove` / `clearClientInfo` / `clearTokens` so the entire read-modify-write happens under one consistent lock. |
| acp-replay-queue-memory-growth | Medium | `acp/agent.ts` | `replayQueue` per-session buffer now caps at 500 events with drop-oldest semantics. Previously a long replay (thousands of historical messages) would accumulate every concurrently-arriving live event for the entire replay duration and then dump them all into `sessionUpdate` calls when replay finished. |
| acp-session-memory-never-cleaned | Medium | `acp/session.ts`, `acp/agent.ts` | `ACPSessionManager` now caps `sessions` at 1024 entries with insertion-order LRU eviction in a new `track()` helper, and exposes `remove(sessionId)` / `clear()`. `Agent.dispose()` calls `sessionManager.clear()` so a disposed agent doesn't keep one `ACPSessionState` (with `mcpServers` lists) per session it ever saw. The cap is a backstop; explicit clear on dispose remains the canonical lifecycle release. |
| control-plane-sse-double-cancel | Low | `control-plane/sse.ts` | `parseSSE` now uses a `canceled` flag inside `cancel()` so the abort listener and the `finally` cleanup don't both call `reader.cancel()`. The `finally` path now also funnels through the same guarded `cancel()` rather than calling `reader.cancel()` directly. |
| mcp-connect-serialization-memory-leak | Low | `mcp/index.ts` | The `Instance.state` cleanup now calls `connectLocks.clear()` alongside closing all clients, so a graceful shutdown doesn't leave entries pointing at promises that still resolve and write to torn-down state. The self-cleaning `finally` would still run, but explicit clear keeps shutdown deterministic. |
| mcp-oauth-callback-state-map-unbounded | Low | `mcp/oauth-callback.ts` | `pendingAuths` now has a 100-entry cap; `waitForCallback` evicts the oldest pending wait (rejecting it deterministically) before adding a new entry. The 5-minute per-entry timeout remains the primary cleanup; the cap is defense-in-depth against a runaway caller that fires `startAuth` for hundreds of servers within the timeout window. |

### Deferred (real bugs, not fixed in this pass)

These reports stay in the folder.

- **`acp-missing-dispose-on-disconnect`** — `Agent.dispose()` exists and is correctly written, but nothing automatically invokes it when the ACP `AgentSideConnection` closes. Wiring requires checking what lifecycle hooks `@agentclientprotocol/sdk` provides (`onClose`, `onDisconnect`, or none at all). The existing `eventAbort` already short-circuits the event loop on the next iteration when the SDK call rejects, so the practical leak is limited to the in-process Maps until the next `runEventSubscription` retry hits a connection error and naturally terminates. Defer until we can read the ACP SDK contract.
- **`mcp-oauth-state-race`** — Partially false positive: `McpOAuthProvider.state()` already checks for an existing stored state before generating a new one, so the SDK doesn't overwrite `startAuth`'s pre-saved state on the happy path. The remaining real concern is two parallel `startAuth()` invocations for the same `mcpName` — both call `getOAuthState`, both find none, both generate different states, and one loses the IdP exchange. Fix requires returning the generated state from `startAuth()` and threading it through `authenticate()` instead of doing the round-trip via storage. API refactor; out of scope for triage pass.
- **`lsp-process-kill-on-exit-not-removed`** — Edge race in `lsp/launch.ts`. The current code is mostly correct (close handler removes the exit listener); the report flags the case where `proc.on("close", ...)` registration could be skipped if the calling code throws between spawn and the listener attach. The window is on a single sync line in the same function; no real-world repro. Worth a follow-up wrap-in-try when we touch this file next.

### Cleared as false positive / accepted-risk

- **`lsp-scheduler-budget-settled-flag-edge-case`** — The report self-concludes "No action needed. The `settled` flag pattern correctly prevents the race." Kept the flag, no code change.
- **`lsp-diagnostics-map-eviction-key-order`** — Report self-concludes "mostly benign since both maps serve different purposes and independent eviction is acceptable." `diagnostics` and `lastContent` Map LRUs are intentionally decoupled; `closeUnlocked` already drops both for explicit closes. No code change.

### Verification

- `pnpm typecheck` clean across all 14 workspace packages.
- `bun test test/acp/ test/mcp/ test/control-plane/` — 47 / 47 pass across 13 test files. One test (`oauth-auto-connect.test.ts:280`) was previously asserting `firstClient.closeCalls === 1`, which enforced the buggy behavior that closed the OAuth client (and chained-closed its transport) before `finishAuth` could reuse it. The mock decouples client and transport close, so the test silently masked the production bug. Updated to expect `0` with a comment documenting why.

---

## Status (2026-04-28, Deep audit — MCP / ACP / LSP / DRE)

Focused audit pass over MCP, Agent Control Plane, LSP, and DRE-related modules
using automated static analysis (race_scan, lifecycle_scan, security_scan,
hardcode_scan) and manual code review. 12 new reports filed, 0 already-known
issues duplicated, 41 security_scan path-traversal findings assessed as
expected for LSP module design (all are read-only file paths, no shell exec).

### New reports (this pass)

| File | Severity | Component | Summary |
|------|----------|-----------|---------|
| `lsp-oxlint-cache-toctou-duplicate-spawn.md` | HIGH | LSP | TOCTOU race in `oxlintSupportsLsp` allows duplicate child process spawns; orphaned process on error path; unbounded Map growth |
| `lsp-config-env-bypasses-sanitize.md` | MEDIUM | LSP | User-configured `env` in LSP config spreads after `Env.sanitize()`, bypassing secret stripping |
| `lsp-nearestroot-fallback-incorrect-root.md` | MEDIUM | LSP | `NearestRoot` falls back to `Instance.directory` instead of `undefined`, causing servers to init with wrong roots |
| `lsp-env-xauthority-allowlist.md` | MEDIUM | LSP | `XAUTHORITY` in `Env.sanitize()` allowlist exposes X11 auth to all LSP child processes |
| `lsp-scheduleClient-dead-code-null-check.md` | LOW | LSP | Unreachable `!handle` check after try/catch in `scheduleClient` |
| `lsp-computeBackoff-edge-case.md` | LOW | LSP | `computeBackoff(0)` returns 7500ms instead of 0 |
| `acp-sse-queue-silent-drops-no-observability.md` | HIGH | ACP | SSE event queue silently drops events at 1024 cap with no logging or gap detection |
| `acp-workspace-header-no-validation-broadcast.md` | HIGH | ACP | Missing `x-opencode-workspace` header broadcasts all events from all workspaces; no schema validation |
| `acp-workspace-delete-dangling-remote.md` | MEDIUM | ACP | `Workspace.remove()` deletes DB record even when remote adaptor cleanup fails |
| `acp-sse-parser-unbounded-buffer-growth.md` | MEDIUM | ACP | `parseSSE` buffer grows without bound on pathological input (no size cap) |
| `acp-workspace-router-headers-forwarded.md` | LOW | ACP | Raw request headers (including `Authorization`, `Cookie`) forwarded to remote adaptors |
| `dre-graph-signal-handler-leak.md` | LOW | DRE | `DreGraphCommand` leaks `SIGINT`/`SIGTERM` handlers on repeated invocations |

### Already-known (not re-filed)

- `acp-missing-dispose-on-disconnect.md` — deferred from previous pass
- `lsp-process-kill-on-exit-not-removed.md` — deferred from previous pass
- `mcp-oauth-state-race.md` — deferred from previous pass

### Excluded as expected-pattern / accepted-risk

- **LSP path_traversal (41 security_scan findings):** All LSP `path.join`/`path.resolve` calls construct file paths for reading (not writing to sensitive locations). The paths are used for workspace root resolution, `pathToFileURL()` construction, and file content reading. `child_process.spawn` (not `exec`) is used everywhere, preventing shell injection. This is inherent to LSP's design of operating on user-specified files.
- **MCP auth.ts path_traversal (1 finding):** `mcp-auth.json` path uses `Global.Path.data` which is a controlled internal path, not user input.
- **ACP workspace-router-middleware SSRF (3 findings):** `Adaptor.fetch()` interface accepts `RequestInfo | URL` — SSRF depends on adaptor implementations, not the middleware. The `normalizeWorkspacePath` function already strips absolute URLs and protocol-relative paths.
- **ACP types.ts SSRF (1 finding):** This is the `Adaptor` interface definition itself, not a call site. Validation is the adaptor implementation's responsibility.

### Historical status

Earlier triage passes (BUG-200..213, BUG-301..327, etc.) are documented in
git history.
