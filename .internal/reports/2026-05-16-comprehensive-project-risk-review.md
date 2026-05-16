---
title: "Comprehensive Project Risk Review"
date: "2026-05-16"
status: "fourth-slice-implemented"
author: "Codex"
scope: "ax-code monorepo, with emphasis on packages/ax-code, SDK, integrations, and repo guardrails"
---

# Comprehensive Project Risk Review

## Executive summary

This review found one high-confidence implementation weakness that should be treated as security/control-plane debt, plus several structural fragility risks that make future regressions likely.

Follow-up implementation status: the first four recommended slices have been implemented. `Permission.ask()` now asks by default for autonomous unknown permissions, matching `SafetyPolicy.decide()`. The workspace event server now shares the main server's non-loopback authentication invariant, doctor reports effective server exposure plus isolation-policy provenance, and network-only isolation escalation no longer disables write/protected-path isolation.

The next largest risk class is complexity concentration: `session/prompt.ts`, TUI session rendering, LSP orchestration, server session routes, provider logic, and several quality modules are all very large, stateful files. The repo has guardrails that report this, but the size signal is not a blocking policy. The risk is not file size alone; it is file size combined with timers, abort propagation, streamed state, permission decisions, and cross-process lifecycle management.

Initial findings were based on static repository inspection only. The follow-up implementations were validated with targeted permission/control-plane/server/doctor/session/isolation tests plus package typecheck; no TUI startup or browser checks were needed for these slices.

## Implementation update 1: 2026-05-16

Implemented slice: **Permission policy authority**.

Changes made:

- Changed autonomous unknown-permission enforcement in `packages/ax-code/src/permission/index.ts` from default allow to default ask.
- Preserved an explicit compatibility escape hatch: `experimental.autonomous_strict_permission: false`.
- Updated the config schema description and `risk-classes.ts` comments so source-level documentation matches the new default.
- Added enforcement-level tests in `packages/ax-code/test/permission/next.test.ts` for both default ask behavior and explicit legacy allow compatibility.

Validation run:

- `bun test test/permission/next.test.ts test/control-plane/safety-policy.test.ts`
- `bun run typecheck`

Outcome:

- Original P1 autonomous unknown-permission enforcement split: **fixed for default behavior**.
- Remaining follow-up: shadow safety events are still emitted as shadow telemetry. Because default enforcement now matches `SafetyPolicy.decide()` for unknown autonomous permissions, the highest-risk disagreement is removed. A later observability cleanup can still add explicit `shadowDecision` / `enforcedDecision` fields if downstream reporting needs drift diagnostics.

## Implementation update 2: 2026-05-16

Implemented slice: **Server exposure invariant**.

Changes made:

- Added `packages/ax-code/src/server/listen-security.ts` as the shared server-layer bind-security helper.
- Switched `packages/ax-code/src/server/server.ts` to use the shared helper for non-loopback authentication enforcement and loopback mDNS checks.
- Added the same enforcement to `WorkspaceServer.Listen()` so direct callers cannot bypass the CLI wrapper's network-auth guard.
- Added a doctor `Server exposure` check that reports hostname, loopback/network exposure, and auth configuration.
- Added tests covering workspace-server non-loopback rejection and doctor exposure reporting.

Validation run:

- `bun test test/control-plane/workspace-server-sse.test.ts test/server/server.test.ts test/cli/doctor.test.ts`
- `bun run typecheck`

Outcome:

- Original P1 workspace-server exposure invariant: **fixed**.
- Main server and workspace server now share the same server-layer non-loopback password guard.
- Doctor now reports effective server exposure for the configured server hostname and auth state.

## Implementation update 3: 2026-05-16

Implemented slice: **Isolation policy visibility**.

Changes made:

- Added a doctor `Isolation policy` check that reports effective isolation mode, network access, and provenance for both.
- The check warns when runtime isolation is using the permissive `full-access` default without an explicit env/config source.
- Added tests covering default `full-access`, config-provided `workspace-write`, and env-overridden `full-access`.

Validation run:

- `bun test test/cli/doctor.test.ts`
- `bun run typecheck`

Outcome:

- Original P1 runtime isolation default risk: **mitigated through operator visibility, behavior unchanged**.
- This intentionally avoids changing the runtime default in the same slice. The next product decision remains whether to change the default to `workspace-write` or keep `full-access` as an explicit compatibility posture.

## Implementation update 4: 2026-05-16

Implemented slice: **Scoped isolation escalation**.

Changes made:

