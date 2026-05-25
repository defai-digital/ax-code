# Strategy: Debug, Refactor, and QA Competitive Closeout

> **Document type: Strategy / Product Direction** — This is not an implementation tracker. It defines product positioning and workflow direction. Implementation work for this direction is tracked in separate, scoped PRDs (`PRD-debug-refactor-qa-implementation-backlog.md` archived, `PRD-2026-05-18-coding-debugging-capability-hardening.md` archived). New implementation slices in this direction should open focused PRDs that reference this document.

**Date:** 2026-04-26
**Last reviewed:** 2026-05-25
**Status:** Accepted direction — implementation tracked separately
**Scope:** Internal
**Owner:** ax-code maintainers
**Related:** ADR-002 (distribution), ADR-003 (OpenTUI mainline), `.internal/archive/prd/PRD-debug-refactor-qa-implementation-backlog.md`, `.internal/archive/prd/PRD-2026-05-18-coding-debugging-capability-hardening.md`

---

## Executive Summary

AX Code now has two equally important product jobs:

1. a coding agent for users who want the system to build and change code directly
2. an assurance agent for users who use AX Code mainly for debugging, refactoring review, and QA

Current product investment is still skewed toward the first job. The second job already has promising internal primitives, but the user-facing workflow is not competitive enough yet. Competitors are winning because they package review, debugging, and verification into obvious, low-friction product loops.

This PRD defines the final implementation direction for closing that gap without overengineering:

- keep AX Code strong for coding
- make debug/refactor/QA a first-class product lane
- reuse existing primitives instead of building parallel systems
- focus the first implementation slice on three things:
  - PR review workflow
  - generalized verify-and-repair loop
  - runtime debug workflow

## Problem Statement

AX Code already has strong internal primitives:

- `debug_analyze` resolves stack traces into graph-backed call chains with confidence scores
- `refactor_plan` creates persisted multi-file refactor plans
- `refactor_apply` uses a shadow worktree and runs typecheck/lint/tests before touching the real worktree
- session risk and quality surfaces already expose review/debug/qa readiness signals

But users comparing AX Code against Cursor, Claude Code, Codex, Gemini CLI, and aider do not judge us on primitives. They judge us on workflow.

The current problem is not "AX Code cannot reason about debugging or refactoring." The problem is:

- review is not yet a first-class PR workflow
- debugging is still too static and not evidence-driven enough
- verification is too concentrated inside narrow flows like `refactor_apply`
- QA is present as internal logic, not yet a clear product lane

That gap matters more now because the user base is split:

- roughly half use AX Code primarily for coding
- roughly half use AX Code primarily for debugging, refactoring, and QA

If we do not treat the second group as a core product audience, competitors will continue to feel more complete even when AX Code already has some of the underlying engine pieces.

## Product Position

AX Code should be positioned internally as:

- a coding agent
- and a code assurance agent

The assurance lane means AX Code should help users:

- review changes before merge
- debug failures with evidence
- assess refactor risk before apply
- run verification and explain what broke
- make QA and release confidence more systematic

This lane is not secondary. It is half the product.

## Why Now

- ADR-003 keeps OpenTUI + Bun as the mainline runtime, so product work should move toward user-visible workflow value instead of renderer replacement.
- User feedback explicitly says competitors feel stronger in debugging, refactoring, and QA.
- The repo already has enough internal primitives to support a focused implementation slice.
- This is a high-value area where workflow improvements can land without large platform rewrites.

## Goals

- Make debug/refactor/QA a first-class product lane next to coding
- Close the highest-value competitive workflow gaps with low-to-medium risk implementation
- Reuse existing AX Code primitives wherever possible
- Improve user trust through evidence, verification, and clear findings
- Keep the implementation plan narrow enough for direct execution after review

## Non-Goals

- Replacing OpenTUI or Bun
- Building a cloud-only agent platform as a prerequisite
- Rewriting DRE, Code Intelligence, or quality systems from scratch
- Matching every competitor feature
- Turning AX Code into a generic CI platform
- Shipping broad background automation in the first implementation wave

## User Segments

### Segment A: Coding-first users

Primary outcomes:

- generate code
- edit code
- fix implementation issues quickly
- keep moving inside the local repo

What they need from this PRD:

