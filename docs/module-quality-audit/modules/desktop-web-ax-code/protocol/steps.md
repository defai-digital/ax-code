# Review Protocol — desktop-web-ax-code

## Step 1 Scope and Entry Map

I reviewed every requested source under `desktop/packages/web/server/lib/ax-code`, the unit audit and Medium finding, plus the integration points in `desktop/packages/web/server/index.js`, `shared.js`, and `DOCUMENTATION.md`. The top-level server awaits login-shell capture before building Express (`desktop/packages/web/server/index.js:1161-1166`), installs base middleware and authentication at `desktop/packages/web/server/index.js:1213-1277`, then registers feature routes at `desktop/packages/web/server/index.js:1279-1312`. This establishes the runtime order used for the remaining steps.

## Step 2 Assets, Boundaries, and Failure Modes

The important assets are provider authentication data, the managed AX Code password, project/user configuration files, executable resolution state, and process lifecycle control. Local-only binding is enforced for CLI input at `desktop/packages/web/server/lib/ax-code/cli-options.js:46-50` and environment configuration at `desktop/packages/web/server/lib/ax-code/env-config.js:46-72`. Managed service credentials are generated from 32 random bytes and copied into request headers at `desktop/packages/web/server/lib/ax-code/auth-state-runtime.js:22-23` and `42-50`. API authentication is installed by `desktop/packages/web/server/lib/ax-code/core-routes.js:423-429`; status routes registered earlier therefore need their own guards when destructive, as shutdown does at `core-routes.js:216-233`.

## Step 3 Correctness and State Transitions

Auth-state normalization is internally consistent: invalid values clear both in-memory and environment state (`desktop/packages/web/server/lib/ax-code/auth-state-runtime.js:25-39`), while user, rotated, and generated sources are distinguished at lines 58-78. A correctness defect remains in multi-field agent patches: `updateAgent` snapshots markdown at `desktop/packages/web/server/lib/ax-code/agents.js:393`, writes a permission immediately at lines 431-445, then can write the stale snapshot again at lines 518-520 after another field changes. Port parsing is also permissive: `parseInt` plus only a finiteness check accepts values such as `12junk`, zero, negative numbers, and ports above 65535 in `desktop/packages/web/server/lib/ax-code/cli-options.js:38-42`; environment ports have the same partial-string issue at `desktop/packages/web/server/lib/ax-code/env-config.js:9-15`.

## Step 4 Security Review

The loopback probe avoids arbitrary-host SSRF by accepting only HTTP(S), checking localhost/IPv4/IPv6 loopback, validating the port, and rebuilding a root-only `127.0.0.1` URL (`desktop/packages/web/server/lib/ax-code/core-routes.js:14-42`); authentication precedes its fetch at lines 398-417. Auth writes use mode `0o600` at `desktop/packages/web/server/lib/ax-code/auth.js:44-46`, although the adjacent backup copy at lines 36-42 does not explicitly enforce a restrictive mode. Authenticated configuration mutation is a broad filesystem-write surface: route parameters flow from `desktop/packages/web/server/lib/ax-code/config-entity-routes.js:91-105` into agent paths assembled at `desktop/packages/web/server/lib/ax-code/agents.js:36-38`, while `desktop/packages/web/server/lib/ax-code/shared.js:69-78` performs no segment-containment check. The API guard limits reachability, but name validation should be explicit at this boundary.

## Step 5 Performance and Concurrency

Startup avoids a known event-loop stall by using `execFile` with both a child timeout and an independent deadline (`desktop/packages/web/server/lib/ax-code/env-runtime.js:248-305`); tests cover both ordinary timeout and inherited-stream non-closure at `desktop/packages/web/server/lib/ax-code/env-runtime.test.js:108-159`. Background reloads serialize work and retain only the newest queued reason at `desktop/packages/web/server/lib/ax-code/background-reload.js:25-42`, with overlap behavior exercised at `background-reload.test.js:67-101`. Some fallback discovery remains synchronous and lacks an explicit timeout, notably login-shell probes at `env-runtime.js:183-207` and command lookup at lines 542-559, so those paths can still pause the server when called outside the async startup capture.

## Step 6 Design and Ownership

The extracted runtimes generally have coherent roles. `desktop/packages/web/server/lib/ax-code/bootstrap-runtime.js:24-100` owns base-route order and UI-auth construction; `desktop/packages/web/server/lib/ax-code/feature-routes-runtime.js:30-77` coordinates feature registration and reuses a single background reloader; `desktop/packages/web/server/lib/ax-code/ax-code-resolution-runtime.js:12-63` shapes binary-resolution snapshots. This matches the ownership described at `desktop/packages/web/server/lib/ax-code/DOCUMENTATION.md:160-164`, `225-266`, and `310-320`. The main design pressure is duplicated agent/command persistence logic (`agents.js:328-567`, `commands.js:105-275`), which has already allowed permission-update semantics to diverge from the simpler command path.

## Step 7 Hygiene and Observability

The deferred silent-error concern is real rather than purely stylistic. Process termination failures are ignored at `desktop/packages/web/server/lib/ax-code/core-routes.js:171-186` and `264-290`, making partial shutdown hard to diagnose. Executable discovery suppresses failures across Windows and shell probes at `desktop/packages/web/server/lib/ax-code/env-runtime.js:138-167`, `510-559`, and `588-622`; most are best-effort fallbacks, but no local context distinguishes expected absence from operational failure. Non-strict settings application also catches every error without reporting it at `env-runtime.js:1069-1146`, which can hide disk-read failures as if no binary were configured.

## Step 8 Tests and Finding Disposition

Focused verification passed 35 tests in six files: `auth-state-runtime.test.js`, `background-reload.test.js`, `cli-options.test.js`, `core-routes.test.js`, `env-config.test.js`, and `env-runtime.test.js`. The tests substantiate password generation (`desktop/packages/web/server/lib/ax-code/auth-state-runtime.test.js:36-59`), loopback-only CLI hosts (`cli-options.test.js:37-44`), canonical probe URLs (`core-routes.test.js:203-263`), reload coalescing, and binary-launch behavior. There are no direct tests for the mutation paths in `agents.js`, `commands.js`, or `config-entity-routes.js`, leaving the stale permission overwrite uncovered. `findings/AUDIT-desktop-web-ax-code-empty-catch.md:5-13` classifies the only registered item as Medium and deferred through 2026-09-11; no Critical item exists, so `reverify.md` is not created.

## Step 9 Verification and Exit Assessment

The command `pnpm --dir desktop/packages/web exec vitest run server/lib/ax-code/auth-state-runtime.test.js server/lib/ax-code/background-reload.test.js server/lib/ax-code/cli-options.test.js server/lib/ax-code/core-routes.test.js server/lib/ax-code/env-config.test.js server/lib/ax-code/env-runtime.test.js` completed successfully with six files and 35 tests passing. The nine-step review is complete, but the module should not be treated as issue-free: the existing Medium silent-error item remains deferred, and the agent multi-field overwrite plus permissive port parsing need follow-up. No production source or other audit unit was changed.