- Replaced the legacy unscoped isolation retry override that constructed `full-access` with a narrow retry state helper.
- Network escalation now enables only `network: true` while preserving the active isolation mode, protected paths, and any approved path bypasses.
- Path-only escalation remains path-scoped and does not enable network.
- Non-network unscoped denials no longer receive an implicit full-access retry.

Validation run:

- `bun test test/session/prompt.test.ts`
- `bun test test/isolation/isolation.test.ts`
- `bun run typecheck`

Outcome:

- Original P2 isolation escalation risk: **fixed for network retries**.
- The runtime still supports explicit `full-access` mode through config/env/user-controlled policy, but approving a network-only retry no longer disables workspace-write or protected-path enforcement for that tool invocation.

## Methodology

- Reviewed repository-specific guidance and existing `.internal` context.
- Inspected package metadata, source layout, file-size hotspots, guardrail scripts, and targeted high-risk implementation areas.
- Focused on incorrect implementation, weakness, fragility, unstable lifecycle behavior, and guardrail gaps.
- Initial review did not execute tests, typecheck, build, or TUI startup smoke. The follow-up implementation ran the targeted permission/control-plane tests and package typecheck listed above.

## High-priority findings

### P1: Autonomous permission safety policy is shadow-only and can disagree with enforcement

**Status: fixed in follow-up implementation for default autonomous unknown-permission behavior.**

**Evidence**

- `packages/ax-code/src/control-plane/safety-policy.ts:132` returns `ask` for unknown permissions when `mode === "autonomous"`.
- `packages/ax-code/test/control-plane/safety-policy.test.ts:93` explicitly tests that autonomous unknown permissions ask.
- `packages/ax-code/src/permission/index.ts:192` calls `SafetyPolicy.decide(...)`, but only emits a shadow `safetyDecided` event.
- Before the follow-up fix, `packages/ax-code/src/permission/index.ts` checked `experimental.autonomous_strict_permission`; when it was not enabled, unknown autonomous permissions defaulted to allow.
- After the follow-up fix, `Permission.ask()` treats `experimental.autonomous_strict_permission !== false` as strict. Only an explicit `false` preserves the legacy allow behavior.
- `packages/ax-code/src/permission/risk-classes.ts` now documents that unknown permissions ask by default and that `autonomous_strict_permission: false` is the compatibility escape hatch.

**Why this is incorrect or fragile**

Before the follow-up fix, the control-plane policy and the actual enforcement path encoded different contracts. A consumer reading safety events could believe an unknown autonomous permission required approval, while the actual runtime allowed it. That was especially risky because the event was marked as a shadow decision, but downstream summaries could still make the safety posture look stricter than it was.

**Recommendation**

Make `SafetyPolicy` the enforcement source of truth, or rename it explicitly to `ShadowSafetyPolicy` until it is authoritative. The safest low-risk slice was:

1. Add a focused test covering `Permission.ask()` with `AX_CODE_AUTONOMOUS` and an unknown permission. **Done.**
2. Change unknown autonomous permission handling to ask by default, preserving an explicit compatibility escape hatch only if needed. **Done.**
3. Keep the shadow event, but make it compare `shadowDecision` vs `enforcedDecision` so drift is visible. **Deferred.** The default enforcement path now matches the policy for this finding; explicit drift telemetry can be added as a separate observability slice.

### P1: CLI shutdown uses an unconditional forced-exit timer after every command parse

**Evidence**

- `packages/ax-code/src/cli/boot.ts:89` defines `scheduleForcedExit()` with a 500ms timeout.
- `packages/ax-code/src/cli/boot.ts:240` calls `scheduleForcedExit()` in `run()`'s `finally` block after `cmd.parse()`.
- The comment explains this protects against subprocesses that do not react to signals, especially MCP servers.

**Why this is fragile**

The implementation is a pragmatic hang guard, but it is global and command-agnostic. Any command that resolves `cmd.parse()` while still relying on late async cleanup, deferred diagnostic writes, WAL flushes, telemetry, or child-process disposal has only 500ms before forced process exit. That can hide cleanup bugs by making the process disappear rather than requiring explicit lifecycle completion.

**Recommendation**

Keep the forced-exit safety net, but make it command-scoped:

1. Introduce a `CommandShutdownPolicy` with `none`, `mcp-safe-exit`, and `long-running-daemon` modes.
2. Require commands that spawn subprocesses to register cleanup promises with a bounded shutdown manager.
3. Emit diagnostic logs when forced exit actually fires, including command name and pending handles if known.

### P1: The `/session/:sessionID/message` route advertises streaming but returns one final JSON payload

**Evidence**

