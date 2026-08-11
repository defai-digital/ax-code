# desktop-web-server — 9-step review (ax-code-glm)

Reviewer: ax-code-glm
Model: zai-coding-plan/glm-5.2[1m]
Slug: desktop-web-server
Date: 2026-08-11

This review covers the Express-backed desktop web server under
`desktop/packages/web/server` and its `lib/ax-code/` runtime helpers. The unit
is the local-only HTTP surface that hosts the React UI, proxies the managed
ax-code process, and owns UI auth, config-entity mutation routes, SSE/WS event
streaming, terminal PTY bridging, and scheduled tasks.

## Step 1 Scope and map

The unit's public surface is declared in `desktop/packages/web/server/index.d.ts:31-40`
(`startWebUiServer`, `gracefulShutdown`, `setupProxy`, `restartAxCode`,
`parseArgs`). The runtime entry is `desktop/packages/web/server/index.js:1128`
(`main`), which wires ~30 injected runtimes (lifecycle, env, auth-state,
network, resolution, bootstrap, settings, theme, session, watcher,
notification, scheduled-tasks, startup-pipeline, graceful-shutdown). Route
registration is split: `bootstrap-runtime.js:24` (`setupBaseRoutes`) mounts
status/auth/notification/openchamber routes; `feature-routes-runtime.js` and
`config-entity-routes.js:1` (`registerConfigEntityRoutes`) mount the config
mutation surface; `core-routes.js:44/318/432/469` expose status, auth+access,
settings-utility, and common-middleware registrars. The CLI entry delegate is
`cli-entry-runtime.js:1` (`runCliEntryIfMain`).

## Step 2 Threat and failure model

This unit is tagged desktop+network and is the only local network listener in
the desktop stack. The dominant risk surfaces are: (a) loopback bind
enforcement, (b) auth on the UI/proxy, (c) process spawning and port killing,
(d) outbound loopback URL probing, and (e) auth.json secret-at-rest handling.
(a) is enforced at `cli-options.js:49` (rejects `0.0.0.0`, tested at
`cli-options.test.js:37-44`) and `env-config.js:46-49` (rejects non-loopback
`AX_CODE_HOST`, also normalizes bracketed IPv6 at `env-config.test.js:52-62`).
(b) is enforced via `uiAuthController.requireAuth` on every `/api` route
(`core-routes.js:423-429`) and individually on shutdown, passkey, probe-url
routes. (c) `core-routes.js:151-188` `killListenPort` is scoped to loopback
`-iTCP:${port}` and excludes `process.pid`; `resolveProcessGroupId` at
`core-routes.js:106-125` is posix-only and used solely by the env-gated
dev-shutdown path (`AX_CODE_DESKTOP_DEV_SHUTDOWN`, `core-routes.js:80-84`).
(d) `core-routes.js:14-42` `buildLoopbackProbeUrl` canonicalizes any accepted
URL to `http(s)://127.0.0.1:{port}/`, stripping attacker path/query/fragment
(tested at `core-routes.test.js:223-244`). (e) `auth.js:45` writes auth.json
with `mode: 0o600` and backs up the prior file at `auth.js:36-42`. No Critical
secrets exposure was found; the only filed item is the Medium empty-catch
ledger (`findings/AUDIT-desktop-web-server-empty-catch.md`).

## Step 3 Correctness

Control flow on the high-stakes public surfaces checks out. Shutdown
(`core-routes.js:216-234`) runs `requireAuth` before
`gracefulShutdown({exitProcess:true})` and is covered by
`core-routes.test.js:26-45`. The smoke-crash endpoint
(`core-routes.js:206-214`) is hard-disabled unless
`AX_CODE_DESKTOP_SMOKE_CRASH_ENDPOINT=true` and still 404s by default
(`core-routes.test.js:69-84`). The dev-shutdown handler
(`core-routes.js:236-292`) requires both the env gate and a same-origin check
(`isSameOriginRequest`, `core-routes.js:92-104`). Config-entity mutation
routes in `config-entity-routes.js` distinguish 400 (bad directory) / 404
(not found) / 409 (already exists) / 500 correctly — e.g. snippet create at
`config-entity-routes.js:412-431` and mcp update not-found at
`config-entity-routes.js:237-239`. `completeMcpMutation`
(`config-entity-routes.js:29-50`) applies the write before attempting reload
and degrades gracefully (`reloadFailed:true`, `requiresReload:false`) if the
reload throws, so a stuck reload never loses the persisted config.

## Step 4 Performance

Per-route rate limiting is mounted at `bootstrap-runtime.js:66-67` for `/api`
and `/auth` (1200 req/min, `bootstrap-runtime.js:3-11`) and again inside the
auth registrar at `core-routes.js:4/320`. JSON body limits are tiered by path
in `core-routes.js:469-506`: `/api/behavior` capped at 1 MiB with a 413 guard
(`core-routes.js:475-477`), config/fs/git/terminal routes at 50 MiB, default
50 MiB. SSE proxy uses backpressure-aware writes (`writeSseChunkWithBackpressure`,
exercised at `ax-code-proxy.test.js:93-112`) and the compression filter
(`index.js:113-133`, `shouldSkipCompression`) excludes event-stream paths by
prefix (`index.js:105-111`) and terminal stream suffixes (`index.js:123-125`)
so streaming responses are not buffered. Background reload dedup
(`background-reload.js:28-43`) coalesces concurrent config-save storms into a
single restart plus one queued follow-up, proven by
`background-reload.test.js:67-101`.

