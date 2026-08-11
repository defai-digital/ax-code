# Protocol steps — `server` (ax-code-glm pass)

Unit slug: `server`
Scope: `packages/ax-code/src/server`
Reviewer: ax-code-glm · model `zai-coding-plan/glm-5.2[1m]`
Verifier lane: codex-sol
Date: 2026-08-11

Security-focused re-review. The load-bearing control for this unit is the
**local-only bind policy**: every route assumes the caller already reached a
loopback socket, so network exposure and credential handling are the dominant
risk axes.

## Step 1 Scope and map

I read all 20 candidate sources end to end, plus two supporting files the
candidates delegate to. The unit is a Hono HTTP surface plus a length-prefixed
IPC transport that re-uses the same `fetch`. Roles:

- `packages/ax-code/src/server/routes/app.ts` — instance lifecycle, `/log`, paths, vcs.
- `packages/ax-code/src/server/routes/config.ts` — config read/update with secret redaction.
- `packages/ax-code/src/server/routes/audit.ts` — audit JSONL export + replay.
- `packages/ax-code/src/server/routes/event.ts` — SSE event stream.
- `packages/ax-code/src/server/routes/dre-graph.ts` — HTML DRE report.
- `packages/ax-code/src/server/routes/experimental.ts` — tool/worktree/session listing.
- `packages/ax-code/src/server/middleware.ts` — rate limiting + request logging.
- `packages/ax-code/src/server/request-directory.ts` — directory admission.
- `packages/ax-code/src/server/ipc-transport.ts` / `ipc-protocol.ts` — framing + transport.
- `packages/ax-code/src/server/mdns.ts` — LAN service advertisement.

Three facade files (`constants.ts`, `event.ts`, `listen-security.ts`) only
re-export; the real loopback logic lives in `packages/ax-code/src/runtime/listen-security.ts`.

## Step 2 Threat and failure model

The network socket is the trust boundary. `assertAuthenticatedNetworkBind`
(`packages/ax-code/src/runtime/listen-security.ts:27-32`) throws for any non-
loopback hostname, and `isIPv4Loopback` (lines 17-25) validates the full
`127.0.0.0/8` range rather than just `127.0.0.1`. That is why routes carry no
per-request bearer token — "if you can reach the socket, you are the local owner."

Residual threats under that model: (a) a second local user on a shared host
reaching the port/Unix socket, (b) credential leakage through config or error
responses, (c) path traversal in directory resolution, (d) HTML/script injection
in the DRE report, (e) unbounded resource growth (SSE/IPC/rate-limit map),
(f) cross-project data disclosure via listing/export routes.

## Step 3 Correctness of security-critical paths

Directory admission in `request-directory.ts` is layered correctly: null-byte
rejection at line 40-42, `path.isAbsolute` at line 43, `realpathSync` to collapse
symlinks at line 47, then both `DANGEROUS_ROOTS` (lines 9-23) and
`SENSITIVE_HOME_DIRECTORIES` (line 25) are enforced via
`realDirectory === blocked || Filesystem.contains(blocked, realDirectory)` at
lines 63-65. This blocks exact-match and subtree access into `.ssh`, `.aws`,
`.kube`, `.docker`, etc.

Secret handling in `config.ts` is bidirectional: `redactConfig` (line 77) masks
on GET using `SECRET_OPTION_PATTERN = /key|secret|token|password|credential|auth/i`
(line 16); `stripRedactedConfig` (line 39) drops `[redacted]` values on PATCH so
a stale client cannot overwrite a stored credential with the literal sentinel;
`redactProviderInfo` (line 125) additionally deletes the top-level provider `key`
before list responses. This is solid defense-in-depth.

Error normalization in `error.ts` never echoes raw stack traces: 5xx paths fall
to `message: "Internal server error"` (lines 182-186, 233-239) and only attach
`logRef` for server-side correlation. One naming wart confirmed: `forbidden`
(line 281-287) returns status 403 but `name: "InvalidRequestError"` rather than
a distinct `ForbiddenError` — clients classifying by `name` will mis-bucket 403s
as 400s. The error body for `FileAccessDenied` (line 147-155) does use
`ForbiddenError`, so the inconsistency is confined to the `forbidden()` helper.

## Step 4 Resource and backpressure behavior

`middleware.ts` rate limiter keys a `Map` by `ip:method:path` and sweeps when
`rate.size > 5_000` or every 30s (lines 59-64) — bounded. SSE
(`routes/event.ts`) is bounded twice: a 256 control-frame cap (line 84) for
heartbeats, and `pushSseFrame` with `SSE_HARD_MAX` that disconnects an
overflowing consumer (lines 58-77). Audit export caps at
`AUDIT_EXPORT_MAX_LIMIT = 10_000` (`routes/audit.ts:19`) and breaks early (line
83). Context-check discovery returns after four unique commands
(`app-context-checks.ts:98`).