- `packages/ax-code/src/server/routes/session.ts:1193` describes the endpoint as creating and sending a message while streaming the AI response.
- `packages/ax-code/src/server/routes/session.ts:1220` wraps the response in `stream(c, ...)`.
- `packages/ax-code/src/server/routes/session.ts:1223` awaits `SessionPrompt.prompt(...)` and only then writes one JSON object.
- Errors are also written as JSON in a 200 response body at `packages/ax-code/src/server/routes/session.ts:1226`.

**Why this is incorrect or fragile**

The route shape says streaming, but the implementation behaves like a long-polling final-result endpoint. Clients that expect progressive chunks from this route will not receive them. Clients that rely on HTTP status for failures can miss failures because application errors are encoded as a JSON `{ error }` body under status 200.

This may be intentional compatibility behavior, but the contract is currently ambiguous.

**Recommendation**

Split the contract clearly:

1. Keep this endpoint as `session.prompt` final-result JSON, and update description/SDK typing to avoid implying progressive streaming.
2. Expose progressive updates through `/event` or a dedicated SSE endpoint.
3. Return non-2xx status for pre-prompt validation and typed prompt failures when no assistant message was created.

## Medium-priority findings

### P2: Complexity is concentrated in stateful, high-risk files

**Evidence**

Top large files from static line counts include:

- `packages/ax-code/src/session/prompt.ts`: 3,146 lines.
- `packages/ax-code/src/cli/cmd/tui/routes/session/index.tsx`: 2,807 lines.
- `packages/ax-code/src/quality/model-registry.ts`: 2,697 lines.
- `packages/ax-code/src/server/routes/dre-graph.ts`: 2,662 lines.
- `packages/ax-code/src/lsp/index.ts`: 2,109 lines.
- `packages/ax-code/src/server/routes/session.ts`: 1,469 lines.
- `packages/ax-code/src/provider/provider.ts`: 1,182 lines.

The structure script reports `500+` and `800+` line files, but `script/structure.ts:245` only fails on missing docs, boundary violations, deep imports, v4 guardrails, stale root folders, or unexpected root folders. Large files are reported, not enforced.

**Why this is fragile**

These are not passive modules. They contain session orchestration, TUI rendering, LSP lifecycle, server APIs, provider behavior, and release quality logic. Large stateful files increase regression risk because changes often require understanding timers, abort propagation, event ordering, cache behavior, and UI state at once.

**Recommendation**

Do not do a broad rewrite. Use a ratchet:

1. Keep existing large files working.
2. For every touched large file, require either a local extraction or an explicit "no extraction because..." note in the PR/review artifact.
3. Make `script/structure.ts` fail only on newly added files over 800 lines or on existing files that grow by more than a small threshold.

### P2: TUI session rendering is type-erased at important tool-display boundaries

**Evidence**

- `packages/ax-code/src/cli/cmd/tui/routes/session/index.tsx` is 2,807 lines.
- `packages/ax-code/src/cli/cmd/tui/routes/session/index.tsx:206` reads task tool parts through `(part as any)`.
- `packages/ax-code/src/cli/cmd/tui/routes/session/index.tsx:1750` models tool permission as `Record<string, any>`.
- `packages/ax-code/src/cli/cmd/tui/routes/session/index.tsx:1755` defines `GenericTool(props: ToolProps<any>)`.
- The same file owns session sync retries, reconnect handling, scrolling, sidebar state, tool rendering, diagnostics, and interactive display behavior.

**Why this is fragile**

The TUI is a high-churn product surface. Type erasure at tool-rendering boundaries means changes to tool metadata can silently degrade display behavior, permission highlighting, or completion state. Because this lives inside one very large component file, local fixes are easy but durable contracts are hard.

**Recommendation**

Extract a small typed `ToolPartViewModel` layer:

1. Convert raw `ToolPart` plus metadata into a discriminated view model.
2. Let the TS compiler reject unknown tool display states.
3. Keep OpenTUI/Solid rendering as a thin consumer of that view model.

### P2: SDK v1/v2 generated SSE parsers have behavior drift

**Evidence**

- `packages/sdk/js/src/gen/core/serverSentEvents.gen.ts` clamps `retry:` values to non-negative numbers and a 60s maximum.
- `packages/sdk/js/src/v2/gen/core/serverSentEvents.gen.ts` accepts any numeric `retry:` value without the same non-negative check or clamp.
- The SDK carries both `gen/` and `v2/gen/` generated trees, totaling about 20k lines.

**Why this is fragile**

