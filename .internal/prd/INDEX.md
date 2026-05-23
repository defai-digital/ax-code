# Product Requirement Documents

This index tracks the active PRD set for `ax-code`. Completed PRDs are retained under `.internal/archive/prd/` for historical context, but should not be treated as current execution plans.

## Active PRDs

| PRD | Status | Keep Active Because |
| --- | --- | --- |
| [Stability Audit Remediation](PRD-2026-05-17-stability-audit-remediation.md) | Draft; remediation open | Contains open critical/high stability findings and needs live re-verification before closure. |
| [Coding & Debugging Capability Hardening](PRD-2026-05-18-coding-debugging-capability-hardening.md) | Marked complete, needs re-verification | The document says complete, but live code still has comments and integration gaps around import-dependent impact analysis and debug pattern surfacing. Re-verify before archiving. |
| [Autonomous Continuation Contract Hardening](PRD-2026-05-23-autonomous-continuation-contract-hardening.md) | Complete - Phase 2 | Prompt builders and the empty-model-turn decision helper are extracted before any larger prompt-loop extraction. |
| [Qwen3.7-Max Agent Optimization](PRD-2026-05-23-qwen37-max-agent-optimization.md) | Phase 0 + Phase 1 + Phase 7 shipped in v5.5.0 | Phase 0 readiness classifier, Phase 1 task-route + profile helpers, Phase 7 Super-Long TUI button all implemented. Phases 2–6 remain open. |
| [Debug, Refactor, and QA Competitive Closeout](PRD-debug-refactor-qa-competitive-closeout.md) | Final draft | Strategic product-direction PRD, not a completed implementation tracker. |
| [Server Mode Hardening and Remote Operation Boundaries](PRD-server-mode-hardening.md) | Draft | Paired with ADR-008 and still represents open server/security hardening work. |
| [Source + Bun Distribution Rollout](PRD-source-bun-distribution.md) | In progress | Distribution/release work is actively changing; keep current until the release-channel decision gates close. |
| [TUI UX v1 Polish](PRD-tui-ux-v1-polish.md) | Drafted, needs closure review | Several items appear implemented, but the PRD has not been updated with validation evidence or a closure note. |
| [v5 Agent Control Plane](PRD-v5-agent-control-plane.md) | Draft | Control-plane scaffolding exists, but runtime enforcement is still partly shadow-mode. |

## Archived PRDs

| PRD | Archive Reason |
| --- | --- |
| [Package Organization Boundary Hardening](../archive/prd/PRD-2026-05-17-package-organization-boundary-hardening.md) | Completed; ADR-009 remains the active architectural guidance. |
| [Hotspot Boundary Hardening](../archive/prd/PRD-2026-05-18-hotspot-boundary-hardening.md) | Completed targeted hotspot boundary slices; future hotspot work should open narrower follow-up PRDs. |
| [Prompt Auto-Continuation Boundary Hardening](../archive/prd/PRD-2026-05-18-prompt-auto-continuation-boundary.md) | Completed focused prompt todo continuation extraction. |
| [Token Efficiency and Context Budgeting](../archive/prd/PRD-token-efficiency-and-context-budgeting.md) | Initial implementation phases closed; future tuning should be tracked separately. |
| [Debug Fix Closed Loop v1](../archive/prd/PRD-debug-fix-closed-loop-v1.md) | Implemented initial low-risk slice; follow-up opportunities should be scoped separately. |
| [Rust Bug-Fix Verification Capability](../archive/prd/PRD-rust-bugfix-verification-capability.md) | Implemented Cargo verification defaults and Rust structured failure parsing. |
| [v4.2.1 Autonomous Mode Follow-up](../archive/prd/PRD-v4.2.1-autonomous-followup.md) | Follow-up items landed through blast-radius and critic/replan-budget implementation. |
| [Debug Refactor QA Implementation Backlog](../archive/prd/PRD-debug-refactor-qa-implementation-backlog.md) | Historical backlog retained for context. |
| [Debug Refactor QA Phase 0 Contract](../archive/prd/PRD-debug-refactor-qa-phase-0-contract.md) | Historical phase contract retained for context. |
| [v4.2.0 Autonomous Hardening](../archive/prd/PRD-v4.2.0-autonomous-hardening.md) | Superseded by v4.2.1 follow-up and ADR-004/ADR-005. |
