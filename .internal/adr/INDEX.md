# Architecture Decision Records

This index tracks the active ADR set for `ax-code`. Retired ADRs are removed from this index; historical versions are recoverable from git history.

**Maintenance rule:** When adding or updating an ADR, update its row here — Status must reflect the current implementation state, not the proposal date.

## Active ADRs

| ADR | Title | Status |
| --- | --- | --- |
| [ADR-002](ADR-002-distribution-source-plus-bun.md) | Distribute source + Bun runtime instead of `bun build --compile` binary | Accepted |
| [ADR-003](ADR-003-opentui-bun-mainline-hardening.md) | Keep OpenTUI and Bun as the mainline runtime and harden them directly | Accepted |
| [ADR-004](ADR-004-autonomous-mode-hardening.md) | Harden autonomous mode with confidence-aware escalation, blast-radius caps, and a critic pass | Accepted |
| [ADR-005](ADR-005-subagent-orchestration.md) | Subagent orchestration via explicit dispatcher with parallel Task fan-out | Accepted; P0 partially shipped |
| [ADR-006](ADR-006-v5-agent-control-plane.md) | Make Agent Control Plane the v5 autonomous architecture foundation | Partially implemented via child ADRs; core runtime contract Proposed |
| [ADR-007](ADR-007-headless-agent-runtime-boundary.md) | Establish a Headless Agent Runtime Boundary | Accepted |
| [ADR-008](ADR-008-server-operation-mode-boundary.md) | Define Server Operation Mode Boundaries | Accepted; implementation pending |
| [ADR-009](ADR-009-package-organization-boundary-hardening.md) | Harden Package Organization Boundaries Before Splitting Packages | Accepted; implemented |
| [ADR-010](ADR-010-alibaba-thinking-shape-and-budget-clamping.md) | Alibaba Thinking Shape and Budget Clamping | Accepted |
| [ADR-011](ADR-011-tui-session-tool-renderer-boundary.md) | Make TUI Session Tool Rendering a Named Boundary | Accepted; initial extraction implemented |
| [ADR-012](ADR-012-autonomous-continuation-contracts.md) | Make autonomous continuation prompts and terminal semantics explicit contracts | Accepted |
| [ADR-013](ADR-013-qwen37-max-cloud-agent-backend.md) | Treat Qwen3.7-Max as a premium cloud-agent backend, not a Qwen-specific runtime architecture | Accepted; all phases shipped in v5.5.0 |
| [ADR-014](ADR-014-durable-session-goals.md) | Treat `/goal` as durable session state | Accepted |
| [ADR-015](ADR-015-session-prompt-module-boundary.md) | Extract pure logic from session/prompt.ts into focused prompt-* modules | Accepted; extraction in progress |
| [ADR-016](ADR-016-agent-routing-architecture.md) | Agent routing is keyword-only; no LLM tier, intent gates, or delegation modes | Accepted |
| [ADR-017](ADR-017-effect-framework-freeze.md) | Freeze Effect framework usage at v2.11.0 boundaries | Accepted; enforced by CI |
| [ADR-018](ADR-018-app-headless-sdk-boundary.md) | Promote Headless SDK as the Short-Term App Backend Boundary | Accepted; foundation implemented |
| [ADR-019](ADR-019-graph-first-agent-context-boundary.md) | Make Graph-First Agent Context a Product Boundary | Accepted; implementation shipped |
| [ADR-020](ADR-020-mcp-security-trust-boundary.md) | Make MCP Security a Trust-Boundary Contract | Accepted; implemented |
| [ADR-021](ADR-021-html-dev-browser-boundary.md) | Establish HTML Dev Browser Boundary via Playwright MCP and Behavioral Policy | Accepted; implemented |
| [ADR-022](ADR-022-codex-like-desktop-app-from-openchamber-baseline.md) | Build a Codex-Like Desktop App from an OpenChamber Product Baseline | Accepted for staged implementation |