Generated code duplication can be acceptable, but generated client behavior should not drift accidentally. A malicious or malformed SSE `retry:` field can produce different retry behavior across SDK generations. Even if current server heartbeats do not emit `retry:`, the client library should have one consistent contract.

**Recommendation**

Move SSE retry normalization into one shared generator template or shared hand-written helper used by both generated trees. Add a small golden test that compares v1/v2 behavior for `retry: -1`, `retry: 0`, and `retry: 999999999`.

### P2: Native addon fallback is centralized but can hide packaged-runtime drift

**Evidence**

- `packages/ax-code/src/native/addon.ts:21` centralizes native addon loading.
- `packages/ax-code/src/native/addon.ts:26` returns `undefined` when feature flags are disabled or the package is missing.
- `packages/ax-code/src/native/addon.ts:28` logs non-module-not-found load failures and falls back.
- Addon accessors are cached through `lazy()`, so an early load failure remains the process-wide result.

**Why this is fragile**

Optional native accelerators are the right architecture, but packaged-runtime parity is easy to lose: missing native packages, wrong platform artifacts, or transient load failures silently push users to JS fallback. That is acceptable for availability, but dangerous for performance and release confidence if not surfaced clearly.

**Recommendation**

Expose a stable native status surface in `doctor`, startup diagnostics, and perf reports:

1. Feature flag state.
2. Package present/missing.
3. Load error category.
4. Active path chosen by each tool.

### P2: LSP orchestration is robust in places but remains a large coupled subsystem

**Evidence**

- `packages/ax-code/src/lsp/index.ts` is 2,109 lines.
- It owns perf sampling, server selection, broken-server backoff, root cache, spawn state, health checks, request timeouts, semantic envelopes, and cache integration.
- `packages/ax-code/src/lsp/index.ts:482` starts a health-check interval over connected clients.
- `packages/ax-code/src/lsp/index.ts:1360` starts content-addressable LSP response cache integration with a 24h TTL and probabilistic pruning.

**Why this is fragile**

There are several good hardening choices here: bounded perf samples, backoff, health checks, and cache failure fallback. The weakness is that too many independent policies live in one namespace/file. A small change to cache, server selection, root detection, or scheduler behavior can accidentally affect tool latency or missing-server semantics.

**Recommendation**

Extract policy-only modules before changing behavior:

1. `lsp/broken-server-policy.ts`.
2. `lsp/cache-policy.ts`.
3. `lsp/perf-sampler.ts`.
4. `lsp/client-selection.ts`.

Keep behavior identical first, then change one policy at a time with targeted tests.

### P2: VS Code integration maintains a separate hand-written streaming client

**Evidence**

- `packages/integration-vscode/src/chat-provider.ts:378` fetches `/event` directly and parses SSE chunks manually.
- `packages/integration-vscode/src/chat-provider.ts:405` swallows aborted/network errors and relies on retrying on the next turn.
- `packages/integration-vscode/src/chat-provider.ts:504` uses timer-throttled stream flushing.
- `packages/integration-vscode/src/chat-provider.ts:652` waits for server startup by matching `listening on <url>` in stdout/stderr.

**Why this is fragile**

The VS Code extension duplicates client behavior that already exists in SDK/server code: event stream parsing, backpressure assumptions, stream flushing, server startup detection, and lifecycle cleanup. Because it parses process output instead of using a structured readiness protocol, changes to CLI logging can break extension startup.

**Recommendation**

Use a shared client/readiness contract:

1. Add a structured `--json-ready` or startup IPC mode for integrations.
2. Reuse SDK SSE parsing or a shared parser in the extension.
3. Add reconnect backoff that does not wait for the next user turn.

## Guardrail and architecture weaknesses

### Effect usage freeze is not fully enforceable from current guardrails

**Evidence**

- Repository guidance says new Effect usage is frozen outside legacy areas.
- `packages/ax-code/script/check-no-effect-solid-in-v4.ts:32` only checks selected v4 directories: `src/runtime`, `src/cli/cmd/tui-v4`, `src/cli/cmd/tui/state`, `src/cli/cmd/tui/input`, and `src/cli/cmd/tui/native`.
- Existing Effect imports remain in areas such as `installation`, `provider/auth`, `filesystem`, `skill`, `account`, and test support.

**Risk**

This may be acceptable for legacy code, but the current guardrail does not prevent new Effect usage from being added to many non-legacy directories. The policy depends on reviewer memory instead of a mechanical allowlist.

**Recommendation**

Replace the directory-only v4 guard with an explicit allowlist:

1. Allow known legacy files or directories.
2. Fail on any new Effect import outside that allowlist.
3. Require PR-level justification when the allowlist changes.

