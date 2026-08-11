# 9-Step Review — notification

Unit: `notification`
Scope: `packages/ax-code/src/notification`
Reviewer: ax-code-glm (model `zai-coding-plan/glm-5.2[1m]`)
Date: 2026-08-11

## Step 1 — Scope and Map

The `notification` unit resolves to a single 30-line source file:
`packages/ax-code/src/notification/events.ts`. Its sole export is `NotificationEvent`
(events.ts:4), a plain object literal aggregating three `BusEvent.define(...)`
contracts:

- `ToastShow`, type `notification.toast.show` (events.ts:5-13): optional `title`,
  required `message`, enum `variant` in `["info","success","warning","error"]`,
  optional numeric `duration` (described in milliseconds).
- `MonitorLine`, type `notification.monitor.line` (events.ts:14-21): `monitorID`,
  `line`, `description`.
- `MonitorExit`, type `notification.monitor.exit` (events.ts:22-29): `monitorID`,
  `description`, `exitCode` typed `z.number().nullable()`.

This is a pure contract/schema module — no runtime logic of its own. Producers
reachable by grep: `src/tool/bash-impl.ts:265`, `src/tool/bash-background.ts:188`,
`src/tool/monitor.ts:103` and `:135`, `src/mcp/impl.ts:651` and `:675`,
`src/session/prompt-routing.ts:67`. Consumers: `src/cli/cmd/tui/ui/toast.tsx:11`
derives `ToastOptions` from the zod schema and re-parses at `:111`;
`src/cli/cmd/tui/app.tsx:1382` subscribes to `ToastShow.type` over the SDK event
channel; `src/cli/cmd/tui/context/sdk.tsx:19-20` mirrors the wire type.

## Step 2 — Threat and Failure Model

This file declares zod schemas and string type discriminators only — there is no
network, filesystem, environment, or secret surface. The realistic failure modes
are contract drift and producer/consumer shape mismatch, not data exposure.

The `BusEvent.define` registry (`packages/ax-code/src/bus/bus-event.ts:7-16`)
keys definitions by their `type` string. The three notification types
(`notification.toast.show`, `notification.monitor.line`,
`notification.monitor.exit`) are unique across the codebase, so there is no
collision risk today. `payloads()` in bus-event.ts:18-39 builds a discriminated
union keyed on `type` and would fail to compile two same-typed entries, so the
registry self-protects.

`MonitorExit.exitCode` (events.ts:27) is `z.number().nullable()`. Producers in
`monitor.ts:135-139` forward `info.exitCode` from `BackgroundShell.observe`. A
`null` here means the process was signaled/killed without a normal exit code;
any future consumer that treatss it as `number` would throw. The contract is
correct but the null semantics are undocumented at the schema level.

`ToastShow.duration` is unbounded; a producer passing `0` would dismiss the
toast instantly because the TUI store at `toast.tsx:100` only applies the
`?? 5000` default when `duration` is absent. Not a security threat — a soft
correctness hazard noted for completeness.

## Step 3 — Correctness

Tracing each call site against the schema:

- `prompt-routing.ts:67-72` publishes `ToastShow` with `title`, `message`,
  `variant: "info"`, `duration: 5000` — all valid against events.ts:7-12.
- `mcp/impl.ts:651-656` and `:675-680` publish `variant: "warning"` with
  `duration: TOAST_DURATION_LONG_MS` — valid enum member, numeric duration.
- `monitor.ts:103-107` publishes `MonitorLine` with the three required fields;
  `monitor.ts:135-139` publishes `MonitorExit` with `exitCode: info.exitCode`
  whose declared type is `number | null`, matching `z.number().nullable()`.
- `app.tsx:1382-1389` re-extracts all four `ToastShow` fields from
  `evt.properties` and forwards them to `toast.show`. The store then
  re-validates via `NotificationEvent.ToastShow.properties.safeParse`
  (`toast.tsx:111`) and falls back to a synthetic error toast on parse failure
  (`toast.tsx:112-117`). This is correct defense-in-depth and means a malformed
  payload cannot throw inside an event handler.

