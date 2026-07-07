# ADR-048: Desktop-First Agent Experience For OpenCode-Derived Learnings

Date: 2026-07-07
Status: Proposed

## Context

OpenCode's recent changes show strong demand for:

- Reliable multi-session and multi-workspace UI state.
- MCP resources as visible context, not only hidden tool calls.
- Session snapshots, revert, and move flows that users can understand.
- Runtime API/SDK parity for Desktop and integration surfaces.
- Optional confined orchestration over MCP tools.

AX Code has a different product direction: Desktop should become the primary user experience. The TUI remains important as a fallback, attach/run surface, and compatibility layer, but it should not receive new product-level UX investment by default.

AX Code already has relevant runtime primitives:

- Session state and event streams.
- Worktrees and project instance scoping.
- Snapshots, rollback, and replay.
- MCP discovery, auth, trust, and tool conversion.
- Permission and isolation enforcement.
- Desktop, web server, SDK, and generated V2 APIs.

The main decision is how to apply OpenCode's product signals without increasing TUI scope or duplicating runtime systems.

## Decision

AX Code will adopt a Desktop-first roadmap for these learnings:

1. Improve Desktop session reliability and tab lifecycle before adding new agent capabilities.
2. Build MCP resource/context UX in Desktop, backed by explicit server/SDK contracts.
3. Productize existing rollback, replay, snapshot, and worktree primitives through Desktop review/move flows.
4. Treat confined MCP code mode as a separate, feature-flagged research track that must use existing permission, isolation, and replay/audit paths.
5. Keep TUI scope to maintenance, compatibility, crash fixes, and basic attach/run workflows.

## Consequences

### Positive

- Product effort aligns with the desired Desktop adoption path.
- Existing runtime strengths become more visible and valuable.
- Users get safer multi-session workflows without needing terminal-specific shortcuts.
- MCP becomes understandable and governable through Desktop UI.
- API/SDK parity improves because Desktop work must not rely on private runtime internals.

### Negative

- TUI users will not receive feature parity for new Desktop flows.
- Desktop state-management complexity increases.
- MCP resource UX requires careful pagination, truncation, timeout, and permission handling.
- Confined code mode will take longer because it must pass safety and auditability gates.

## Alternatives Considered

### Continue Improving TUI And Desktop Equally

Rejected. It splits product attention and conflicts with the goal of moving users toward Desktop.

### Copy OpenCode Features Directly

Rejected. OpenCode's changes are useful signals, but AX Code has different architecture and explicit constraints, including no monetary pricing/spend surfaces and a richer isolation model.

### Build New Runtime Systems For Rollback/Move

Rejected. AX Code already has snapshots, rollback, replay, worktrees, and session metadata. The higher-value work is UX and contract polish.

### Skip MCP Resource UX And Keep MCP As Tools Only

Rejected. MCP resource visibility is a high-value Desktop opportunity and helps users reason about external context and permissions.

## Guardrails

- No monetary pricing/spend tracking or display.
- No arbitrary filesystem, network, process, or shell access through code mode.
- No MCP context bypass around isolation or permissions.
- No new Desktop-only private runtime path when a public server/SDK contract is appropriate.
- No broad TUI feature expansion.

## Implementation Direction

- P0: Desktop session reliability and tab lifecycle.
- P1: Desktop MCP context browser and composer references.
- P2: Desktop rollback and session move UX over existing primitives.
- P3: Confined MCP code mode ADR/prototype behind a feature flag.
- P4: API/SDK parity for Desktop workflows.

## Review Triggers

Revisit this ADR if:

- Desktop adoption is no longer the product direction.
- TUI becomes a strategic user-facing product again.
- MCP resource access exposes new permission or isolation risks.
- Code mode cannot be made auditable through existing replay/audit paths.
