# Protocol Steps: desktop-web-security

- Slug: `desktop-web-security`
- Lane: `codex-sol`
- Date: `2026-08-11`

## Step 1 Map

`desktop/packages/web/server/lib/security/local-only.js:1-31` owns loopback hostname/origin validation, while `request-origin.js:3-54` derives protocol, Host-based origin, RP ID, and localhost aliases without consulting proxy headers. `request-security.js:4-88` returns cookie extraction, WebSocket rejection, and Origin authorization helpers; `legacy-tunnel.js:15-58` blocks leftover public tunnels, and `response-headers.js:9-30` applies route-aware browser security headers.

## Step 2 Threat model

The web server is locally bound but still reachable by arbitrary browser pages and local processes, so DNS rebinding, Host/Origin spoofing, forged forwarded headers, cross-site WebSocket upgrades, UI-session theft, and stale public tunnels are the important boundaries (`desktop/packages/web/server/index.js:1155-1175`, `desktop/packages/web/server/lib/security/request-security.js:59-81`). Browser content is another boundary: framing, MIME confusion, referrer leakage, and script injection matter, while preview/dashboard proxy routes intentionally relax only `X-Frame-Options` and retain the rest of the headers (`response-headers.js:9-30`).

## Step 3 Correctness

Bind-host callers reject anything except localhost, IPv6 loopback, or a valid 127/8 address (`desktop/packages/web/server/lib/security/local-only.js:1-18`, `desktop/packages/web/server/lib/ax-code/server-startup-runtime.js:7-10`). Origin checks require a present loopback Origin whose normalized origin equals the Host-derived loopback origin or its localhost alias, and `desktop/packages/web/server/index.js:1168-1171` disables proxy trust so attacker-controlled forwarded fields cannot alter that decision. The same helpers are passed into preview and startup WebSocket runtimes at `desktop/packages/web/server/index.js:1314-1339`, and passkey registration independently requires loopback RP ID/origin (`desktop/packages/web/server/lib/ui-auth/ui-passkeys.js:177-199`, `ui-passkeys.js:286-301`).

## Step 4 Performance

Request-origin and response-header work consists of URL parsing, a small Set, and a fixed prefix list per request (`desktop/packages/web/server/lib/security/request-security.js:59-81`, `response-headers.js:4-29`), so no material hot-path concern was found. Legacy tunnel scanning runs once before listen and is linear in the small runtime-state directory (`desktop/packages/web/server/lib/security/legacy-tunnel.js:21-52`); no cache, retry loop, or unbounded accumulator exists in this unit.

## Step 5 Design

The separation between bind policy, request identity, request authorization, response hardening, and startup tunnel detection is cohesive and keeps local-only assumptions explicit. Integration is also layered: `desktop/packages/web/server/index.js:1157-1175` installs startup/header protection, `server-startup-runtime.js:7-10` owns final bind resolution, and consumers receive the request-security functions rather than duplicating Host/Origin parsing.

## Step 6 Dead code/hygiene

The two catches in `desktop/packages/web/server/lib/security/legacy-tunnel.js:35-49` intentionally treat malformed state as stale and make stale-file cleanup best effort; a failed cleanup could leave noise but cannot make a live tunnel pass the PID test. The two catches in `request-security.js:44-56` are teardown guards around writing and destroying a rejected socket, and the existing Low hygiene finding records these four sites; no TODO/FIXME or dead export was found.

## Step 7 Tests

`legacy-tunnel.test.js:15-60` covers missing state directories, stale cleanup, live-tunnel startup refusal, and malformed state; `request-origin.test.js:5-33` covers Host fallback and forwarded-header rejection. `request-security.test.js:11-104` covers case/whitespace normalization, IPv6 aliases, remote and stale-public origins, and proxy spoofing, while `response-headers.test.js:6-37` covers normal/proxy framing behavior. Gaps remain for malformed cookie percent-encoding, socket write/destroy failures, local-only hostname unit cases, and an end-to-end browser WebSocket/DNS-rebinding attempt against a listening server.

## Step 8 Findings

`docs/module-quality-audit/modules/desktop-web-security/findings/AUDIT-desktop-web-security-empty-catch.md` is the only registered item, a deferred Low silent-error hygiene record covering legacy cleanup and socket teardown. Source context shows each catch is fail-closed or best-effort after rejection (`legacy-tunnel.js:35-49`, `request-security.js:28-57`), so no severity change or new finding was warranted. There is no Critical finding in this unit, so `protocol/reverify.md` is not applicable.

## Step 9 Verification

I ran `pnpm --dir desktop/packages/web exec vitest run server/lib/security/legacy-tunnel.test.js server/lib/security/request-origin.test.js server/lib/security/request-security.test.js server/lib/security/response-headers.test.js`; all four files and 19 tests passed. The web package's `pnpm --dir desktop/packages/web run type-check` would check its TypeScript UI surface but not these server-side JavaScript policies, so a stronger future gate is the end-to-end listening-server Origin/WebSocket suite described in Step 7.
