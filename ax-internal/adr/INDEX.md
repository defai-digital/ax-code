# Architecture Decision Records — Index

This index organizes the ADR set for `ax-code`. ADRs are kept as **multiple individual files** in
this directory; this file is the organizational index (status, role, and current implementation
state) for all of them.

**Maintenance rule:** When adding or updating an ADR, update its row here. Status must reflect the
current implementation state and its role in the roadmap.

**Last reviewed:** 2026-06-20
**Market alignment:** Opus 4.8 and Claude Code Dynamic Workflows make Workflow Runtime (ADR-025)
the current architecture spine.

Legend: **Prop** = proposed/undecided · **Acc** = accepted · **Part** = partially implemented ·
**Impl** = implemented · **Abs** = absorbed into another decision · **Def** = deferred

---

## Current Architecture Spine

Opus 4.8 and Claude Code Dynamic Workflows set a new market bar; the AX Code response (ADR-026) is
to make **Workflow Runtime** (ADR-025) the near-term architecture spine, competing on auditability
and repo-grounding. The Agent Control Plane (ADR-006) now supplies policy and safety **under**
Workflow Runtime rather than being the autonomous architecture itself. Everything else is either a
standing foundation that the spine relies on, a proposed decision feeding the spine, or operational
work running in parallel.

---

## Runtime Spine ADRs

| ADR | Title | Status |
| --- | --- | --- |
| [ADR-025](ADR-025-workflow-runtime-boundary.md) | Make Dynamic Workflow Runtime a bounded orchestration boundary | Prop — P0 market alignment boundary |
| [ADR-026](ADR-026-opus48-market-response-boundary.md) | Organize the Opus 4.8 market response around Workflow Runtime, not vendor feature cloning | Prop — umbrella market response boundary |
| [ADR-032](ADR-032-skill-workflow-competitive-hardening-boundary.md) | Close the Skill Trust and Dispatch Wiring Gaps in the Capability Layer | Prop — P0 integrity fixes (allowed-tools honesty/enforcement, dispatch tool wiring) plus listing budget, invocation control, nearest-wins precedence, template convergence, structured dispatch output |
| [ADR-033](ADR-033-agent-native-semantic-server-boundary.md) | Build an Agent-Native Semantic Server, Not a Replacement LSP | Prop — semantic router/server boundary that composes LSP, graph, file/static evidence, and optional local AI without replacing live LSP |
| [ADR-034](ADR-034-managed-ax-engine-local-provider-boundary.md) | Manage ax-engine as an Experimental Local Provider Runtime | Prop — managed built-in local provider boundary for Qwen3-Coder-Next MLX with macOS hardware gates, lifecycle status, and tool-call honesty |
| [ADR-035](ADR-035-lean-tui-desktop-dashboard-boundary.md) | Replace OpenTUI with a Lean Ratatui Terminal Client and Move Dashboards to Desktop | Prop — terminal becomes lean/session-first; desktop owns dashboards; Ratatui replaces OpenTUI as a thin client over headless runtime |
| [ADR-037](ADR-037-ax-code-desktop-monorepo-migration.md) | Migrate AX Code Desktop into the AX Code Monorepo while Preserving Separate CLI/TUI and Desktop Products | Prop — consolidate source and contracts while keeping CLI/TUI and Electron Desktop separately installable |
| [ADR-038](ADR-038-desktop-runtime-transport-optimization.md) | Optimize Desktop-Runtime Transport Without Collapsing the Process Boundary | Prop — faster local transport for Desktop after monorepo migration; preserve runtime authority boundary |
| [ADR-039](ADR-039-desktop-experience-first-value-and-agent-supervision-boundary.md) | Make Desktop First-Value and Parallel-Agent Supervision the Next Product Surface, Not an IDE Clone | Prop — surface starter actions, a first-class parallel-agent Runs board, capability discoverability, and header consolidation over existing contracts; no embedded editor |
| [ADR-041](ADR-041-desktop-visual-canvas-boundary.md) | Build a Native Desktop Visual Canvas Instead of Vendoring Cowart | Prop — AX-owned project canvas contract and Desktop panel inspired by Cowart workflows; no Cowart vendoring |
| [ADR-028](ADR-028-task-queue-layering-boundary.md) | Separate interactive follow-up queueing from the durable task queue | Prop — supporting interactive UX boundary; reduce-not-remove the queue |
| [ADR-006](ADR-006-v5-agent-control-plane.md) | Make Agent Control Plane the v5 autonomous architecture foundation | Part; now supplies policy and safety under Workflow Runtime |
| [ADR-004](ADR-004-autonomous-mode-hardening.md) | Harden autonomous mode with confidence-aware escalation, blast-radius caps, and a critic pass | Acc; required safety policy for long workflows |
| [ADR-012](ADR-012-autonomous-continuation-contracts.md) | Make autonomous continuation prompts and terminal semantics explicit contracts | Acc; informs workflow continuation and compact synthesis |
| [ADR-013](ADR-013-qwen37-max-cloud-agent-backend.md) | Treat Qwen3.7-Max as a premium cloud-agent backend, not a Qwen-specific runtime architecture | Acc; provider-neutral premium workflow policy now also applies to Opus 4.8 |
| [ADR-014](ADR-014-durable-session-goals.md) | Treat `/goal` as durable session state | Acc; goals become workflow objectives and stop conditions |
| [ADR-016](ADR-016-agent-routing-architecture.md) | Agent routing is keyword-only; no LLM tier, intent gates, or delegation modes | Acc; workflow planner/model policy owns multi-agent routing |
| [ADR-019](ADR-019-graph-first-agent-context-boundary.md) | Make Graph-First Agent Context a Product Boundary | Acc — Impl; now context substrate for workflows |
| [ADR-022](ADR-022-codex-like-desktop-app-from-openchamber-baseline.md) | Build a Codex-Like Desktop App from an OpenChamber Product Baseline | Acc; staged implementation underway; workflow supervision is the next competitive surface |
| [ADR-023](ADR-023-remote-surface-security-gates.md) | Gate Remote Surfaces Behind Separate Security Reviews | Acc; required before routine/webhook/remote workflow surfaces |
| [ADR-008](ADR-008-server-operation-mode-boundary.md) | Define Server Operation Mode Boundaries | Acc; implementation pending; required for API and remote routines |
| [ADR-029](ADR-029-agent-workflow-skill-productization-boundary.md) | Productize Skills, Commands, Agents, and Workflows as One Reusable Capability Layer | Acc — Impl; initial reusable capability layer implemented |
| [Long-Run Mode Consolidation](2026-06-15-autonomous-long-run-consolidation.md) | Consolidate 3-mode ladder (Manual→Autonomous→Super-Long) into 2-mode + capability registry | Prop — simplification boundary (dated) |

