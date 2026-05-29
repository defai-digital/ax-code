# Product Requirement Documents

This index tracks the active PRD set for `ax-code`. Completed PRDs are removed from this index; historical versions are recoverable from git history (`git log --all -- .internal/prd/`). Strategy documents (product direction, not implementation trackers) are listed separately.

**Maintenance rule:** When editing any PRD, update its row here — Status, Phase, Last Reviewed. When the "Done When" condition is met, delete the file and remove the row.

**Last reviewed:** 2026-05-29

---

## Active PRDs

| PRD | Status | Phase | Last Reviewed | Done When |
| --- | --- | --- | --- | --- |
| [Stability Audit Remediation](PRD-2026-05-17-stability-audit-remediation.md) | Draft — remediation open | Findings open; no phase landed | 2026-05-25 | All C/H findings resolved or explicitly deferred with ADR coverage |
| [App Headless SDK Foundation](PRD-2026-05-25-app-headless-sdk-foundation.md) | Implemented | All phases complete | 2026-05-25 | External app can use documented public headless SDK without CLI text parsing |
| [Graph-First Agent Context](PRD-2026-05-26-graph-first-agent-context.md) | Implemented | All phases complete for context-pack scope | 2026-05-26 | Context composer, guidance, benchmark harness, and provenance-backed route/heuristic pilots shipped |
| [MCP Security Layer Hardening](PRD-2026-05-26-mcp-security-layer-hardening.md) | Implemented | Phases 0–7 implemented | 2026-05-26 | MCP trust gate, route hardening, argument-aware permissions, prompt/resource safety, and focused tests shipped |
| [HTML Dev Browser Integration](PRD-2026-05-26-html-dev-browser-integration.md) | Implemented | Phases 0–3 complete | 2026-05-26 | Bash intercept, Playwright MCP discovery, CDP attach, and TUI screenshot rendering shipped and tested |
| [Codex-Like AX Code Desktop App](PRD-2026-05-28-codex-like-desktop-app.md) | Draft — implementation underway | Phase 3/4 foundation plus Phase 5/6 executable queue, queue reorder, and blocker reactivation, Phase 7 evidence/rollback/compare/comment actions, Phase 8 worktree/tool panes, path reveal, multi-run grouping/conflict comparison, Phase 10 long-session/accessibility/performance-smoke/packaged-artifact/mac-bundle/app-diagnostics/release-diagnostics/window-recovery/browser-smoke slices, Phase 11 settings diagnostics, and Phase 12 scheduled automation scheduler/notification/shutdown slices in progress | 2026-05-29 | First-party desktop app beta starts/attaches to local backend, shows command-center UI, supports supervised queue/review workflows |
| [Remote Surface Security Gates](PRD-2026-05-28-remote-surface-security-gates.md) | Draft — gated follow-up | RSG-1 remote host, RSG-2 tunnel, RSG-3 PWA/network, and RSG-4 VS Code gates defined; implementation disabled by ADR-023 | 2026-05-28 | Each remote surface has accepted security review before implementation or remains disabled |
| [Skill Evaluation and Optimization](PRD-2026-05-29-skill-evaluation-optimization.md) | Draft — proposal | Phase 0 contract alignment pending | 2026-05-29 | Offline skill eval/optimization runner ships with verifier-gated candidate artifacts and human promotion path |
| [Server Mode Hardening](PRD-server-mode-hardening.md) | Draft — policy decided, implementation pending | Phase 0 (docs/boundary) not started | 2026-05-25 | ADR-008 implementation phases 1–5 all landed and verified |
| [Source + Bun Distribution Rollout](PRD-source-bun-distribution.md) | In progress | Phases 0–2 complete; Phase 3 gate pending | 2026-05-25 | Phase 3 default flip executed AND Phase 4 compiled binary retired |
| [v5 Agent Control Plane](PRD-v5-agent-control-plane.md) | In progress — shadow mode complete | Phases 0–6 shadow; Phase 7 deferred | 2026-05-25 | ExecutionController wired into processor.ts; all phases at runtime enforcement parity |

---

## Strategy Documents

> These define product direction and positioning, not implementation steps. New implementation work in these directions should open focused PRDs that reference these documents.

| Document | Status | Last Reviewed | Summary |
| --- | --- | --- | --- |
| [Debug, Refactor, and QA Competitive Closeout](PRD-debug-refactor-qa-competitive-closeout.md) | Accepted direction | 2026-05-25 | Defines ax-code as both coding agent and assurance agent. Implementation tracked in archived PRDs; new slices should open focused PRDs referencing this. |

---
