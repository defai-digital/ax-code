# PRD: Ratatui Sidecar Migration Plan

Status: Draft
Date: 2026-04-19
Owner: ax-code runtime

## Summary

`ax-code` should keep Solid/OpenTUI as the primary renderer in the short term, while a new Rust `ratatui`
renderer is developed as a sidecar process and promoted capability-by-capability.

This is not a big-bang replacement plan. It is a staged migration plan with three operating modes:

- `opentui`: current default renderer
- `hybrid`: native-first sidecar with explicit fallback and handoff to OpenTUI
- `native`: ratatui-only preview mode for parity and debugging work

The core idea is:

1. one TTY owner at a time
2. TypeScript keeps product logic, server access, and session orchestration
3. Rust/`ratatui` owns terminal rendering, input handling, and local widget state
4. unsupported capabilities hand off cleanly to OpenTUI until parity exists

## Why This PRD Exists

The existing native migration notes are useful, but they do not yet define:

- why `ratatui` should be a sidecar instead of an in-process addon
- the protocol boundary between TypeScript and Rust
- the exact order in which OpenTUI capabilities should be replaced
- the first few milestones required to start coding safely

This PRD fills that gap.

## Problem

Today the production TUI is still tightly coupled to Solid/OpenTUI:

- rendering starts through `@opentui/solid`
- many TUI components import OpenTUI renderables directly
- the Bun build and doctor flow are explicitly wired to OpenTUI
- the Rust terminal crate is a prototype, not an integrated renderer

That means a direct switch to `ratatui` would be a rewrite, not a backend swap.

## Goals

- Goal 1: Start building `ratatui` now without destabilizing the working OpenTUI product.
- Goal 2: Use a sidecar architecture so native rendering can evolve independently from Bun/Solid internals.
- Goal 3: Replace OpenTUI in a capability-by-capability sequence instead of a branch-based rewrite.
- Goal 4: Keep hybrid mode as the operational migration path.
- Goal 5: Make every migration step reversible through explicit renderer selection.

## Non-Goals

- Do not rewrite session, provider, tool, or transport logic in Rust.
- Do not remove OpenTUI this quarter.
- Do not run OpenTUI and ratatui as concurrent TTY owners.
- Do not attempt pixel-level mixed rendering in one terminal frame.
- Do not require feature parity before the first ratatui code lands.

## Product Principles

### P1. One TTY Owner

At any moment, exactly one renderer owns raw mode, alternate screen, mouse mode, and screen paint.

### P2. Sidecar, Not In-Process

The ratatui renderer should run as a separate executable process managed by the TypeScript CLI, not as a NAPI
renderer loaded into the Bun process.

### P3. TypeScript Remains the Product Brain

The existing TypeScript runtime remains the source of truth for:

- session orchestration
- SDK/API access
- MCP and tool execution
- config loading
- workspace/session selection
- permission policy

### P4. Rust Owns the Terminal Experience

The ratatui sidecar owns:

- raw input loop
- frame rendering
- layout
- scroll math
- prompt editing mechanics
- selection behavior
- local dialog state

### P5. Every Native Capability Must Remove Future Fallback Surface

Native work is only justified if it reduces dependence on OpenTUI. Hybrid mode is a bridge, not a permanent split.

## Target Architecture

### Renderer Modes

- `opentui`: current behavior
- `hybrid`: start the ratatui sidecar first; hand off to OpenTUI for unsupported routes or dialogs
- `native`: ratatui-only preview mode; no automatic OpenTUI fallback except explicit exit-to-OpenTUI flows

### Process Model

#### Controller Process

The existing `ax-code` TypeScript CLI process remains the controller. It already owns worker lifecycle, network setup,
and app boot.

Responsibilities:

- resolve renderer mode
- spawn and supervise the ratatui sidecar
- translate product state into sidecar messages
- handle sidecar intents
- trigger OpenTUI handoff when requested

#### Ratatui Sidecar

Create a new Rust binary crate, separate from the current NAPI terminal-core crate.

Responsibilities:

- enter/leave raw mode
- own alternate screen lifecycle
- parse input and maintain render loop
- render widgets with `ratatui`
- maintain local view state such as selection, scroll offset, focus index, and prompt cursor
- emit high-level intents instead of talking to the product backend directly

#### Protocol

Use a versioned JSON message protocol over stdio for the first phase. Keep it simple and observable.

Controller -> sidecar:

- `hello`
- `state.home`
- `state.session`
- `state.dialog`
- `state.toast`
- `state.theme`
- `state.status`
- `shutdown`

Sidecar -> controller:

- `ready`
- `intent.navigate`
- `intent.submitPrompt`
- `intent.openDialog`
- `intent.answerQuestion`
- `intent.approvePermission`
- `intent.rejectPermission`
- `intent.handoff`
- `intent.exit`
- `log`

## Data Boundary

The protocol should move view models, not raw internal stores or OpenTUI component state.

The first shared sidecar-facing models should be plain JSON snapshots for:

- home screen
- session header/footer
- transcript rows
- prompt/editor state
- dialog lists and selections
- permission/question prompts

This keeps migration aligned with renderer-neutral view-model extraction already happening in the TUI code.

## Migration Phases

### Phase 0: Preparation

Purpose: make the migration executable, not aspirational.

Deliverables:

- fresh ADR choosing sidecar over in-process replacement
- accurate inventory of current OpenTUI-only surfaces
- sidecar protocol v1 schema
- renderer mode matrix: `opentui`, `hybrid`, `native`

Exit criteria:

- every upcoming milestone has a protocol boundary and file owner
- no phase assumes nonexistent native code is already present

### Phase 1: Sidecar Bootstrap

