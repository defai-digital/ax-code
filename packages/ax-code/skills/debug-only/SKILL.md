---
name: debug-only
description: Investigate and diagnose a bug or unexpected behaviour without modifying any files. Reports root cause, reproduction path, and affected scope.
argument-hint: <symptom, error message, or failing test>
---

Diagnose the issue described in $ARGUMENTS. **Do not modify any files.**

## Phase 1 - Reproduce

- Understand the symptom and identify the minimal path that triggers it.
- Locate the entry point (CLI command, API call, test, event) and confirm the failure is reproducible from that point.
- Capture the concrete failure signal before diagnosing: command/action, input, observed output/error, and expected behavior.
- If the symptom cannot be reproduced from available context, continue only as an investigation and label every suspected cause as unconfirmed.

## Bug Reality Gate

Classify the investigation before reporting a root cause:

- **Confirmed bug**: a command, test, user action, log, stack trace, or runtime probe demonstrates the failure, and the observed behavior violates a stated expectation.
- **Confirmed by existing failing test**: a targeted test already fails before any fix, and the failing assertion/output matches the reported symptom.
- **Unconfirmed hypothesis**: static reading, call-chain analysis, or intuition suggests a cause, but no observed failure signal proves it.
- **Not reproduced**: the attempted reproduction path does not fail. Report the attempted steps and the next evidence needed; do not present a root cause.

Do not treat a plausible code smell, a suspicious branch, or a `debug_analyze` call chain as proof by itself. Static analysis can support a hypothesis, but runtime evidence or a failing test is required before calling something a real bug.

## Phase 2 - Trace

- Follow the call chain from the entry point to the failure site.
- Read only the files necessary to trace the path - avoid reading unrelated code.
- Note every assumption the code makes that could be violated.

## Phase 3 - Root Cause

- Identify the exact file, line, and condition that causes the problem only after the Bug Reality Gate is satisfied.
- Provide evidence: quote the relevant code and connect it to the concrete reproduction signal.
- If the root cause is ambiguous, list candidates ranked by likelihood with supporting evidence for each.
- If the gate is not satisfied, do not write a **Root Cause** section as fact. Write **Unconfirmed Hypotheses** instead.

## Phase 4 - Report

Produce a structured report:

**Status**: `confirmed bug`, `confirmed by failing test`, `unconfirmed hypothesis`, or `not reproduced`.

**Evidence**: exact command/action/test/log used to establish the status, including the observed failure output when available.

**Root Cause**: one sentence, file:line reference. Include this only for `confirmed bug` or `confirmed by failing test`.

**Reproduction Path**: minimal steps from entry point to failure.

**Unconfirmed Hypotheses**: candidate causes with confidence and missing evidence. Include this instead of Root Cause when the bug is not confirmed.

**Affected Scope**: list of files and symbols implicated (not just the failure site - include callers if the bug propagates).

**Recommended Fix**: describe the fix without implementing it. If multiple approaches exist, state the trade-offs.

## Constraints

- Read-only: no edits, writes, shell mutations, or tool calls that modify state.
- Do not implement a fix; describe it in the report.
- Do not clean up unrelated code or add comments while investigating.