## Standing Foundation ADRs

| ADR | Title | Status |
| --- | --- | --- |
| [ADR-002](ADR-002-distribution-source-plus-bun.md) | Distribute source + Bun runtime instead of `bun build --compile` binary | Acc |
| [ADR-003](ADR-003-opentui-bun-mainline-hardening.md) | Keep OpenTUI and Bun as the mainline runtime and harden them directly | Acc — partially superseded by ADR-035 (future CLI direction) |
| [ADR-007](ADR-007-headless-agent-runtime-boundary.md) | Establish a Headless Agent Runtime Boundary | Acc |
| [ADR-009](ADR-009-package-organization-boundary-hardening.md) | Harden Package Organization Boundaries Before Splitting Packages | Acc — Impl |
| [ADR-010](ADR-010-alibaba-thinking-shape-and-budget-clamping.md) | Alibaba Thinking Shape and Budget Clamping | Acc |
| [ADR-011](ADR-011-tui-session-tool-renderer-boundary.md) | Make TUI Session Tool Rendering a Named Boundary | Acc — Impl; initial extraction implemented |
| [ADR-015](ADR-015-session-prompt-module-boundary.md) | Extract pure logic from session/prompt.ts into focused prompt-* modules | Acc; extraction in progress (`prompt.ts` 3,174 → 863, 2026-06-17) |
| [ADR-017](ADR-017-effect-framework-freeze.md) | Freeze Effect framework usage at v2.11.0 boundaries | Acc; enforced by CI |
| [ADR-018](ADR-018-app-headless-sdk-boundary.md) | Promote Headless SDK as the Short-Term App Backend Boundary | Acc — Impl; foundation implemented |
| [ADR-020](ADR-020-mcp-security-trust-boundary.md) | Make MCP Security a Trust-Boundary Contract | Acc — Impl |
| [ADR-021](ADR-021-html-dev-browser-boundary.md) | Establish HTML Dev Browser Boundary via Playwright MCP and Behavioral Policy | Acc — Impl |
| [ADR-027](ADR-027-opencode-low-risk-feature-learning-boundary.md) | Learn low-risk OpenCode and OpenTUI patterns without copying high-risk runtime features | Acc — supporting boundary; OpenTUI, structured error, projection, and metadata foundations landed |
| [ADR-030](ADR-030-foundation-boundary-hardening.md) | Treat `ax-internal` as Local-Only and Harden Runtime Boundaries Before More Feature Work | Prop — foundation hardening |
| [ADR-031](ADR-031-tui-visual-modernization-boundary.md) | Modernize TUI Visuals Through a Design-System Boundary on OpenTUI | Acc — Impl; initial Waves 1–3 slices implemented; snapshot gate active; ADR-035 limits future visual work to stable session interaction |

## Deferred ADRs

| ADR | Title | Status |
| --- | --- | --- |
| [ADR-024](ADR-024-skill-evaluation-optimization-boundary.md) | Make Skill Evaluation and Optimization an Offline Boundary | Prop — Def; defer implementation behind Workflow Runtime traces |

## Absorbed / Archived ADRs

These decisions are superseded or absorbed into a newer ADR. The original is preserved in
`ax-internal/archive/adr/` for history.

| ADR | Title | Disposition | Archived at |
| --- | --- | --- | --- |
| ADR-005 | Subagent orchestration via explicit dispatcher with parallel Task fan-out | Acc; lower-level fan-out primitive absorbed under ADR-025 (Workflow Runtime) | `archive/adr/ADR-005-subagent-orchestration.md` |