### Structure guard reports large files but does not enforce a size ratchet

**Evidence**

- `script/structure.ts:248` computes files above 800 lines.
- `script/structure.ts:285` writes `500+ line files` and `800+ line files` to the report.
- The script exits non-zero only for docs, package boundary, deep import, v4 guardrail, stale folder, or unexpected root-folder failures.

**Risk**

The repo knows where complexity is growing, but it does not prevent new large files or growth in existing hotspots. That makes gradual entropy likely.

**Recommendation**

Add a baseline file for existing large files and fail only on growth beyond the baseline. This avoids disruptive rewrites while making complexity a ratchet instead of a dashboard-only metric.

## Positive findings worth preserving

- Native addon loading is centralized in `native/addon.ts`; call sites are not expected to `require()` native packages directly.
- SSE server queues are bounded by soft and hard watermarks in `server/sse-queue.ts`.
- Event routes include heartbeats and abort cleanup.
- LSP includes bounded perf sampling, broken-server backoff, health checks, and cache-failure fallback behavior.
- TUI startup tracing has explicit `begin`, `once`, and span helpers in `startup-trace.ts`.
- The repo has meaningful structure checks for package boundaries, deep imports, architecture notes, and v4 Effect/Solid/OpenTUI boundaries.

## Recommended implementation order

1. Fix the autonomous unknown-permission enforcement split. **Done in follow-up implementation.**
2. Clarify `/session/:sessionID/message` response contract and SDK docs/types.
3. Add a command-scoped shutdown policy instead of unconditional global forced exit.
4. Introduce a large-file size ratchet in `script/structure.ts`.
5. Extract typed TUI tool view models from the large session route.
6. Normalize SDK v1/v2 SSE retry parsing through one shared contract.
7. Add native addon status reporting to `doctor` and startup diagnostics.
8. Convert Effect freeze into an allowlist-based guardrail.

## Suggested first small slice

The highest value, lowest ambiguity first slice was the permission policy split:

- Add a test that exercises `Permission.ask()` in autonomous mode with a synthetic unknown permission. **Done.**
- Assert it asks by default. **Done.**
- Make `Permission.ask()` enforce the same unknown-permission behavior as `SafetyPolicy.decide()`. **Done for default autonomous unknown permissions.**
- Keep compatibility behind `experimental.autonomous_strict_permission` only if product policy explicitly wants legacy allow. **Done: explicit `false` preserves legacy allow.**

That slice is narrow, security-relevant, and does not require touching TUI, LSP, SDK generation, or release tooling.

## Appendix: reviewed surfaces

- `package.json`
- `packages/ax-code/package.json`
- `packages/ax-code/src/permission/index.ts`
- `packages/ax-code/src/permission/risk-classes.ts`
- `packages/ax-code/src/control-plane/safety-policy.ts`
- `packages/ax-code/src/cli/boot.ts`
- `packages/ax-code/src/native/addon.ts`
- `packages/ax-code/src/lsp/index.ts`
- `packages/ax-code/src/server/routes/event.ts`
- `packages/ax-code/src/server/routes/session.ts`
- `packages/ax-code/src/server/sse-queue.ts`
- `packages/ax-code/src/cli/cmd/tui/util/startup-trace.ts`
- `packages/ax-code/src/cli/cmd/tui/routes/session/index.tsx`
- `packages/ax-code/src/tool/task.ts`
- `packages/ax-code/src/runtime/service-manager.ts`
- `packages/integration-vscode/src/chat-provider.ts`
- `packages/sdk/js/src/gen/core/serverSentEvents.gen.ts`
- `packages/sdk/js/src/v2/gen/core/serverSentEvents.gen.ts`
- `script/structure.ts`
- `packages/ax-code/script/check-no-effect-solid-in-v4.ts`
- `.internal/archive/2026-05-15-module-review-packages-ax-code-src.md`

---

# Addendum: Best-practices follow-up review

## Scope of this pass

This addendum extends the first review with a best-practices lens. It focuses on whether existing defenses are authoritative, shared across entrypoints, visible to operators, and safe by default.

Additional surfaces reviewed:

