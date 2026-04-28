# Bug Reports

## Status (2026-04-27, BUG-301..306 triage)

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
