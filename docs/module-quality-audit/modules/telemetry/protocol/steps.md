# Telemetry module review protocol

## Step 1 Scope and public surface

The `telemetry` unit is implemented by `packages/ax-code/src/telemetry/index.ts` and `packages/ax-code/src/telemetry/span.ts`. The namespace at `packages/ax-code/src/telemetry/index.ts:18` exposes endpoint discovery, enablement, initialization, session export, and shutdown; the helper module adds asynchronous and synchronous wrappers at `packages/ax-code/src/telemetry/span.ts:38` and `packages/ax-code/src/telemetry/span.ts:69`. The production entry point found for session export is the audit CLI at `packages/ax-code/src/cli/cmd/audit.ts:168-205`.

## Step 2 Trust boundaries and exported data

The collector URL comes from the opt-in flag at `packages/ax-code/src/telemetry/index.ts:24-29`. Initialization rejects non-public destinations before setup and supplies a DNS-pinned fetch implementation at `packages/ax-code/src/telemetry/index.ts:37-50`; the shared guard limits schemes and private addresses at `packages/ax-code/src/util/ssrf.ts:319-349` and checks redirect targets at `packages/ax-code/src/util/ssrf.ts:465-493`. Exported attributes include the session directory, model, agent, tool identity, and error text at `packages/ax-code/src/telemetry/index.ts:100-148`, so operators must treat the configured OTLP collector as a recipient of potentially sensitive local paths and failure messages.

## Step 3 Initialization and shutdown behavior

Concurrent callers share `initPromise`, while the `initialized` gate prevents duplicate provider registration at `packages/ax-code/src/telemetry/index.ts:32-68`. Initialization failures are logged and leave telemetry disabled at `packages/ax-code/src/telemetry/index.ts:62-66`; `exportSession` consequently returns without querying events when setup did not succeed at `packages/ax-code/src/telemetry/index.ts:72-79`. Shutdown waits for in-flight initialization and clears the module state after exporter/provider shutdown at `packages/ax-code/src/telemetry/index.ts:161-173`. This lifecycle is process-global because the provider and flags are namespace state.

## Step 4 Trace construction semantics

Session events are ordered by database sequence in `packages/ax-code/src/replay/query.ts:67-79`. The exporter first indexes the earliest finish/result per key at `packages/ax-code/src/telemetry/index.ts:81-90`, then annotates and ends each step span immediately at `packages/ax-code/src/telemetry/index.ts:107-123`; tool spans use the most recently selected step context at `packages/ax-code/src/telemetry/index.ts:125-143`. This preserves parent IDs but does not reconstruct real event durations or timestamps. Session attributes and terminal reason are applied before the root span ends at `packages/ax-code/src/telemetry/index.ts:145-157`.

## Step 5 Work and resource bounds

`EventQuery.bySession` caps a load at 10,000 events and warns on truncation at `packages/ax-code/src/replay/query.ts:13-26` and `packages/ax-code/src/replay/query.ts:67-78`. Within that bound, `exportSession` performs two linear passes and holds maps for step completions and tool results at `packages/ax-code/src/telemetry/index.ts:81-100`. Every reconstructed span is ended individually, and initialization deliberately uses `SimpleSpanProcessor` at `packages/ax-code/src/telemetry/index.ts:41-58`; export cost therefore scales directly with the retained event count and may generate many collector requests for a large session.

## Step 6 Helper correctness and integration

The asynchronous wrapper records callback errors, rethrows them, and ends its span in a finally block at `packages/ax-code/src/telemetry/span.ts:48-60`. The synchronous wrapper has a more serious control-flow risk: a callback exception is rethrown at `packages/ax-code/src/telemetry/span.ts:79-87`, caught by the outer fallback at `packages/ax-code/src/telemetry/span.ts:89-91`, and can cause `fn(noop)` to run a second time. Search of production sources found no current helper call sites beyond the example at `packages/ax-code/src/telemetry/span.ts:4-12`, limiting present exposure but leaving the exported contract unsafe for future side-effecting callbacks.

## Step 7 Test evidence and gaps

The focused tests verify concurrent initialization registers once and that a loopback endpoint is rejected at `packages/ax-code/test/telemetry/index.test.ts:47-66`; cleanup exercises successful shutdown at `packages/ax-code/test/telemetry/index.test.ts:38-45`. There is no coverage there for event-to-span conversion, truncated sessions, initialization failure logging, async fallback, span-end failure, or the synchronous callback double-execution path. The OpenTelemetry runtime packages used by those paths are declared at `packages/ax-code/package.json:109-113`.

## Step 8 Finding review

The existing finding is Low severity and deferred, with an expiry of 2026-09-11 at `docs/module-quality-audit/modules/telemetry/findings/AUDIT-telemetry-empty-catch.md:3-13`. Its evidence correctly identifies the swallowed `span.end()` failure at `packages/ax-code/src/telemetry/span.ts:57-60` and requests logging. The separate double-invocation risk at `packages/ax-code/src/telemetry/span.ts:83-91` is not represented by that empty-catch finding and should be tracked as a correctness follow-up. No Critical-severity telemetry finding exists, so this primary-review pass does not create `protocol/reverify.md`.

## Step 9 Validation and disposition

The targeted command `AX_TEST_FILES=test/telemetry/index.test.ts pnpm exec vitest run`, run from `packages/ax-code`, passed 1 file and 2 tests; those are the cases defined at `packages/ax-code/test/telemetry/index.test.ts:47-66`. `pnpm --dir packages/ax-code run typecheck` also passed, exercising the script declared at `packages/ax-code/package.json:8-10`. The prior module record still labels dual-agent review pending at `docs/module-quality-audit/modules/telemetry/MODULE-AUDIT.md:60-69`; these protocol artifacts complete the codex-sol reviewer pass while independent verifier responsibility remains assigned to ax-code-glm.
