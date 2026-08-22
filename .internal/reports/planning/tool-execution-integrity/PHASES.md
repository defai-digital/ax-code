# Tool Execution Integrity — Phased Delivery Plan

**Date:** 2026-08-21
**Status:** Completed

## Phase 0 — contain cross-instance state

- [x] Move Tool Registry cache/in-flight work into `Instance.state`.
- [x] Move MCP tool cache, promise, generation, subscription, and queue into `McpState`.
- [x] Add two-live-instance registry and MCP regression tests.
- [x] Scope transformed-schema caches and in-flight work by instance and schema identity.
- [x] Close established MCP clients before draining admitted connection work, then close late clients.
- Exit: no project-bound value can be returned from another instance or cleared by its disposal.

## Phase 1 — unify execution integrity

- [x] Extract the shared plugin/lifecycle invocation helper.
- [x] Build an enabled registry dispatcher from the direct-call tool set.
- [x] Route Batch through the dispatcher with fail-closed isolation.
- [x] Preserve dispatcher-produced attachment records and part IDs through Batch persistence.
- [x] Add lifecycle-hook parity to MCP without putting MCP in Batch.
- [x] Add disabled-tool, hook-order, capability-scope, and isolation regressions.
- Exit: all supported surfaces use the same evidence boundary and Batch cannot bypass visibility.

## Phase 2 — scoped effects and replay evidence

- [x] Return exact idempotent disposers from `ToolRegistry.register()`.
- [x] Add deterministic raw-prompt-free, privacy-minimized pre-adapter request manifests, including sanitized
      provider-specific options in the options fingerprint.
- [x] Add registration-layer, fingerprint, and local assembled-request tests.
- Exit: registrations clean up exactly and replay can verify final request identity without raw content.

## Phase 3 — verification and delivery

- [x] Run targeted tests and core typecheck (7 files, 111 tests in the final acceptance audit).
- [x] Run deterministic, script, and structure gates (845 files / 7,896 passed / 2 skipped; 113 script tests).
- [x] Re-run multi-model review over the implementation diff.
- [x] Commit only task-owned files and push the current branch.
- Exit: all relevant gates pass, review findings are resolved or documented, and the remote branch contains the
  reviewed commit.

## Phase 4 — PRD completion audit

- [x] Trace every functional requirement to production code and named regression tests.
- [x] Prove direct attachment mapping, lifecycle parity, and interactive isolation escalation.
- [x] Prove Batch final-visible exclusions, child permissions/hooks, and fail-closed isolation.
- [x] Prove MCP retains permission/plugin behavior while adding lifecycle hooks.
- [x] Prove manifest redaction, complete fallback, material-change sensitivity, and legacy replay compatibility.
- [x] Re-run the seven focused files, core typecheck, and full deterministic suite.
- Exit: the PRD may move from Active to Completed only after repository gates pass and the acceptance commit is
  present on the remote branch.

## Deferred follow-ups

- Optional encrypted/full provider-request capture under an explicit retention policy.
- Benchmark fingerprint CPU and memory cost for unusually large prompts and tool catalogs.
- Consider explicit cancellation/quiescence for in-flight MCP connection and discovery work beyond the current
  disposed-state and client-identity guards.
- Graduation criteria for the experimental browser agent.
- Stronger cancellation semantics when a permission rejection occurs after parallel Batch work has begun.
- Dynamic workflow composition that preserves AX Code journals, resume, nesting, and budget controls.
