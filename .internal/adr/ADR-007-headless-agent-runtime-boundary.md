# ADR-007: Establish a Headless Agent Runtime Boundary

## Status

Accepted

## Date

2026-05-03

## Context

The OpenTUI interface has historically owned too much live agent behavior: event routing, session projection, autonomous request replies, runtime status refreshes, and rendering were coupled through TUI-specific handlers. That made startup and streaming failures hard to isolate because UI lifecycle, server event delivery, session state, and tool/request behavior could all mutate the same state path.

The strategic goal is to make OpenTUI, future web/CLI surfaces, and test/replay tooling consume a shared headless runtime contract instead of each surface re-implementing agent event logic.

## Decision

Introduce a headless runtime layer under `packages/ax-code/src/runtime/headless/` as the main boundary for live agent commands, runtime events, projection, effects, event logs, replay, and event sinks.

The TUI live event path must consume the shared headless projection/effect model. TUI-specific code may keep adapter concerns such as Solid stores, runtime probe scheduling, bootstrap lifecycles, and rendering, but it must not own per-event agent state reducers.

The hidden `headless-run` CLI is accepted as the first executable adapter for this boundary. It is intentionally hidden while the contract stabilizes.

## Phase Boundary

### Completed MVP Foundation

- `HeadlessRuntimeCommand` defines prompt, command, shell, abort, permission reply, and question reply commands.
- `HeadlessRuntimeEvent` defines the shared event model consumed by projection, TUI sync, replay, and CLI event logging.
- `HeadlessProjectionState` and `applyHeadlessProjectionEvent` own session/message/request/runtime projection.
- `HeadlessProjectionEffect` separates pure state mutation from autonomous replies, runtime probes, and bootstrap reloads.
- `runHeadlessSession` coordinates subscription, command send, projection, effects, cancellation, and event sinks.
- `headless-run` provides local and attach-mode JSONL execution, idle timeout, autonomous mode, and optional local event-log mirroring.
- Legacy TUI live event router/domain handlers have been removed from the production path.

### Still Out of Scope

- Full production-grade external headless CLI UX.
- Full server integration tests with real model/provider/tool loops.
- Web or SDK-facing headless execution APIs.
- Durable replay UI.
- Cross-process resume after CLI crash.
- Long-running task graph semantics and multi-agent control-plane integration.

## Consequences

- Event/state bugs should be fixed in the headless projection first, then consumed by TUI and replay.
- TUI sync tests should focus on adapter behavior and store wiring, not duplicate reducer semantics already covered by headless runtime tests.
- Replay must remain pure and must not execute autonomous replies, runtime probes, shell commands, file edits, or tool calls.
- Runtime event sinks are the supported way to capture JSONL artifacts for debug and future CI replay.
- OpenTUI stability work can now distinguish renderer/lifecycle failures from agent runtime/projection failures.

## Validation Gates

- `pnpm --dir packages/ax-code run typecheck`
- `bun test test/runtime/headless/event-log.test.ts test/runtime/headless/replay.test.ts test/runtime/headless/runner.test.ts test/cli/tui/sync-store-event.test.ts test/cli/tui/sync-subscription.test.ts test/cli/tui/sync-runtime-probe.test.ts`
- `cd packages/ax-code && bun run src/index.ts headless-run --transport-smoke --idle-timeout-ms 1000 --event-log /tmp/ax-headless-transport-smoke.jsonl`
- `cd packages/ax-code && bun run src/index.ts headless-run --command-smoke --idle-timeout-ms 1000 --event-log /tmp/ax-headless-command-smoke.jsonl`

## Related Files

- `packages/ax-code/src/runtime/headless/`
- `packages/ax-code/src/cli/cmd/headless-run.ts`
- `packages/ax-code/src/cli/cmd/tui/context/sync-store-event.ts`
- `packages/ax-code/src/cli/cmd/tui/context/sync-runtime-probe.ts`
