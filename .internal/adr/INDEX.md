# Architecture Decision Records

This index tracks the local ADR set for `ax-code`. ADRs are historical decisions, so consolidation normally means
reclassifying an ADR as runtime-spine, standing foundation, absorbed, or deferred rather than deleting it.

**Maintenance rule:** When adding or updating an ADR, update its row here. Status must reflect the current implementation
state and its role in the roadmap.

**Last reviewed:** 2026-06-04
**Market alignment:** Opus 4.8 and Claude Code Dynamic Workflows make Workflow Runtime the current architecture spine.

## Runtime Spine ADRs

| ADR | Title | Status |
| --- | --- | --- |
| [ADR-026](ADR-026-opus48-market-response-boundary.md) | Organize the Opus 4.8 market response around Workflow Runtime, not vendor feature cloning | Proposed - umbrella market response boundary |
| [ADR-027](ADR-027-opencode-low-risk-feature-learning-boundary.md) | Learn low-risk OpenCode and OpenTUI patterns without copying high-risk runtime features | Accepted - supporting feature-learning boundary; OpenTUI, structured error, projection, and metadata foundations landed |
| [ADR-025](ADR-025-workflow-runtime-boundary.md) | Make Dynamic Workflow Runtime a bounded orchestration boundary | Proposed - P0 market alignment boundary |
| [ADR-028](ADR-028-task-queue-layering-boundary.md) | Separate interactive follow-up queueing from the durable task queue | Proposed - supporting interactive UX boundary; reduce-not-remove the queue |
| [ADR-006](ADR-006-v5-agent-control-plane.md) | Make Agent Control Plane the v5 autonomous architecture foundation | Partially implemented; now supplies policy and safety under Workflow Runtime |
| [ADR-005](ADR-005-subagent-orchestration.md) | Subagent orchestration via explicit dispatcher with parallel Task fan-out | Accepted; lower-level fan-out primitive absorbed under ADR-025 |
| [ADR-004](ADR-004-autonomous-mode-hardening.md) | Harden autonomous mode with confidence-aware escalation, blast-radius caps, and a critic pass | Accepted; required safety policy for long workflows |
| [ADR-012](ADR-012-autonomous-continuation-contracts.md) | Make autonomous continuation prompts and terminal semantics explicit contracts | Accepted; informs workflow continuation and compact synthesis |
| [ADR-013](ADR-013-qwen37-max-cloud-agent-backend.md) | Treat Qwen3.7-Max as a premium cloud-agent backend, not a Qwen-specific runtime architecture | Accepted; provider-neutral premium workflow policy now also applies to Opus 4.8 |
| [ADR-014](ADR-014-durable-session-goals.md) | Treat `/goal` as durable session state | Accepted; goals become workflow objectives and stop conditions |
| [ADR-016](ADR-016-agent-routing-architecture.md) | Agent routing is keyword-only; no LLM tier, intent gates, or delegation modes | Accepted; workflow planner/model policy owns multi-agent routing |
| [ADR-019](ADR-019-graph-first-agent-context-boundary.md) | Make Graph-First Agent Context a Product Boundary | Accepted; implementation shipped; now context substrate for workflows |
| [ADR-022](ADR-022-codex-like-desktop-app-from-openchamber-baseline.md) | Build a Codex-Like Desktop App from an OpenChamber Product Baseline | Accepted; staged implementation underway; workflow supervision is the next competitive surface |
| [ADR-023](ADR-023-remote-surface-security-gates.md) | Gate Remote Surfaces Behind Separate Security Reviews | Accepted; required before routine/webhook/remote workflow surfaces |
| [ADR-008](ADR-008-server-operation-mode-boundary.md) | Define Server Operation Mode Boundaries | Accepted; implementation pending; required for API and remote routines |

## Standing Foundation ADRs

| ADR | Title | Status |
| --- | --- | --- |
| [ADR-002](ADR-002-distribution-source-plus-bun.md) | Distribute source + Bun runtime instead of `bun build --compile` binary | Accepted |
| [ADR-003](ADR-003-opentui-bun-mainline-hardening.md) | Keep OpenTUI and Bun as the mainline runtime and harden them directly | Accepted |
| [ADR-007](ADR-007-headless-agent-runtime-boundary.md) | Establish a Headless Agent Runtime Boundary | Accepted |
| [ADR-009](ADR-009-package-organization-boundary-hardening.md) | Harden Package Organization Boundaries Before Splitting Packages | Accepted; implemented |
| [ADR-010](ADR-010-alibaba-thinking-shape-and-budget-clamping.md) | Alibaba Thinking Shape and Budget Clamping | Accepted |
| [ADR-011](ADR-011-tui-session-tool-renderer-boundary.md) | Make TUI Session Tool Rendering a Named Boundary | Accepted; initial extraction implemented |
| [ADR-015](ADR-015-session-prompt-module-boundary.md) | Extract pure logic from session/prompt.ts into focused prompt-* modules | Accepted; extraction in progress |
| [ADR-017](ADR-017-effect-framework-freeze.md) | Freeze Effect framework usage at v2.11.0 boundaries | Accepted; enforced by CI |
| [ADR-018](ADR-018-app-headless-sdk-boundary.md) | Promote Headless SDK as the Short-Term App Backend Boundary | Accepted; foundation implemented |
| [ADR-020](ADR-020-mcp-security-trust-boundary.md) | Make MCP Security a Trust-Boundary Contract | Accepted; implemented |
| [ADR-021](ADR-021-html-dev-browser-boundary.md) | Establish HTML Dev Browser Boundary via Playwright MCP and Behavioral Policy | Accepted; implemented |

## Deferred ADRs

| ADR | Title | Status |
| --- | --- | --- |
| [ADR-024](ADR-024-skill-evaluation-optimization-boundary.md) | Make Skill Evaluation and Optimization an Offline Boundary | Proposed; defer implementation behind Workflow Runtime traces |