- `packages/ax-code/src/tool/bash.ts`
- `packages/ax-code/src/tool/edit.ts`
- `packages/ax-code/src/tool/write.ts`
- `packages/ax-code/src/tool/apply_patch.ts`
- `packages/ax-code/src/tool/multiedit.ts`
- `packages/ax-code/src/tool/webfetch.ts`
- `packages/ax-code/src/tool/websearch.ts`
- `packages/ax-code/src/tool/codesearch.ts`
- `packages/ax-code/src/isolation/index.ts`
- `packages/ax-code/src/session/prompt.ts`
- `packages/ax-code/src/session/llm.ts`
- `packages/ax-code/src/util/ssrf.ts`
- `packages/ax-code/src/storage/storage.ts`
- `packages/ax-code/src/storage/json-migration.ts`
- `packages/ax-code/src/server/server.ts`
- `packages/ax-code/src/server/routes/isolation.ts`
- `packages/ax-code/src/server/routes/autonomous.ts`
- `packages/ax-code/src/control-plane/workspace-router-middleware.ts`
- `packages/ax-code/src/control-plane/workspace-server/server.ts`
- `packages/ax-code/src/config/config.ts`
- `packages/ax-code/src/cli/bootstrap/env.ts`
- `packages/ax-code/src/cli/cmd/doctor.ts`
- `packages/ax-code/src/installation/index.ts`
- `packages/ax-code/script/build.ts`
- `packages/ax-code/script/build-source.ts`
- `script/setup-cli.ts`

No tests, typecheck, builds, startup smoke, or browser checks were run.

## Additional high-priority findings

### P1: Workspace server can run unauthenticated if exposed directly

**Status: fixed in follow-up implementation.**

**Evidence**

- `packages/ax-code/src/control-plane/workspace-server/server.ts` applies Basic Auth only when `AX_CODE_SERVER_PASSWORD` is set.
- Before the follow-up fix, `WorkspaceServer.Listen(input: { hostname; port })` did not enforce the non-loopback password guard present in the main server.
- After the follow-up fix, both `WorkspaceServer.Listen()` and `Server.listen()` call `assertAuthenticatedNetworkBind(...)` from `packages/ax-code/src/server/listen-security.ts`.
- `packages/ax-code/src/cli/cmd/doctor.ts` now includes a `Server exposure` check for configured hostname and auth state.

**Why this is fragile**

Before the follow-up fix, the main server had a strong bind-time safety contract, but the workspace server did not enforce the same invariant. If a caller bound the workspace server to a non-loopback hostname without a password, event streaming could be exposed without authentication. The invariant now lives at the server boundary for both server types.

**Recommendation**

Move the non-loopback password guard into `WorkspaceServer.Listen()` or a shared server-bind helper used by both servers. Add a test that non-loopback workspace-server listen fails without `AX_CODE_SERVER_PASSWORD`. **Done.**

### P1: Runtime isolation defaults to `full-access`

**Status: mitigated in follow-up implementation through doctor visibility; runtime behavior unchanged.**

**Evidence**

- `packages/ax-code/src/isolation/index.ts:40` resolves mode as `Flag.AX_CODE_ISOLATION_MODE ?? config?.mode ?? "full-access"`.
- `packages/ax-code/src/config/schema.ts` describes `full-access` as disabling isolation.
- TUI state defaults to workspace-write in some client-side bootstrap state, but the runtime authority in `Isolation.resolve()` is still full-access unless config/flag says otherwise.
- After the follow-up visibility slice, `packages/ax-code/src/cli/cmd/doctor.ts` reports the effective isolation mode, network access, and whether each came from env, config, `full-access`, or default.

**Why this is fragile**

The tool layer is well-instrumented for isolation once isolation is enabled, but the runtime default is permissive. That makes sandbox safety depend on product entrypoint behavior, user config, or UI toggles rather than a single runtime default. The follow-up doctor check makes this visible, but it does not change the underlying enforcement default.

**Recommendation**

Consider changing the runtime default to `workspace-write` with `network: false`, while preserving an explicit `--sandbox full-access` / config escape hatch. If this is too disruptive, add a startup diagnostic that clearly records why the effective mode is `full-access` and whether it came from default, CLI flag, env, or config. **Doctor visibility is done; startup trace visibility remains a possible follow-up.**

### P1: Bash remains a high-risk capability despite improved path scanning

**Evidence**

- `packages/ax-code/src/tool/bash.ts` parses Bash via tree-sitter and extracts common commands and redirect targets.
- It explicitly treats command substitutions as opaque in several branches, for example skipping args matching `$(`, `${`, or backticks.
- It falls back to prompting for the raw command only when no command nodes are found.
- It finally executes the full string through `spawn(params.command, { shell, ... })`.

**Why this is fragile**

This implementation has several strong mitigations: timeout, abort cleanup, output cap, sanitized environment, process-group tracking, external-directory prompts, isolation checks, and redirect write blast-radius accounting. The remaining risk is semantic: shell languages are too expressive to make path extraction authoritative. Any static extractor should be treated as a hint, not a complete sandbox.

