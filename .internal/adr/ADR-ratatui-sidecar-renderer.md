# ADR: Use A Ratatui Sidecar Renderer Instead Of In-Process Replacement

Status: Proposed
Date: 2026-04-19

## Context

`ax-code` currently runs its TUI in the Bun process through Solid/OpenTUI. The repository also contains a Rust
terminal-core prototype, but it is not yet the runtime renderer.

The next migration step is not to remove OpenTUI immediately. The goal is to begin building a Rust `ratatui`
renderer now while keeping the working OpenTUI product path available.

The core architectural choice is where that renderer lives:

- inside the Bun process as a native addon
- as a separate sidecar process managed by the TypeScript CLI

## Decision

We will build the `ratatui` renderer as a subprocess sidecar with a versioned JSON protocol over stdio for the first
implementation phase.

## Rationale

### 1. TTY ownership is clearer in a sidecar

The renderer needs direct control over:

- raw mode
- alternate screen
- mouse mode
- render loop timing
- shutdown and terminal restoration

A separate process makes ownership explicit and easier to reason about during handoff.

### 2. Ratatui wants an app loop, not just helper functions

The existing Rust NAPI path is suitable for terminal primitives. It is not the right boundary for a full renderer
with event loop, layout tree, focus model, and frame paint lifecycle.

### 3. Sidecar preserves the existing TypeScript product core

TypeScript remains responsible for:

- session and tool orchestration
- API access
- worker lifecycle
- config and workspace management
- business rules

This avoids a premature rewrite of product logic in Rust.

### 4. Hybrid handoff is easier

The controller process can:

1. start the sidecar
2. receive a handoff intent
3. restore terminal state
4. start OpenTUI with preserved route/session context

That is safer than trying to switch renderers in-process with shared terminal state.

## Consequences

### Positive

- clearer renderer boundary
- safer terminal lifecycle
- simpler rollback story
- better observability via explicit protocol messages
- lower coupling to Bun/Solid/OpenTUI internals

### Negative

- more packaging work
- new protocol to design and maintain
- extra process lifecycle to supervise
- some duplicated local UI state between TypeScript and Rust until migration settles

## Rejected Alternatives

### Alternative A: In-process NAPI ratatui renderer

Rejected because:

- it blurs TTY ownership
- it ties the render loop to Bun/native addon integration details
- it increases failure blast radius inside the main CLI process

### Alternative B: Full Rust rewrite now

Rejected because:

- it is too much scope for the current state of the codebase
- it would force product logic migration before renderer parity is proven
- it removes the practical safety of OpenTUI fallback

### Alternative C: Keep OpenTUI only until a full native rewrite exists

Rejected because:

- it postpones native progress too long
- it does not create a real migration path
- it keeps renderer replacement as a future cliff instead of a series of controlled steps

## Implementation Notes

- Start with stdio JSON messages.
- Keep protocol versioned from the first commit.
- Model messages around view snapshots and user intents, not internal framework state.
- Treat `hybrid` as the default migration mode once the sidecar can hand off safely.

## Follow-Up

- Create the sidecar migration PRD and milestone plan.
- Add a renderer supervisor in the TUI runtime.
- Prototype first-frame paint and handoff before building full dialogs or prompt editing.