## Step 5 Design

The dependency-injected runtime-factory pattern is consistent and is the
primary reason this unit is testable without spinning a real ax-code:
`auth-state-runtime.js:1`, `ax-code-resolution-runtime.js:1`,
`background-reload.js:10`, `bootstrap-runtime.js:13`, `cli-options.js:8`
(pure), `env-config.js:5` (pure), and the larger `core-routes.js` registrars
all accept their collaborators as arguments. Module-level mutable state in
`index.js` is bridged into the runtimes via `Object.defineProperties` accessor
objects (`index.js:466-497` network state, `531-592` env state, `818-945`
lifecycle state) and an HMR-state runtime (`index.js:341-347`) so Vite reloads
do not orphan the managed ax-code process. One design smell: `index.js` is
1434 lines and still owns a lot of glue (lines 200-700 are mostly forwarding
wrappers like `const applyLoginShellEnvSnapshot = (...args) =>
axCodeEnvRuntime.applyLoginShellEnvSnapshot(...args)`); further extracting the
forwarding layer into a thinner composition root would reduce the file, but
this is a low-severity maintainability note, not a correctness risk.

## Step 6 Hygiene and dead code

The empty-catch sites enumerated in
`findings/AUDIT-desktop-web-server-empty-catch.md` were spot-checked against
source. The ones in this read set are all either best-effort cleanup
(`index.js:1088-1122` `destroyAllClientConnections` — each `try/catch` wraps a
single client `.end()`/`.destroy()`/`.terminate()` and is correctly
per-iteration), lsof/ps tolerance (`core-routes.js:185-187`), or signal-kill
best-effort (`core-routes.js:173-181`, `268-275`, `283`). The seven
`core-routes.js` sites flagged `needs-log`/`review-needed` are the right
dispositions; none hide a silent data-loss path. No dead exports were observed
in the files read: every member of `index.d.ts` is re-exported at
`index.js:1434`, and `auth.js:95-104` exports are all consumed by the auth
route layer.

## Step 7 Tests

Coverage on the read set is genuinely good and targets the risky paths:
`auth-state-runtime.test.js:37-49` verifies trimming + base64 header building;
`auth-state-runtime.test.js:51-59` verifies managed-password generation when
the user password is blank. `cli-options.test.js:37-44` proves non-loopback
hosts are rejected. `env-config.test.js:36-50` proves remote URLs and
non-loopback hostnames both fall back to safe defaults with warnings.
`background-reload.test.js:67-101` proves the queued-follow-up semantics.
`core-routes.test.js:129-201` covers both single and overlapping manual
reloads. `core-routes.test.js:203-264` covers the probe-url auth gate,
canonical loopback rewriting, and non-loopback rejection. `ax-code-proxy.test.js:46-91`
covers SSE header forwarding and Authorization passthrough. The
`desktop/packages/web/server/lib/ax-code/index.js` barrel and
`config-entity-routes.js` do not have a dedicated route-level integration test
in this read set; the config-entity routes are exercised indirectly via the
shared command/agent/snippet helpers, but direct supertest coverage of the
HTTP error-code matrix (400/404/409) would harden the contract.

## Step 8 Finding register

Only one finding is open against this unit:
`AUDIT-desktop-web-server-empty-catch` (silent-error, Medium, deferred, expiry
2026-09-11) with per-site dispositions. My independent read did not surface any
new Critical or High issue. Observations recorded as low-severity notes (not
filed as new findings because they are maintainability, not defects): (1)
`index.js` composition-root size (Step 5), (2) missing direct route-level
integration tests for `config-entity-routes.js` (Step 7), (3) a handful of
`needs-log` empty catches in `core-routes.js`/`lifecycle.js` that should
eventually surface a debug log line per the finding's mitigation. No
reverify.md is required because no Critical finding exists in `findings/`.

## Step 9 Verification and exit

This task is a documentation/audit pass; no source mutations were made, so no
build/typecheck rerun is required for the artifacts themselves. The verification
commands relevant to this unit (per the repo AGENTS.md and MODULE-AUDIT) are
the desktop vitest multi-project config: `pnpm --dir desktop exec vitest run`
with the node project covering `desktop/packages/web/server`, plus
`pnpm --dir desktop run typecheck` / `desktop:lint`. The unit's own co-located
vitest tests (`*.test.js` next to each runtime) are the first-line gate and all
passed on the baseline commit `cab6c0089e3b7b3410f050bc9d824c06a3c3a814`. Exit
checklist: 9 steps complete; findings ledger consistent (single Medium,
deferred, no Critical); reviewer sign-off recorded in `reviewer-run.json` and
`agent-protocol.json`.
