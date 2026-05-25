# ADR-017: Freeze Effect framework usage at v2.11.0 boundaries

**Status:** Accepted; enforced by CI
**Date:** 2026-05-25 (decision made at v2.11.0; formally documented here)
**Deciders:** ax-code maintainers
**Related:** ADR-006 v5 Agent Control Plane (new session modules must use async/await)

---

## Context

`ax-code` adopted the [Effect](https://effect.website/) TypeScript library early for session processing. Effect's streaming, reactive subscriptions, and typed error channels were a good fit for the session loop and the file watcher. Over time, Effect spread into non-session modules — tools, providers, config, CLI commands — as contributors followed the existing pattern.

By v2.11.0, the costs were evident:

- **Contributor friction.** Developers unfamiliar with Effect's `Effect.gen`, `Layer`, and `ServiceMap` abstractions faced a steep learning curve before they could make simple tool or provider changes.
- **Scope creep.** Effect's model encourages wrapping everything in layers and services, making simple operations verbose.
- **Test complexity.** Effect-based modules require Effect runtime setup in tests. Plain `async/await` modules use `bun test` directly.
- **Interop overhead.** Each module boundary between Effect-based and plain code needed adapters, increasing coupling.
- **Build risk.** Effect version upgrades require careful review of breaking changes across every module that uses it.

At v2.11.0, new Effect usage was explicitly prohibited in non-session code. `script/check-no-effect-solid-in-v4.ts` enforces this at CI.

## Decision

Effect usage is **frozen at its v2.11.0 boundaries**:

| Zone | Effect allowed? | Reason |
|------|----------------|--------|
| `src/effect/` | Yes | Runtime infrastructure — Effect's reactive layer lives here |
| `src/session/` | Yes | Session loop uses Effect streaming and subscription lifecycle |
| `src/file/watcher.ts` | Yes | Subscription lifecycle requires Effect |
| All other modules | **No** | Use `async/await`, `Result<T, E>`, and Zod |

### Mandatory alternatives

| Instead of | Use |
|------------|-----|
| `Effect.gen` | `async/await` |
| Effect error channel | `Result<T, E>` or `.catch()` |
| `Schema.Class`, `Schema.Struct` | Zod (`z.object()`) |
| `Layer.effect`, `ServiceMap.Service` | Plain module with exported functions |
| `InstanceState.make`, `InstanceState.get` | Dependency injection via function parameters |

### The Effect-Zod bridge

`src/util/effect-zod.ts` converts Effect Schema ASTs to Zod schemas. This bridge is **permanent until all Effect Schema ID types are migrated to pure Zod.** Existing ID types (`SessionID`, `ToolID`, `MessageID`, etc.) use Effect Schema; do not rewrite them to Zod unless the owning module is being fully migrated from Effect. Do not extend the bridge to cover new types.

### When modifying session/ modules

New additions within existing Effect-based modules in `src/session/` may use Effect. However:

- Pure decision functions, formatters, and builders extracted from `session/` into `prompt-*.ts` helper modules must be plain `async/await` + Zod (see ADR-015).
- New domain modules created under `session/` for future v5 capabilities (e.g., `AgentPhase` state machine per ADR-006) should use `async/await` unless they directly participate in the Effect streaming loop.

## Why freeze rather than remove

Complete Effect removal from `src/session/` is not planned. The session loop uses Effect's streaming and reactive subscription capabilities. Replacing them would require a parallel implementation of stream fan-out, cancellation, and subscription lifecycle in plain TypeScript. The reliability risk of that rewrite is not justified by the benefit, given that session/ is already well-tested and the boundary is now enforced.

If Effect removal becomes necessary (e.g., if Effect's maintainer API changes break compatibility), it should be a separate ADR with a phased migration plan.

## Alternatives Considered

### Continue allowing Effect across the codebase

Rejected. The contributor friction and interop overhead were accumulating faster than the reactive benefits justified. Most of ax-code's domain logic is request/response, not streaming fan-out — Effect's strongest use case.

### Remove Effect from session/ now

Rejected. The session loop relies on Effect's streaming and reactive capabilities. A complete rewrite would be high-risk and high-effort with no clear user-visible benefit.

### Allow Effect in new modules with review approval

Rejected. "Allowed with review" creates inconsistency and review burden. A hard boundary (with CI enforcement) is simpler and more durable.

### Replace Effect with another reactive library (RxJS, Bacon.js)

Rejected. Introducing a second reactive library would not solve the contributor friction problem; it would add a second unfamiliar abstraction. The right long-term direction is plain TypeScript with explicit state machines.

## Consequences

### Positive

- New contributors can write tools, providers, CLI commands, and domain logic without learning Effect.
- Test setup for new modules is simple: `bun test` with no Effect runtime bootstrap.
- CI enforces the boundary: `script/check-no-effect-solid-in-v4.ts` fails the build if new Effect usage appears outside the allowed zones.
- The `src/session/` surface area is stable and does not grow with each new feature.

### Negative / Costs

- `src/session/` remains Effect-based, so anyone modifying the session loop still needs Effect knowledge.
- The Effect-Zod bridge is an ongoing maintenance cost until ID types are migrated.
- Some operations that Effect would express elegantly (stream fan-out, typed error channels) require more verbose plain TypeScript patterns in new code.

## CI Enforcement

`script/check-no-effect-solid-in-v4.ts` runs in CI and blocks merges that introduce Effect imports outside the allowed zones. If a false positive occurs, update the allow-list in that script — do not skip the check.
