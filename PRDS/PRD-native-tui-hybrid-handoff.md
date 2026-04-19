# PRD: Native TUI Hybrid Handoff

Status: Active
Date: 2026-04-19

## Summary

`ax-code` already has a meaningful native TUI preview slice, but it is still operationally isolated from the full OpenTUI product surface. That makes the migration binary:

- stay on OpenTUI and remain blocked by renderer bugs
- switch to native preview and lose broader dialogs / product flows

This PRD defines the missing middle path: **native-first, single-terminal-owner hybrid handoff**.

The goal is not pixel-level mixed rendering. The goal is to let native own the flows it already handles well, and hand off unsupported flows to OpenTUI without losing session context.

## Problem

Today the renderer choice is effectively a hard switch:

- `opentui`: full UI, larger surface, more framework coupling
- `native`: preview slice, better terminal ownership, incomplete product surface

That creates three problems:

1. native improvements do not compound into a product migration path
2. unsupported native flows become dead ends instead of controlled handoffs
3. the repo lacks a stable rollout contract for progressive replacement

## Product Goals

1. Keep **one renderer owning the TTY at a time**.
2. Make native improvements compound toward replacement instead of forking the product surface.
3. Preserve session/home context when switching from native to OpenTUI.
4. Make unsupported dialog-style flows explicitly hand off instead of silently failing or being misrouted as prompts.
5. Keep OpenTUI as the fallback shell until native owns the remaining critical surfaces.

## Non-Goals

- No pixel-level concurrent rendering.
- No dual raw-mode ownership.
- No big-bang rewrite of all OpenTUI surfaces.
- No forced migration of every slash command in this phase.
- No removal of OpenTUI in this phase.

## User Outcomes

### Outcome A: Native-first usage without dead ends

A user can start in native mode, browse recent sessions, resume a session, submit prompts, and answer permission/question requests without touching OpenTUI.

### Outcome B: Explicit bridge to full UI

When the user reaches a flow that native does not yet own, they can hand off directly to OpenTUI while keeping the current route.

### Outcome C: Safer migration

Engineering can migrate capability-by-capability while preserving a working product path at every step.

## Requirements

### R1. Renderer Modes

The product must support three explicit renderer values:

- `opentui`
- `native`
- `hybrid`

`opentui` remains the default full UI.

`native` and `hybrid` both load the native terminal path. `hybrid` is the preferred rollout mode for progressive replacement.

### R2. Structured Native Exit Contract

The native slice must return a structured result:

- `exit`
- `handoff -> opentui`

This replaces the previous `void` contract and makes renderer transitions explicit and testable.

### R3. Route-Preserving Handoff

When native hands off to OpenTUI, the following must be preserved:

- current route kind: home or session
- current session ID when active

OpenTUI must boot directly into the requested route instead of starting from a fresh home screen.

### R4. Explicit Dialog Handoff

Native must support explicit handoff commands for unsupported dialog-style surfaces. Initial scope:

- `/opentui`
- `/models`
- `/providers`
- `/sessions` from an active session
- `/workspaces`
- `/agents`
- `/mcp`
- `/status`
- `/theme`
- `/help`

### R5. Single TTY Owner

The system must never run native and OpenTUI as concurrent terminal owners. A handoff means:

1. native exits cleanly
2. terminal modes are restored
3. OpenTUI starts afterward

### R6. Rollout Transparency

Doctor output and native rollout messaging must explicitly distinguish:

- preview native path
- hybrid native-first path with OpenTUI handoff
- OpenTUI full UI path

## Delivery In This Phase

This change delivers the foundation:

1. `hybrid` becomes a first-class renderer selection.
2. Native returns a structured `exit | handoff` result.
3. OpenTUI can start from a handoff route and open a requested startup dialog.
4. Native local commands can hand off unsupported flows into OpenTUI.
5. Doctor / rollout text reflect the native-first + fallback model.

## Rollout Plan

### Phase 1: Foundation

Delivered now:

- route-preserving native -> OpenTUI handoff
- startup dialog handoff
- explicit native bridge commands
- `hybrid` renderer naming and diagnostics

### Phase 2: Native Owns More Pre-Session Product Flows

Next targets:

- richer home/session switching
- more startup configuration flows
- better native guidance and discoverability

### Phase 3: Capability-Based Tool Renderer Migration

Migrate the highest-frequency tool renderers first:

- bash / streaming output
- read / write / edit / diff

OpenTUI remains the fallback for unsupported renderers.

### Phase 4: Remove OpenTUI From Critical Path

Only after native owns the majority of product-critical flows:

- session view parity
- tool renderer parity
- dialog parity
- acceptable stability on real workloads

## Success Criteria

1. Users can run native-first without getting stuck on unsupported dialogs.
2. Session context survives native -> OpenTUI transitions.
3. Native rollout remains reversible via renderer selection.
4. The migration path is capability-based instead of branch-based.

## Risks

### Risk 1: Handoff feels like a hidden crash

Mitigation:

- explicit native rollout messaging
- explicit command-driven handoff paths
- route preservation

### Risk 2: Hybrid mode becomes an accidental dumping ground

Mitigation:

- every new handoff must map to a named capability gap
- new native ownership should remove handoffs rather than add parallel codepaths indefinitely

### Risk 3: Terminal lifecycle bugs during transitions

Mitigation:

- structured exit contract
- single-owner rule
- targeted tests around handoff result and startup boot path

## Decision

We will pursue **progressive native replacement through flow-level handoff**, not concurrent rendering.

That is the lowest-risk path that improves native ownership immediately while keeping the product usable during migration.
