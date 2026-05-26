# Product Requirement Documents

This index tracks the active PRD set for `ax-code`. Completed PRDs are removed from this index; historical versions are recoverable from git history (`git log --all -- .internal/prd/`). Strategy documents (product direction, not implementation trackers) are listed separately.

**Maintenance rule:** When editing any PRD, update its row here — Status, Phase, Last Reviewed. When the "Done When" condition is met, delete the file and remove the row.

**Last reviewed:** 2026-05-25

---

## Active PRDs

| PRD | Status | Phase | Last Reviewed | Done When |
| --- | --- | --- | --- | --- |
| [Stability Audit Remediation](PRD-2026-05-17-stability-audit-remediation.md) | Draft — remediation open | Findings open; no phase landed | 2026-05-25 | All C/H findings resolved or explicitly deferred with ADR coverage |
| [App Headless SDK Foundation](PRD-2026-05-25-app-headless-sdk-foundation.md) | Implemented | All phases complete | 2026-05-25 | External app can use documented public headless SDK without CLI text parsing |
| [Graph-First Agent Context](PRD-2026-05-26-graph-first-agent-context.md) | Implemented | All phases complete for context-pack scope | 2026-05-26 | Context composer, guidance, benchmark harness, and provenance-backed route/heuristic pilots shipped |
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
