# Architecture Decision Records

This index tracks the active ADR set for `ax-code`. Archived ADRs are retained under `.internal/archive/adr/` for historical context, but should not be treated as current implementation guidance.

## Active ADRs

| ADR | Title | Status |
| --- | --- | --- |
| [ADR-002](ADR-002-distribution-source-plus-bun.md) | Distribute source + Bun runtime instead of `bun build --compile` binary | Accepted |
| [ADR-003](ADR-003-opentui-bun-mainline-hardening.md) | Keep OpenTUI and Bun as the mainline runtime and harden them directly | Accepted |
| [ADR-004](ADR-004-autonomous-mode-hardening.md) | Harden autonomous mode with confidence-aware escalation, blast-radius caps, and a critic pass | Accepted |
| [ADR-005](ADR-005-subagent-orchestration.md) | Subagent orchestration via explicit dispatcher with parallel Task fan-out | Accepted; P0 partially shipped |
| [ADR-006](ADR-006-v5-agent-control-plane.md) | Make Agent Control Plane the v5 autonomous architecture foundation | Proposed |
| [ADR-007](ADR-007-headless-agent-runtime-boundary.md) | Establish a Headless Agent Runtime Boundary | Accepted |
| [ADR-008](ADR-008-server-operation-mode-boundary.md) | Define Server Operation Mode Boundaries | Proposed |
| [ADR-009](ADR-009-package-organization-boundary-hardening.md) | Harden Package Organization Boundaries Before Splitting Packages | Accepted; implemented |
| [ADR-010](ADR-010-alibaba-thinking-shape-and-budget-clamping.md) | Alibaba Thinking Shape and Budget Clamping | Accepted |
| [ADR-011](ADR-011-tui-session-tool-renderer-boundary.md) | Make TUI Session Tool Rendering a Named Boundary | Accepted; initial extraction implemented |

## Archived ADRs

| ADR | Title | Archive Reason |
| --- | --- | --- |
| [ADR-001](../archive/adr/ADR-001-ratatui-bundled-renderer-and-opentui-rollback-only.md) | Ship ratatui as Bundled Renderer and Keep OpenTUI as Rollback Only | Superseded by ADR-003; retained as historical UI/runtime context only. |