Purpose: start a Rust `ratatui` process and paint a stable first frame.

Deliverables:

- new Rust binary crate, for example `crates/ax-code-tui-rs`
- new package shell or bundled binary wiring for the sidecar
- TypeScript controller that can spawn/stop the sidecar
- first frame with static layout and terminal lifecycle correctness

Scope:

- startup
- shutdown
- resize
- debug logging
- explicit exit

Not yet in scope:

- live session rendering
- prompt editing
- dialogs

Exit criteria:

- sidecar starts from `ax-code`
- first frame is visible and resize-safe
- sidecar can exit without leaving terminal state dirty

### Phase 2: Hybrid Handoff Foundation

Purpose: make `hybrid` real.

Deliverables:

- renderer flag supports `hybrid`
- structured handoff contract from sidecar -> controller -> OpenTUI
- route preservation for `home` and `session`
- explicit command to jump from ratatui to OpenTUI

Exit criteria:

- a user can start in sidecar mode and land in OpenTUI without losing session context
- TTY ownership transfers cleanly

### Phase 3: Home And Session Shell

Purpose: ratatui can replace the outer chrome first.

Deliverables:

- home screen
- workspace/session picker lists
- session header/footer
- sidebar equivalent or compact alternative

Exit criteria:

- user can browse recent sessions and enter a session from ratatui
- no OpenTUI handoff required for basic navigation

### Phase 4: Transcript Viewport

Purpose: native owns reading before it owns writing.

Deliverables:

- transcript row rendering from shared view models
- scroll position and jump navigation
- compaction markers
- revert notices
- tool summary blocks in collapsed form

Exit criteria:

- session transcript is stable under append, resize, and navigation
- long sessions are readable without OpenTUI

### Phase 5: Prompt And Composer

Purpose: native owns the highest-frequency interaction path.

Deliverables:

- prompt editor
- history
- summarized paste preview
- shell-prefix mode
- basic autocomplete shell
- submit, cancel, interrupt affordances

Exit criteria:

- a user can conduct normal prompt/response loops without OpenTUI
- paste, resize, and scroll preserve prompt state

### Phase 6: Dialogs And Modal Ownership

Purpose: replace the surfaces that currently force fallback.

Replacement order:

1. command palette
2. help
3. status
4. session list
5. provider/model selection
6. permissions/questions
7. activity/timeline dialogs

Exit criteria:

- sidecar owns focus correctly across modal flows
- most common dialog flows no longer require handoff

### Phase 7: Tool Renderers

Purpose: replace OpenTUI where rich transcript rendering matters most.

Replacement order:

1. bash streaming output
2. read/write/edit summaries
3. diff/code viewers
4. todo renderer
5. permission-rich and long-output tools

Exit criteria:

- tool output readability and scroll behavior are acceptable on real workloads
- OpenTUI handoff is reserved for genuinely unsupported edge cases

### Phase 8: Default Decision

Purpose: decide whether ratatui can move from preview to default.

Required before changing default:

- parity against the renderer contract
- explicit packaging signoff
- release telemetry and bug review
- OpenTUI fallback retained for at least one release cycle after default switch

## Step-By-Step Execution Plan

### Milestone A: Start Coding

This is the first implementation slice to build next, not today:

1. add a new Rust binary crate for the sidecar
2. define `protocol-v1` request/response/event types
3. add a TS sidecar supervisor under the TUI runtime
4. boot sidecar from a non-default hidden flag
5. render a static frame with version, route stub, and quit key

### Milestone B: Make Hybrid Real

1. add `hybrid` renderer selection
2. implement sidecar `intent.handoff`
3. preserve route + session ID during handoff
4. verify clean teardown and relaunch

### Milestone C: Replace Read-Only Session Flows

1. send session view-model snapshots to sidecar
2. render transcript, header, footer
3. support scroll and next/previous message navigation
4. keep prompt input handed off until native composer is ready

### Milestone D: Replace The Prompt Loop

1. implement prompt editor in ratatui
2. wire submit/interrupt/question/permission intents
3. keep dialog fallback for low-frequency flows

### Milestone E: Remove High-Frequency Fallbacks

1. replace command palette
2. replace session list
3. replace permissions/questions
4. replace tool summaries and viewers

## Packaging Plan

Short term:

- keep OpenTUI build unchanged
- bundle the sidecar as an additional native artifact
- sidecar remains opt-in and non-blocking when missing

Medium term:

- doctor should report sidecar presence separately from OpenTUI health
- release artifacts should include sidecar availability by platform

Long term:

- native default only after packaging determinism is acceptable on every supported target

## Risks

### Risk 1: Protocol churn blocks progress

Mitigation:

- keep protocol v1 small
- move view models, not raw stores
- add compatibility versioning from day one

### Risk 2: Hybrid becomes permanent complexity

Mitigation:

- every fallback is tracked as a named capability gap
- every native milestone must remove at least one fallback

### Risk 3: Sidecar duplicates product logic

Mitigation:

- Rust owns UI mechanics only
- TypeScript remains source of truth for product actions and state

### Risk 4: Packaging becomes harder before value appears

Mitigation:

- start with opt-in developer builds
- keep OpenTUI as default during early milestones

## Success Criteria

- Engineering can start ratatui development without destabilizing production OpenTUI.
- Hybrid mode is a real migration path, not a placeholder flag.
- The first ratatui milestones land behind non-default flags and are easy to rollback.
- Each completed phase removes a concrete piece of OpenTUI dependence.

## Decision

We will build `ratatui` as a sidecar renderer first, keep Solid/OpenTUI in production in the short term, and
replace OpenTUI capability-by-capability through `hybrid` mode until parity is proven.
