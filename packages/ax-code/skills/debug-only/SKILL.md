---
name: debug-only
description: Investigate and diagnose a bug or unexpected behaviour without modifying any files. Reports root cause, reproduction path, and affected scope.
argument-hint: <symptom, error message, or failing test>
---

Diagnose the issue described in $ARGUMENTS. **Do not modify any files.**

## Phase 1 - Reproduce

- Understand the symptom and identify the minimal path that triggers it.
- Locate the entry point (CLI command, API call, test, event) and confirm the failure is reproducible from that point.

## Phase 2 - Trace

- Follow the call chain from the entry point to the failure site.
- Read only the files necessary to trace the path - avoid reading unrelated code.
- Note every assumption the code makes that could be violated.

## Phase 3 - Root Cause

- Identify the exact file, line, and condition that causes the problem.
- Provide evidence: quote the relevant code and explain why it fails under the reproduction path.
- If the root cause is ambiguous, list candidates ranked by likelihood with supporting evidence for each.

## Phase 4 - Report

Produce a structured report:

**Root Cause**: one sentence, file:line reference.

**Reproduction Path**: minimal steps from entry point to failure.

**Affected Scope**: list of files and symbols implicated (not just the failure site - include callers if the bug propagates).

**Recommended Fix**: describe the fix without implementing it. If multiple approaches exist, state the trade-offs.

## Constraints

- Read-only: no edits, writes, shell mutations, or tool calls that modify state.
- Do not implement a fix; describe it in the report.
- Do not clean up unrelated code or add comments while investigating.
