---
name: incident-observability
description: Diagnose a production or staging incident from logs, metrics, traces, and recent deploys before writing a fix. Use when the user reports 5xx, latency, a failed job, or "it works locally."
agent: debug
argument-hint: <symptom, time window, service>
---

Investigate $ARGUMENTS as an incident, not as a speculative code review.

## Phase 1 - Scope

- Time window, service/component, and user-visible symptom.
- Recent deploys, migrations, or config changes in that window (git log, CI, release notes).
- What success looks like (error rate, latency, queue depth, a specific request).

## Phase 2 - Evidence

Collect, do not invent:

- Logs / traces / metrics the repo already knows how to query (dashboards in docs, existing scripts, MCP). If none are wired, say so and use local reproduction.
- One failing request or job id if available.
- Distinguish **symptom** (timeouts) from **candidate cause** (lock, bad deploy, dependency).

## Phase 3 - Hypotheses

- List 1–3 hypotheses with the evidence that would confirm or refute each.
- Prefer a reversible mitigation (rollback, feature flag, scale, disable a path) over a speculative patch when blast radius is high.

## Phase 4 - Fix only after confirmation

- If the user asked for a fix, follow `verified-change`: failing signal first, then the smallest change, then the same check.
- Do not "clean up" unrelated code during an incident.

## Phase 5 - Report

- Timeline, evidence, chosen hypothesis, mitigation vs fix, remaining unknowns, follow-up tests.

## Constraints

- Do not apply production mutations unless the user explicitly asked and the command is in-repo/runbook.
- Do not claim root cause from stack traces you did not observe.