One correctness gap in the throttle: `middleware.ts:54` uses fallback key
`unknown:${crypto.randomUUID()}` when `resolveRateLimitClientIP` returns
undefined. The random UUID is unique per request, so every such request lands in
its own fresh bucket and the configured limits (30/120/600) never fire — rate
limiting degrades to a no-op whenever the socket binding cannot be resolved.
Under normal `@hono/node-server` the binding is present, so this is an edge
deployment path, hence Medium not High. I agree with the cross-lane note that the
IPC length header is uncapped (`ipc-protocol.ts:54`); the trust boundary is a
local Unix socket so this stays Low, but an explicit max-frame guard is worth
adding.

## Step 5 Cohesion and boundary design

IPC reusing the HTTP `fetch` (`ipc-transport.ts:162`) yields one authorization
model across both surfaces. `parseIpcRequestMessage` (`ipc-transport.ts:222-261`)
shape-checks type, id, method, path-prefix (`/`-anchored), query values and
header records before a message is routed, emitting structured
`IPC_INVALID_REQUEST` replies. The directory-scoped audit export
(`routes/audit.ts:128-129`) computes `allowedSessions` from `Instance.directory`
up front, so a client on project A cannot enumerate project B's audit events
even though `AuditExport.streamAll` is itself unscoped — correct factoring:
scope at the route, not deep in the streamer. Redaction is centralized in
`config.ts` and reused for both `/config` and `/config/providers`.

The one design smell worth flagging: error classification is string-based —
resource selection and status mapping depend on `error.name` and message regexes
(`error.ts:37-43`, `96-179`, `189-231`). Producer wording is effectively an
implicit API contract; renaming a `NamedError` silently changes HTTP status.

## Step 6 Hygiene and silent failures

No TODO/FIXME/HACK markers in the candidate set. The deferred
`AUDIT-server-empty-catch` finding flags two sites; within this candidate set the
relevant one is `ipc-transport.ts:317-319` inside `parseSseStream`'s `finally`,
where `await reader.cancel()` is wrapped in `catch {}`. That suppression is
defensible cleanup — the stream is already being torn down and a thrown cancel
would mask the prior real error, and the reader lock is still released on line 320. No new empty catches were introduced by the candidate files. The higher-
value site (`runtime-adapter.ts:132`, WebSocket close) is outside this candidate
set and is correctly classed needs-log.

## Step 7 Test adequacy

The MODULE-AUDIT ledger lists direct route tests under
`packages/ax-code/test/server/` (app-context-routes, audit-route, capability,
dre-graph, file-routes, ipc-transport, isolation) and SSE coverage in
`test/control-plane/workspace-server-sse.test.ts`. I did not execute the suite in
this read-only pass. The branch points the suite must cover for the security
claims to hold: the rate-limit fallback (`middleware.ts:54`), the redact/strip
round-trip in config, the directory blocklist incl. symlink collapse, the SSE
overflow disconnect, the audit project-scoping filter, and the IPC frame shape
rejections. The cross-lane run already executed typecheck + focused Vitest; I am
not re-running here to avoid redundant writes — verifier codex-sol should
re-confirm.

## Step 8 Finding disposition

No Critical findings. Disposition for this pass:

| Finding                                                                 | Category             | Severity | Disposition                                                                                                         |
| ----------------------------------------------------------------------- | -------------------- | -------- | ------------------------------------------------------------------------------------------------------------------- |
| Rate-limit bypass when client IP unresolved (`middleware.ts:54`)        | throttle-degradation | Medium   | new — consider a shared `unknown` bucket with a low cap instead of per-request UUID                                 |
| mDNS LAN advertisement (`mdns.ts:10-24`)                                | network-exposure     | Low      | accepted for local dev; `publish` should be gated behind explicit opt-in if the server is ever allowed off loopback |
| IPC frame length uncapped (`ipc-protocol.ts:54`)                        | resource-bound       | Low      | local-socket trust boundary; add explicit max-frame guard as hardening                                              |
| Experimental `/session` global listing (`experimental.ts:240-249`)      | info-disclosure      | Low      | local-only bind mitigates; `directory` param already collapses to `Instance.directory` when present                 |
| `forbidden()` returns `name:"InvalidRequestError"` (`error.ts:281-287`) | api-consistency      | Low      | rename to `ForbiddenError` or document the contract                                                                 |
| Empty catch in SSE cleanup (`ipc-transport.ts:319`)                     | silent-error         | Low      | already tracked — defensible cleanup suppression                                                                    |

The existing `findings/AUDIT-server-empty-catch.md` (Low, deferred) remains
accurate; this pass adds no contradicting evidence.

## Step 9 Verification and exit

Re-reading the evidence path independently for the highest-impact item
(`middleware.ts` fallback): the `unknown:${crypto.randomUUID()}` key at line 54
is reached only when `resolveRateLimitClientIP` (line 45) returns undefined,
which requires `hasNodeServerConnBinding` (line 25) to be false **and**
`getConnInfo` to throw or return empty. Under a normal `@hono/node-server`
deployment the binding is present, so the no-op case is an edge deployment, not
the default — confirming Medium rather than High. The foundational loopback
control (`runtime/listen-security.ts:27-32`) holds; secret redaction is
bidirectional; directory resolution defends against traversal and symlink escape;
the HTML report escapes via `esc()` (`quality/dre-graph-format.ts:21-28`) which
covers `& < > " '`. No Critical items exist in `findings/`, so the
`reverify.md` gate is not triggered for this unit.
