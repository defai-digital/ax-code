# ADR-003: Keep OpenTUI and Bun as the mainline runtime and harden them directly

**Status:** Accepted
**Date:** 2026-04-26
**Deciders:** ax-code maintainers
**Supersedes:** ADR-001 rendering decision
**Related:** ADR-002 source + bun distribution

---

## Context

ADR-001 proposed replacing OpenTUI with ratatui for the bundled renderer path. That migration was prototyped and rejected on UI/UX grounds. Sidebar-only ratatui was also rejected because the hybrid renderer cost is high and it does not solve the install-channel hang class.

ADR-002 addresses the highest-impact distribution failure by moving away from `bun build --compile` as the default user channel. That avoids the Bun compile x Worker bug class while preserving the current OpenTUI product experience.

This leaves AX Code with a clear steady state:

- OpenTUI is the product renderer.
- Bun is the JavaScript runtime.
- Source + bun distribution is the preferred shipped path.
- Compiled Bun binaries are a diagnostic/fallback path, not the product default.

The remaining risk is not migration risk; it is runtime hardening risk. The TUI must be made more observable, bounded, and recoverable in the OpenTUI + Bun path.

## Decision

AX Code will keep OpenTUI and Bun as the mainline TUI/runtime stack. Engineering investment shifts from renderer replacement to hardening the current stack.

The mainline hardening contract is:

1. **Bound every startup boundary.** Worker readiness, route import, bootstrap sync, provider discovery, session sync, and event stream connection must have explicit timeouts or retry ceilings.
2. **Make startup diagnosable.** Every startup phase must emit structured `DiagnosticLog` events with stable names and enough runtime context to classify failures.
3. **Keep OpenTUI production profile conservative.** Advanced terminal features remain opt-in until direct-TTY smoke coverage proves them stable.
4. **Treat source + bun as the primary distribution.** Build, install, and smoke checks should validate that path before compiled-binary diagnostics.
5. **Own dependency risk directly.** If OpenTUI or Bun integration bugs block product stability, patch locally or vendor/fork rather than waiting passively on upstream.
6. **Prefer explicit failure over apparent hangs.** When a boundary stalls, fail with a clear message and debug-log instructions instead of letting the terminal sit blank.

## Immediate Implementation Slice

This ADR starts with a low-risk OpenTUI/Bun hardening slice:

- Add a TUI worker readiness handshake after `new Worker(...)`.
- Fail the TUI startup with a specific timeout and `tui.workerHandshakeFailed` diagnostic event when the worker never reaches RPC readiness.
- Record `tui.workerTargetResolved`, `tui.workerReady`, and `tui.threadTransportSelected` to make startup gap analysis concrete.
- Extend guardrail tests so these diagnostics do not regress.

Follow-up slices should stay similarly narrow:

- Install-matrix smoke must prove the source + bun channel by version, not only by npm dist-tag.
- OpenTUI direct-TTY smoke should capture actual frame output, not just `--version` or `doctor`.
- Debug explain should continue moving away from stale `tui.native.*` assumptions and classify OpenTUI startup markers first.
- Source + bun publish must avoid npm name/version collisions with the compiled meta package before defaults can flip.

## Consequences

### Positive

- Avoids another UI rewrite and keeps product polish in the renderer users already accepted.
- Converts startup hangs into bounded failures with actionable diagnostics.
- Aligns distribution, diagnostics, and support around the same runtime path.
- Keeps future renderer experiments possible through contracts, but stops treating migration as the default answer.

### Negative

- AX Code remains dependent on OpenTUI and Bun behavior.
- Single-binary distribution is no longer the center of the product story.
- Hardening requires more runtime observability and platform smoke coverage.
- Advanced terminal features remain opt-in longer.

## Risks And Mitigations

- **OpenTUI regressions can still ship.**
  Mitigation: keep renderer profile guardrails, direct-TTY smoke, and local ownership of OpenTUI integration.
- **Bun runtime regressions can still affect users.**
  Mitigation: source + bun install matrix, version-pinned smoke, and runtimeMode telemetry.
- **Timeouts can mask slow but valid startup.**
  Mitigation: make timeout values configurable through environment variables, log the configured value, and tune from real debug bundles.
- **Old ratatui planning artifacts can confuse future work.**
  Mitigation: mark ADR-001 as superseded and keep ratatui PRDs as historical, not active, planning.

## Re-evaluation Triggers

Reopen this ADR if:

- OpenTUI becomes unmaintainable even with local patches.
- Bun source + runtime distribution fails the install matrix for a major platform for more than one release cycle.
- A renderer alternative demonstrates better UX and lower operational risk with direct-TTY evidence.
- Single-binary distribution becomes a product requirement again.

## Related

- ADR-001: ratatui bundled renderer plan, now superseded for the rendering decision.
- ADR-002: source + bun distribution.
- `packages/ax-code/src/cli/cmd/tui/thread.ts`
- `packages/ax-code/src/cli/cmd/tui/worker.ts`
- `packages/ax-code/src/cli/cmd/tui/util/startup-trace.ts`
- `packages/ax-code/test/cli/tui/render-anti-patterns.test.ts`