**Recommendation**

Document and enforce `bash` as a separate high-risk permission class:

1. In autonomous mode, require explicit approval or a narrow allow rule for `bash` even when individual paths appear safe.
2. Show the raw command as the primary approval unit; path extraction should enrich the prompt, not replace command-level risk.
3. Add telemetry fields for `opaqueShellSyntax: true` when substitutions, process substitution, heredocs, or shell wrappers are detected.

## Additional medium-priority findings

### P2: Server authentication is optional on loopback but mutating routes are powerful

**Evidence**

- `packages/ax-code/src/server/server.ts:548` only applies Basic Auth when `AX_CODE_SERVER_PASSWORD` is set.
- `packages/ax-code/src/server/server.ts:558` rejects cross-origin mutating requests unless the origin matches or is allowlisted.
- `packages/ax-code/src/server/server.ts:647` exposes auth mutation routes.
- `packages/ax-code/src/server/server.ts:702` validates `directory` before entering `Instance.provide`.

**Why this is fragile**

Loopback-only no-auth is common for local tools, and the code includes origin checks and rate limiting. Still, this server exposes high-impact local capabilities: auth mutation, session prompts, shell/tool execution through sessions, config writes, isolation toggles, and project selection by header/query. Browser-origin checks help, but non-browser local processes can call loopback directly.

**Recommendation**

For best-practice hardening, add a lightweight local capability token generated at server start and passed to first-party clients. Keep password auth for remote/non-loopback. This would reduce local cross-process abuse without making normal TUI usage painful.

### P2: Isolation escalation can switch unscoped denials to full-access for a tool retry

**Status: fixed in follow-up implementation for network-only retries.**

**Evidence**

- `packages/ax-code/src/session/prompt.ts:1672` implements per-path isolation bypass for path-scoped denials.
- Before the follow-up fix, unscoped denials such as network created an override with `mode: "full-access", network: true, protected: []`.
- After the follow-up fix, `SessionPrompt.isolationRetryState()` preserves the original isolation mode and protected paths, merges approved path bypasses, and only flips `network` to `true` when the approved retry is network-scoped.

**Why this is fragile**

For path denials, the design is precise. Before the follow-up fix, unscoped network denials were broader than the reason: enabling network also set `mode: full-access` and cleared protected paths for that retry. A pure network tool may not exploit write access, but the mechanism itself violated least privilege.

**Recommendation**

Represent bypass dimensions independently:

- `networkBypass: true` for network-only escalations. **Done.**
- `pathBypass: string[]` for file/path escalations. **Done.**
- Avoid constructing `full-access` unless the user explicitly approves full sandbox disablement. **Done for network-only retries.**

### P2: Remote config trust boundaries are thoughtful but still high-impact

**Evidence**

- `packages/ax-code/src/config/config.ts` rejects dangerous well-known env var names.
- Well-known URLs use the shared SSRF guard and pinned fetch.
- Project configs are loaded as untrusted.
- Account config is treated as trusted and can thread `AX_CODE_CONSOLE_TOKEN` into provider options.

**Why this is fragile**

The trust model is well documented in comments and materially better than a naive remote config loader. The remaining best-practice concern is impact concentration: remote config can affect model routing, tools, plugins, and permissions. If account config or well-known config is compromised, the blast radius is large.

**Recommendation**

Add a config provenance view to `doctor` and debug logs:

1. List every loaded config source.
2. Mark each source as trusted/untrusted/managed/account/well-known/project.
3. Summarize high-impact changes from remote sources: tools, permissions, MCP, plugin, provider env refs.
4. Consider a `--safe-config` mode that ignores account/well-known/plugin-bearing remote config for diagnosis.

### P2: Build scripts can fetch dependencies during build dependency hydration

**Evidence**

- `packages/ax-code/script/build.ts` uses committed model snapshots by default unless explicit refresh env vars are set.
- The same build script can run `bun add --os="*" --cpu="*" ...` to materialize missing build dependency packages.
- `packages/ax-code/script/build-source.ts` avoids the compiled bunfs path and embeds migrations/models.
- `script/setup-cli.ts` rebuilds bundled CLI when the marker does not match the checkout.

**Why this is fragile**

The build path is mostly disciplined: live model updates are explicit and local launcher parity is marker-based. The dependency hydration path is more surprising because a build can mutate local dependency state and fetch packages if optional platform packages are missing. That is useful for release robustness, but it weakens reproducibility if not pinned and logged clearly.

**Recommendation**

Add a release-mode policy switch:

