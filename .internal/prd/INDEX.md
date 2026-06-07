# Product Requirement Documents

This index tracks the local planning set for `ax-code`. It intentionally separates market-priority work from supporting,
deferred, implemented, and strategy documents so old plans do not obscure the current product direction.

**Maintenance rule:** When editing any PRD, update its row here. Implemented PRDs should move to Archive Candidates until
they are deleted or moved to `.internal/archive/`.

**Last reviewed:** 2026-06-04
**Market alignment:** Opus 4.8 and Claude Code Dynamic Workflows make Workflow Runtime the near-term roadmap spine. See
[Planning Consolidation: Opus 4.8 and Dynamic Workflow Market Alignment](PLAN-2026-05-29-opus48-planning-consolidation.md).

---

## Market Priority PRDs

| PRD | Status | Phase | Last Reviewed | Done When |
| --- | --- | --- | --- | --- |
| [Opus 4.8 Market Response Program](PRD-2026-05-29-opus48-market-response.md) | Draft - umbrella P0 proposal | Program PRD, ADR, and implementation plan created | 2026-05-29 | Workflow Runtime MVP, supervision surfaces, routine trigger design, effort/model policy, and verified bug sweep evaluation are complete |
| [Workflow Runtime](PRD-2026-05-29-workflow-runtime.md) | Draft - P0 proposal | ADR, PRD, and implementation plan created; implementation not started | 2026-05-29 | Feature-flagged workflow runtime can run a verified bug sweep with durable phase/agent/budget/evidence state |
| [Codex-Like AX Code Desktop App](PRD-2026-05-28-codex-like-desktop-app.md) | Draft - implementation underway | Continue, but prioritize Workflow Runtime supervision surfaces over broad UI expansion | 2026-05-29 | First-party desktop app beta starts/attaches to local backend and supervises workflow, queue, review, approval, and evidence state |
| [v5 Agent Control Plane](PRD-v5-agent-control-plane.md) | In progress - supporting runtime policy | Shadow mode complete; runtime enforcement remains support work for Workflow Runtime | 2026-05-29 | ExecutionController governs workflow budgets, permissions, goals, stops, and completion gates at runtime parity |
| [Server Mode Hardening](PRD-server-mode-hardening.md) | Draft - supporting security work | Required before API/webhook routine surfaces move beyond local preview | 2026-05-29 | ADR-008 implementation phases 1-5 all landed and verified |
| [Remote Surface Security Gates](PRD-2026-05-28-remote-surface-security-gates.md) | Draft - gated follow-up | Keep remote hosts, tunnels, PWA network access, and VS Code embedded surfaces disabled until reviewed | 2026-05-29 | Each remote surface has accepted security review before implementation or remains disabled |

---

## Deferred Or Supporting PRDs

| PRD | Status | Why It Is Not P0 |
| --- | --- | --- |
| [Low-Risk OpenCode and OpenTUI Learning](PRD-2026-06-04-opencode-low-risk-feature-learning.md) | Draft - supporting product scope; OpenTUI, structured error, projection, and metadata foundations landed | Converts OpenCode release learnings and OpenTUI runtime guidance into app/API/review/TUI hardening while deferring high-risk runtime, provider, remote, autonomy, and snapshot dependency topics |
| [Task Queue Layering](PRD-2026-06-07-task-queue-layering.md) | Draft - proposal; root cause confirmed (ADR-028) | Interactive UX fix that reduces (not removes) the queue: keep durable `TaskQueue` for workflow/scheduled/automation/recovery, move interactive follow-ups to a lightweight ephemeral client queue aligned with ax-code-desktop and Codex CLI |
| [Skill Evaluation and Optimization](PRD-2026-05-29-skill-evaluation-optimization.md) | Draft - defer behind Workflow Runtime | Workflow traces and verification artifacts should become the eval substrate before skill optimization ships |
| [Stability Audit Remediation](PRD-2026-05-17-stability-audit-remediation.md) | Operational remediation open | Important engineering hygiene, but not the market catch-up spine |
| [Source + Bun Distribution Rollout](PRD-source-bun-distribution.md) | Operational release work | Release channel stability remains necessary but is not an Opus 4.8 feature response |

---

## Archive Candidates

These PRDs or implementation plans are implemented or absorbed. Keep them discoverable until a separate cleanup moves
them to `.internal/archive/` or removes them from the active tree.

| Document | Status | Consolidation |
| --- | --- | --- |
| [App Headless SDK Foundation](PRD-2026-05-25-app-headless-sdk-foundation.md) | Implemented | Foundation for app/workflow routes |
| [Graph-First Agent Context](PRD-2026-05-26-graph-first-agent-context.md) | Implemented | Future graph expansion belongs in Workflow Runtime context-packing phases |
| [MCP Security Layer Hardening](PRD-2026-05-26-mcp-security-layer-hardening.md) | Implemented | Standing trust boundary for workflow child agents |
| [HTML Dev Browser Integration](PRD-2026-05-26-html-dev-browser-integration.md) | Implemented | Browser verification becomes a workflow/template capability |
| [HTML Dev Browser Implementation Plan](PLAN-html-dev-browser-integration.md) | Implemented | Archive with the HTML Dev Browser PRD |

---

## Active Implementation Plans

| Plan | Status | Notes |
| --- | --- | --- |
| [Low-Risk OpenCode and OpenTUI Learning Implementation Plan](PLAN-2026-06-04-opencode-opentui-learning-implementation.md) | Draft - OpenTUI, structured error, projection, and metadata foundations complete; review models next | Phased execution plan for structured errors, event projection fixtures, metadata schemas, review view models, desktop diagnostics, and future OpenTUI upgrade gates |
| [Low-Risk OpenCode and OpenTUI Learning Tech Spec](TECH-SPEC-2026-06-04-opencode-low-risk-feature-learning.md) | Draft - OpenTUI, structured error, projection, and metadata foundations implemented | Technical sequencing for structured errors, event projection fixtures, session metadata schemas, review view models, desktop diagnostics, and OpenTUI upgrade validation |
| [Task Queue Layering Tech Spec](TECH-SPEC-2026-06-07-task-queue-layering.md) | Draft - design for ADR-028 | Ephemeral client-side interactive follow-up queue (Option A) + retain durable `TaskQueue` for orchestration; migration, test plan, open questions |
| [Workflow Runtime Implementation Plan](PLAN-2026-05-29-workflow-runtime-implementation.md) | Draft - P0 next | Main near-term implementation plan |
| [Opus 4.8 Market Response Implementation Plan](PLAN-2026-05-29-opus48-market-response-implementation.md) | Draft - umbrella plan | Program-level sequencing across workflow runtime, supervision, routines, effort policy, and evaluation |
| [Codex-Like Desktop App Implementation Plan](PLAN-2026-05-28-codex-like-desktop-app-implementation.md) | Draft - active implementation | Continue as app tracker, with Workflow Runtime supervision as the competitive priority |
| [Opus 4.8 Planning Consolidation](PLAN-2026-05-29-opus48-planning-consolidation.md) | Draft - local planning review | PRD/ADR disposition review and roadmap consolidation |

---

## Strategy Documents

| Document | Status | Last Reviewed | Summary |
| --- | --- | --- | --- |
| [Debug, Refactor, and QA Competitive Closeout](PRD-debug-refactor-qa-competitive-closeout.md) | Accepted direction | 2026-05-29 | Defines AX Code as both coding agent and assurance agent. New assurance implementation should flow through verified workflows and evidence gates. |

---