- better automatic verification after edits
- refactor flows that are safer and more reviewable
- debug workflows that resolve stubborn bugs faster

### Segment B: Assurance-first users

Primary outcomes:

- review diffs and PRs
- debug incidents or regressions
- evaluate refactor safety before merge
- run QA and get confidence signals

What they need from this PRD:

- first-class review workflow
- evidence-driven debugging
- structured verification artifacts
- durable review and QA policy surfaces

## Product Thesis

The missing value is not "more scanners." The missing value is a tighter workflow loop:

- detect the right issue
- explain it with evidence
- verify the proposed fix
- reduce false positives
- work in the surfaces teams already use: local diff, PR, CI-adjacent workflows, and session artifacts

## Competitive Gaps To Close

### 1. PR review workflow

Competitors offer PR review that comments on diffs with severity, explanation, and fix guidance.

AX Code gap:

- no first-class PR review workflow built on current review/risk primitives
- no durable machine-readable review artifact for CI or GitHub consumers
- no product-default way to turn local review into PR review

### 2. Runtime debug workflow

Competitors increasingly ship debugging loops driven by runtime evidence, instrumentation, repro, and fix verification.

AX Code gap:

- `debug_analyze` is graph-strong but runtime-light
- no first-class workflow for instrumentation, evidence capture, hypothesis ranking, and verify-after-fix

### 3. Generalized verify-and-repair loop

Competitors make "edit -> run checks -> repair failures" feel automatic.

AX Code gap:

- strong verification exists inside `refactor_apply`, but not yet as a reusable product contract
- failed checks are not consistently turned into structured repair input

### 4. Review and QA policy surfaces

Competitors expose project-level review rules and hooks.

AX Code gap:

- no dedicated review-only contract like `REVIEW.md`
- no dedicated QA-only contract for required checks, migration safety, or release blockers
- no explicit workflow hook contract for review/debug/qa paths

## Prioritization

### Tier 1: Must ship first

1. PR review workflow
2. generalized verify-and-repair loop
3. runtime debug workflow

### Tier 2: Ship after Tier 1 proves useful

4. review and QA policy surfaces

### Deferred beyond this PRD's first implementation wave

- background QA automation
- specialized parallel review-agent fleet

These are still valuable, but they should not block the first implementation cycle.

For version planning purposes:

- they are future-direction items, not `v4.x.x` scope
- they may be reconsidered for `v5.0.0` planning after the `v4.x.x` assurance lane ships and proves adoption

## Scope For This Final PRD

This final PRD narrows implementation to four phases only:

1. product and contract alignment
2. PR review workflow
3. generalized verify-and-repair loop
4. runtime debug workflow

Review and QA policy surfaces remain in scope, but as a follow-on phase once the three core workflows exist.

Background automation and multi-agent review orchestration are explicitly deferred.

## Version Boundary

This PRD is the final scope for the `v4.x.x` assurance-lane expansion.

Included in `v4.x.x`:

- PR review workflow
- generalized verify-and-repair loop
- runtime debug workflow
- review and QA policy surfaces

Explicitly excluded from `v4.x.x`:

- always-on background QA automation
- specialized parallel review fleet
- full managed PR review service

Those excluded items belong to future planning and should be treated as `v5.0.0` candidates rather than backdoor additions to the current phase.

## Phase Plan

### Phase 0: Product and Contract Alignment

Goal: define a small, implementation-ready workflow contract.

Deliverables:

- define first-class workflow surfaces: `review`, `debug`, `qa`
- define one shared finding artifact schema
- define one shared verification result schema
- define where each workflow lives:
  - local CLI/TUI
  - server route / artifact export
  - future GitHub integration
- define which existing primitives are reused directly

Acceptance:

- one short contract section per workflow
- explicit in-scope / out-of-scope note for v1
- no new workflow duplicates existing DRE or quality primitives without reason

### Phase 1: PR Review Workflow

Goal: turn existing review/risk/quality primitives into a real review product surface.

Deliverables:

- `ax-code review pr` workflow with structured findings
- same workflow can also review local diff and branch diff
- machine-readable review artifact with:
  - severity
  - file
  - line or nearest anchor
  - rationale
  - evidence
  - suggested next action
- clear terminal rendering for human review

Acceptance:

- same codepath can review uncommitted diff, branch diff, or PR diff
- findings can be rendered as terminal output and exported as JSON
- the artifact is stable enough to support later GitHub/CI integration

### Phase 2: Generalized Verify-and-Repair Loop

Goal: make verification a shared product behavior instead of a refactor-only behavior.

Deliverables:

- reusable verification runner for typecheck, lint, and tests
- policy for "smallest relevant checks first, then escalate"
- structured failure envelope that can feed repair logic
- optional repair loop for clear, local failures

Acceptance:

- non-refactor edits can opt into the same verification contract as `refactor_apply`
- failure output is structured enough for follow-up repair without reparsing loose terminal text
- verification artifacts can be attached to review/debug/qa workflows

### Phase 3: Runtime Debug Workflow

Goal: make debugging evidence-driven rather than only graph-driven.

Deliverables:

- a debug workflow that can request or generate temporary instrumentation
- runtime-log capture bundle linked to the session
- hypothesis ranking that combines stack analysis with runtime evidence
- explicit verify-after-fix result

Acceptance:

- at least one path supports: describe bug -> capture evidence -> propose fix -> verify fix
- evidence is preserved as a session artifact
- unresolved verification leaves a clear unresolved state

### Phase 4: Review and QA Policy Surfaces

Goal: give teams a stable way to teach AX Code what to flag and what to verify.

Deliverables:

- `REVIEW.md`-style review policy
- `QA.md`-style verification policy
- scoped policy loading rules
- workflow hook design for review/debug/qa tasks

Acceptance:

- teams can require specific checks or finding classes without prompt repetition
- project-specific rules can narrow false positives

## Explicit Deferrals

The following items are intentionally deferred out of the first implementation wave:

- always-on background QA automation such as flaky-test triage and CI auto-followup
- specialized parallel reviewer fleet with verifier orchestration
- full managed PR review service
- organization-wide analytics and cost dashboards for review/debug workflows

These should be reconsidered only after the local-first workflows prove adoption and quality.

They are not part of `v4.x.x`. Treat them as future planning inputs for `v5.0.0`.

## Dependencies

- existing Code Intelligence graph and DRE analysis surfaces
- session quality/readiness artifact model
- current subagent framework
- current diagnostic log and session artifact infrastructure
- existing refactor shadow-worktree verification path

## Risks

### Risk 1: Overengineering the workflow layer

Mitigation:

- reuse existing finding, quality, and refactor primitives
- ship local-first workflow slices before adding service-like orchestration

### Risk 2: False positive review noise

Mitigation:

- keep Tier 1 focused on correctness and regression, not style commentary
- add evidence requirements before surfacing high-confidence findings

### Risk 3: Runtime debug mode becomes too invasive

Mitigation:

- start with explicit opt-in instrumentation
- make temporary changes auditable and reversible

### Risk 4: Verification loops become too expensive or noisy

Mitigation:

- start with nearest relevant checks first
- keep escalation explicit and observable

## Success Metrics

- assurance-first users can use AX Code for PR review, debugging, and verification without falling back immediately to another product
- coding-first users get safer post-edit verification without extra manual orchestration
- review findings are evidence-backed enough that users treat them as useful, not noisy
- debug flows can verify fixes, not just speculate about them
- teams can encode review and QA expectations in durable project files

## Recommended First Implementation Slice

If implementation starts after review, the recommended sequence is:

1. Phase 0 contract alignment
2. Phase 1 PR review workflow
3. Phase 2 generalized verify-and-repair loop
4. Phase 3 runtime debug workflow

Reason:

- PR review is the biggest visible competitive gap
- verify-and-repair helps both coding-first and assurance-first users
- runtime debug is high value, but becomes more useful once artifacts and verification are already standardized

## Final Recommendation

Treat this PRD as the implementation-ready product plan for AX Code's assurance lane.

Use the companion execution backlog in `.internal/archive/prd/PRD-debug-refactor-qa-implementation-backlog.md` to drive phase ownership, file boundaries, and go/no-go evidence.

Do not expand scope before the first slice lands. The right move is not to chase every competitor surface at once. The right move is to make AX Code obviously good at three core workflows:

- review the change
- verify the change
- debug the failure

In `v4.x.x`, stop there plus the review/QA policy follow-on.

Background QA automation, parallel review fleets, and managed review service should wait for `v5.0.0` planning.