- In local/dev mode, allow dependency hydration with clear logs.
- In release/CI mode, fail if required optional packages are missing unless an explicit `AX_CODE_ALLOW_BUILD_DEP_FETCH=1` is set.
- Record hydrated package names and versions into the build artifact metadata.

### P2: Doctor has native addon visibility but not enough effective-policy visibility

**Evidence**

- `packages/ax-code/src/cli/cmd/doctor.ts` reports runtime, platform, config, API keys, AGENTS.md, git state, duplicate project identity, native addon load status, stale processes, and more.
- Native addon status is routed through the same `NativeAddon` loader used by runtime call sites.
- The current reviewed section does not show equivalent detail for effective isolation provenance, server auth exposure, remote config provenance, or autonomous permission mode.

**Why this is fragile**

Doctor is the right operator surface. It already solves similar visibility problems for native addons and storage. But the highest-risk behavior in this review is policy behavior, not binary presence. Users and maintainers need to see the effective policy before debugging tool/session behavior.

**Recommendation**

Add doctor checks for:

- Isolation mode and source: default/env/CLI/config/project/managed. **Partially done: doctor reports default/env/config.**
- Network enabled/disabled and source. **Done in doctor.**
- Autonomous mode and unknown-permission behavior.
- Server exposure: hostname, auth enabled, CORS allowlist.
- Remote config sources and trust class.

## Additional positive findings

These should be preserved while fixing the risks above:

- `Ssrf.pinnedFetch()` resolves DNS once, validates all resolved addresses, connects to the pinned IP, handles redirects manually, and keeps Host/SNI behavior explicit.
- `webfetch` enforces network isolation, SSRF checks, timeout, redirect revalidation, and a streaming response-size cap.
- `write` and `edit` perform permission/diff/write flows inside file locks, reducing stale approval and symlink swap windows.
- `multiedit` tracks originals, detects write conflicts, and attempts rollback on failure.
- `storage` now pairs in-process locks with cross-process file locks for read/write/remove/update paths.
- `json-migration` uses bounded read concurrency, batch inserts, orphan tracking, and transaction boundaries.
- Main server rejects non-loopback binds without `AX_CODE_SERVER_PASSWORD` and rejects dangerous directory roots before `Instance.provide()`.
- Workspace proxy middleware strips authorization/cookie headers and rejects URL-like path smuggling before adaptor forwarding.

## Updated recommended implementation order

1. Fix autonomous unknown-permission enforcement so `SafetyPolicy` and `Permission.ask()` cannot disagree by default. **Done in follow-up implementation.**
2. Add shared non-loopback password enforcement to workspace server listen paths. **Done in follow-up implementation.**
3. Decide whether runtime isolation should default to `workspace-write`; if not, make `full-access` provenance explicit in doctor/startup diagnostics. **Doctor provenance done; startup diagnostics/default-change decision deferred.**
4. Narrow isolation escalation so network bypass does not construct a full-access override. **Done in follow-up implementation.**
5. Clarify `/session/:sessionID/message` as final-result JSON or split a true progressive stream endpoint.
6. Add command-scoped CLI shutdown policy instead of unconditional forced exit.
7. Treat `bash` as an always-high-risk capability in docs, policy, and telemetry; use path extraction only as supporting evidence.
8. Add effective-policy doctor checks: isolation, autonomous permission behavior, server exposure, and remote config provenance.
9. Add a size ratchet for large files in `script/structure.ts`.
10. Normalize SDK v1/v2 SSE retry parsing through one shared contract.
11. Add release-mode controls around build dependency hydration.

## Updated suggested first two slices

### Slice 1: Permission policy authority

**Status: implemented.**

Goal: make safety policy and enforcement match.

Acceptance criteria:

- `Permission.ask()` has a test for autonomous unknown permission. **Done.**
- The default behavior asks or denies instead of silently allowing unknown permissions. **Done.**
- Shadow safety events either match enforcement or explicitly record both decisions. **Partially done: default enforcement now matches the existing safety decision for unknown autonomous permissions; explicit dual-decision telemetry is deferred.**
- The old permissive behavior, if retained, is gated by a clearly named compatibility option. **Done through explicit `experimental.autonomous_strict_permission: false`.**

### Slice 2: Server exposure invariant

**Status: implemented.**

Goal: ensure no server surface can bind publicly without authentication.

Acceptance criteria:

- Main server and workspace server share the same bind-security helper. **Done.**
- Non-loopback hostname without `AX_CODE_SERVER_PASSWORD` fails at listen time for both server types. **Done.**
- Doctor reports whether server auth is configured and whether the current bind target is loopback-only. **Done.**