No correctness defects found in the contract or its wiring.

## Step 4 — Performance

The module allocates three schema objects once at import time and registers
them in a `Map` (`bus-event.ts:14`, O(1) insert, called exactly three times).
There is no per-call work beyond zod validation, which happens lazily on
publish/parse. The toast consumer collapses consecutive duplicate toasts
(`toast.tsx:118-126`) and caps the queue at `MAX_QUEUED_TOASTS = 5`
(`toast.tsx:67`), so an error storm cannot cause unbounded work through this
channel. No hot-path concern.

## Step 5 — Design

The module follows the established `<Domain>Event` bus convention used elsewhere
(e.g. `TuiEvent`, `SessionApi.Event`). Cohesion is high — every member is a
notification-channel event. Two minor notes, neither rising to a finding:

- `ToastShow` (user-facing UI) and `MonitorLine` / `MonitorExit`
  (background-shell telemetry) are arguably two concerns, but at 30 total lines
  splitting them would be premature. The current single-object grouping is the
  right call for this size.
- `exitCode` null semantics are encoded in the type but not described. Adding
  `.describe("null when the process was signaled or did not exit normally")` to
  events.ts:27 would make the contract self-documenting. Optional polish.

The interface is minimal and the surface area (one export, three members) is
proportional to what the module does.

## Step 6 — Hygiene and Dead Code

- No empty catch blocks in this file (the catches live in producer files such
  as `monitor.ts:108-113`).
- No `TODO` / `FIXME` markers in `events.ts`.
- No unused exports: all three event members are referenced (ToastShow at
  `toast.tsx:11`, `app.tsx:1382`, `sdk.tsx:19`; MonitorLine/MonitorExit at
  `monitor.ts:103,135`).
- The `import z from "zod"` (events.ts:2) is used by all three schemas.
- `.describe()` is present on `duration` (events.ts:11) but absent on
  `monitorID`, `line`, `description`, `exitCode` — minor polish, not a defect.

No dead code and no hygiene issues identified.

## Step 7 — Tests

There is no dedicated unit test for `packages/ax-code/src/notification/events.ts`,
matching MODULE-AUDIT's "none auto-matched". The contract is exercised
indirectly: monitor events flow through monitor-tool integration coverage, and
toast rendering is covered by TUI component tests. Because the module is purely
declarative schema with no branching logic, direct unit testing has low marginal
value here. The higher-leverage, repo-wide check would be a registry-uniqueness
test across all `BusEvent.define` callers — that is not specific to this unit
and is out of scope for this review.

## Step 8 — Finding Register

No accepted findings. The `findings/` directory is empty and MODULE-AUDIT.md
lists `_none accepted_`. My independent read confirms there are no Critical,
High, Medium, or Low issues that warrant a tracked finding. The two soft notes
(undocumented `exitCode` null semantics; missing `.describe()` on a few fields)
are below the severity bar and are recorded in Steps 5 and 6 as optional polish
only.

## Step 9 — Verification and Exit

Verification approach: this is a read-only schema module with no executable
code path of its own, so the appropriate verification is typecheck plus
producer/consumer wiring confirmation rather than a runtime test.

- The file typechecks as part of `pnpm --dir packages/ax-code run typecheck`
  (imports `@/bus/bus-event` and `zod`, both resolvable).
- All 21 grep hits for `NotificationEvent` resolve to the real producer and
  consumer call sites enumerated in Step 1; no orphan references and no
  duplicated `type` strings.

Exit disposition: **PASS** for the `notification` unit at scope
`packages/ax-code/src/notification`. The module is a minimal, well-scoped
contract surface with correct producers and consumers and zero accepted
findings. This independent 9-step pass satisfies the primary-reviewer side of
the dual-agent gate; the verifier (`codex-sol`) can cross-check the same
evidence paths cited above.
