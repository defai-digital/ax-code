# Bug Reports

## Status (2026-04-27, BUG-319..327 MCP & ACP scan)

### Open

No open items remain in this batch.

### Fixed in this pass

| ID | Severity | Component | What changed |
|----|----------|-----------|--------------|
| BUG-319 | High | `packages/ax-code/src/mcp/index.ts` | Close untried transports after successful `StreamableHTTP` connect so no Streamable/SSE leak remains. |
| BUG-320 | High | `packages/ax-code/src/mcp/index.ts` | Close temporary OAuth clients/transports on non-accepted `startAuth()` paths and guard client close calls for mock/test compatibility. |
| BUG-321 | High | `packages/ax-code/src/mcp/oauth-callback.ts` | Cancel superseded `waitForCallback()` waiters and ensure timeout only affects the current waiter. |
| BUG-322 | Medium | `packages/ax-code/src/mcp/auth.ts` | Serialize file read-modify-write under file lock to prevent auth entry resurrection races. |
| BUG-323 | High | `packages/ax-code/src/control-plane/workspace.ts`, `packages/ax-code/src/control-plane/workspace-router-middleware.ts` | Restrict proxy/sync request paths to local path+query and block URL-like inputs before adaptor calls. |
| BUG-324 | Medium | `packages/ax-code/src/mcp/oauth-callback.ts` | Return callback server running state in `isPortInUse()` so checks match random port binding. |
| BUG-325 | Medium | `packages/ax-code/src/mcp/index.ts`, `packages/ax-code/src/mcp/oauth-provider.ts`, `packages/ax-code/src/mcp/oauth-callback.ts` | Ensure callback listener is started before provider creation in `create()`/`startAuth()` so redirect URI uses active callback port. |
| BUG-326 | Low | `packages/ax-code/src/mcp/index.ts` | Add pending OAuth transport cleanup in `disconnect()`. |
| BUG-327 | Low | `packages/ax-code/src/control-plane/workspace.ts` | Emit workspace directory when available in `startSyncing()` events, with fallback to workspace id. |

### Cleared as false positive / accepted-risk

- BUG-328 (`packages/ax-code/src/control-plane/workspace-server/server.ts`) remained validly classified as false-positive after re-check; heartbeat stop logic is correct.

---

## Status (2026-04-28, BUG-315..318 LSP & DRE scan)

### Open

No open items remain in this batch.

### Fixed in this pass (BUG-315..318)

| ID | Severity | Component | What changed |
|----|----------|-----------|--------------|
| BUG-315 | High | `src/lsp/client.ts` | Use normalized path key for incremental reopen diff lookup in `LSPClient.notify.open()`. |
| BUG-316 | Medium | `src/lsp/client.ts`, `src/lsp/language.ts` | Add basename fallback and language map entry for extensionless files (`Dockerfile`, `Makefile`) when resolving `languageId`. |
| BUG-317 | Low | `src/server/routes/dre-graph.ts` | Escape U+2028 and U+2029 in embedded JSON script payloads. |
| BUG-318 | Low | `src/lsp/server-defs.ts` | Cache Oxlint `--lsp` capability detection to avoid repeated `--help` probes.

### Fixed in this pass (BUG-307..314)

| ID | Severity | Component | What changed |
|----|----------|-----------|--------------|
| BUG-307 | Medium | `packages/ax-code/src/lsp/client.ts` | `LSPClient.notify.open()` now normalizes path via local variable and no longer mutates caller input. |
| BUG-308 | Low | `packages/ax-code/src/tool/registry.ts`, `packages/ax-code/src/server/server.ts` | `toolCount` for DRE pending-plans now derived from registry. |
| BUG-309 | Low | `packages/ax-code/src/graph/format.ts` | Mermaid sanitizer now escapes `#` to avoid label truncation. |
| BUG-310 | Low | `packages/ax-code/src/server/routes/dre-graph.ts` | Rechecked: shared polling interval and `EventSource` are cleaned on `beforeunload`; no code change needed for this report. |
| BUG-311 | Medium | `packages/ax-code/src/lsp/index.ts` | `incomingCalls` / `outgoingCalls` now aggregate results from all prepared call hierarchy items. |
| BUG-312 | Low | `packages/ax-code/src/debug-engine/native-scan.ts` | `SyntaxError` is now logged like other native parse/bridge errors. |
| BUG-313 | Low | `packages/ax-code/src/code-intelligence/query.ts` | `pruneExpiredLspCache` and `clearLspCache` now return exact deleted row counts. |
| BUG-314 | Info | `packages/ax-code/src/code-intelligence/builder.ts` | Reviewed as non-blocking: type guard behavior is correct; kept as accepted-risk/clarity-only report. |

### Fixed in this pass

| ID | Severity | Component | What changed |
|----|----------|-----------|--------------|
| BUG-301 | Medium | `packages/ax-code/src/mcp/index.ts` | Close and replace pending OAuth transports in `create()` and `startAuth()` before overwriting existing entries, preventing leaked stream transports on repeated auth flow retries. |
| BUG-302 | Low | `packages/ax-code/src/mcp/index.ts` | Fixed `readResource` client-miss warning to report `resource` instead of `prompt`. |
| BUG-303 | Medium | `packages/ax-code/src/control-plane/workspace-router-middleware.ts` | Stop forwarding untrusted request host/path as a full URL and proxy only path+query to the adaptor, preventing host-controlled URL forwarding in the middleware path. |
| BUG-304 | Low | `packages/ax-code/src/mcp/index.ts` | Preserve MCP tool `additionalProperties` from the source schema while keeping default `false` when omitted. |
| BUG-305 | Low-Medium | `packages/ax-code/src/control-plane/workspace.ts` | Validate `response.ok` in `startSyncing()` before `parseSSE()` so non-2xx responses are treated as sync failures and retried. |
| BUG-306 | Low | `packages/ax-code/src/control-plane/adaptors.ts` | Added `removeAdaptor(type)` API for explicit registry cleanup and used it in control-plane tests to avoid map-growth side-effects in dynamic lifecycle cases. |

### Cleared as false positive / accepted-risk

- No pending items remain in this batch.

### Historical status

Earlier triage passes (BUG-200..213 and prior) are documented in git history.
