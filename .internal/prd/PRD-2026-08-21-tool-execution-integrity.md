# PRD: Tool Execution Integrity and Request Provenance

**Status:** Completed
**Date:** 2026-08-21
**Completion audit:** 2026-08-22
**Owner:** AX Code runtime
**Related:** ADR-060, SPEC-2026-08-21-tool-execution-integrity

## Summary

AX Code must execute the same project-scoped tools with the same policy and evidence regardless of whether a call
originates from the model, Batch, or MCP. A multi-project server must never reuse another project's initialized tool
or MCP state. Replay evidence must identify AX Code's final pre-adapter assembly without storing raw sensitive
content or claiming exact provider-wire reconstruction.

## Problem

Four gaps weaken an otherwise mature runtime:

1. Tool Registry and MCP discovery caches contain module-global state even though AX Code supports multiple
   `Instance`s in one process.
2. Batch invokes registry implementations directly and bypasses the canonical visibility and lifecycle boundary.
3. MCP invocation omits the general Pre/PostToolUse lifecycle events.
4. `llm.request` evidence is emitted before final request assembly and contains too little information to verify what
   AX Code assembled immediately before handing the request to the AI SDK adapter.

The review of `.internal/reference/deepseek-harness`, confirmed independently by DeepSeek V4 Pro, Qwen 3.8 Max,
Grok 4.6, and Codex CLI Sol Max, identified these as higher-value than adopting a new plugin container or session
format.

## Goals

- Isolate initialized registry tools, MCP discoveries, in-flight promises, subscriptions, and queues by `Instance`.
- Make the enabled tool set the only set callable by Batch.
- Apply plugin and lifecycle hooks consistently to direct, Batch, and MCP execution.
- Preserve interactive isolation escalation for direct calls and fail closed in Batch.
- Return an exact, idempotent disposer from runtime tool registration.
- Emit deterministic, raw-prompt-free and privacy-minimized evidence for the final pre-adapter request assembly.
- Add regression tests that reproduce the cross-instance and alternate-surface failures.

## Non-goals

- A universal everything-is-plugin architecture.
- New workflow, scheduling, memory, replay, or session formats.
- MCP tools in Batch.
- Interactive `isolation_escalation` retry prompts from parallel Batch workers; existing tool-specific permission
  checks remain in force.
- Raw prompt or provider-header persistence by default.
- Changing the browser agent's experimental status.

## User stories

- As a server user hosting two projects, I never receive a tool initialized for the other project.
- As an administrator, disabling a tool prevents both direct and Batch invocation.
- As a hook author, I observe the same before/after lifecycle around direct, Batch, and MCP calls.
- As a reviewer, I can correlate a replay step with deterministic evidence without persisting its raw contents.
- As an extension author, I can unregister exactly the tool registration that I own.

## Functional requirements

### FR-1: instance-scoped caches

- Registry and MCP caches MUST live in the current `Instance.state`.
- Cache hits MUST never occur before the current instance is resolved.
- In-flight discovery/init work and subscriptions MUST be instance-owned.
- Disposing one instance MUST NOT clear or unsubscribe another instance's state.

### FR-2: canonical invocation

- The runtime MUST expose one internal invocation boundary for enabled registry tools.
- Direct calls MUST retain plugin hooks, Pre/PostToolUse hooks, permissions, attachments, and isolation escalation.
- Batch MUST receive only enabled non-MCP tools and MUST use fail-closed isolation.
- Batch MUST preserve the dispatcher-produced attachment records, including their existing part identities.
- MCP MUST remain outside Batch and MUST emit the general lifecycle hooks around its existing permission boundary.

### FR-3: scoped registration

- `ToolRegistry.register()` MUST return an idempotent disposer.
- Overlapping registrations for the same tool ID MUST follow last-registration-wins behavior.
- Disposing an older registration MUST NOT remove a newer registration.
- Disposing the newer registration MUST reveal the previous active registration, if any.

### FR-4: request manifest

- Evidence MUST be produced after AX Code finalizes system messages, tools, and model options at its AI-SDK
  pre-adapter boundary. It does not attest to later adapter transformations, headers, or exact provider-wire bytes.
- It MUST include a schema version, provider/model identity, message/tool counts, ordered active tool names, relevant
  normalized options, and deterministic fingerprints. The options fingerprint MUST cover the sanitized
  provider-specific options passed to the AI SDK as well as the selected common options.
- It MUST NOT include raw prompt content, credentials, headers, or tool arguments.
- Identical assembled inputs MUST produce identical fingerprints; material changes MUST change them.
- Fingerprints MUST be treated as pseudonymous replay data: unsalted SHA-256 leaks equality and low-entropy values may
  be dictionary-guessed, so normal replay access and retention controls still apply.
- If a model-visible schema cannot be materialized within the bound, the runtime MUST emit a non-sensitive
  `manifest_unavailable` marker and continue the otherwise valid model request; it MUST NOT emit a complete-looking
  partial manifest.

## Success criteria

- Two-instance registry and MCP regression tests fail on the previous implementation and pass after the change.
- Batch cannot call a disabled registry tool and emits both plugin and lifecycle hooks for permitted calls.
- Batch does not initiate an interactive isolation escalation.
- MCP calls emit lifecycle hooks while retaining existing permission and plugin behavior.
- Registration disposal passes stacked and out-of-order disposal tests.
- A keyless deterministic request-manifest test passes and proves that provider-specific option changes alter request
  identity without persisting their raw values.
- Core typecheck and relevant deterministic tests pass without modifying unrelated user work.

## Rollout and risk

The work ships in three independently testable phases. P0 changes ownership of caches, P1 changes the internal call
path while retaining user-facing contracts, and P2 adds evidence fields and scoped registration. No database
migration is required because replay payloads are JSON and new fields are additive. Rollback is phase-local.

## Completion audit

The final audit traced every requirement to implementation and executable acceptance evidence:

| Requirement                 | Implementation evidence                                                                                                                                       | Acceptance evidence                                                                                                                                                                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-1 instance-scoped caches | `tool/registry.ts`, `mcp/impl.ts`, and `session/prompt-tools.ts` own caches, in-flight work, subscriptions, generations, and queues through `Instance.state`. | Two-live-instance registry, MCP discovery/disposal, and transformed-schema tests; MCP shutdown, stale callback, queue-admission, and schema-identity regressions.                                                                                                                   |
| FR-2 canonical invocation   | `session/prompt-tools.ts` builds the final-visible dispatcher and shared lifecycle boundary; `tool/batch.ts` consumes only that dispatcher.                   | Direct lifecycle/attachment/escalation test; Batch visibility, permissions, hooks, attachment-ID, and fail-closed isolation tests; MCP permission/plugin/lifecycle test.                                                                                                            |
| FR-3 scoped registration    | `tool/registry.ts` stores tokenized registration layers and returns an instance-bound idempotent disposer.                                                    | Stacked, out-of-order, cross-instance-owner, and built-in restoration tests.                                                                                                                                                                                                        |
| FR-4 request manifest       | `session/request-provenance.ts` builds the bounded pre-adapter manifest used by `session/llm-impl.ts`; `replay/event.ts` accepts additive evidence fields.    | Determinism and material-change tests cover system, messages, tool descriptions/schemas, provider/model identity, common options, and provider options; raw prompt, tool argument, and credential values are absent; fallback exposes no partial hashes; legacy events still parse. |

The two-instance tests directly encode the defects present in parent commit `f6bc63ab7`: its registry cache and MCP
cache/promise/generation/subscription/queue were module-global, so the tests' distinct A/B values and post-A-disposal
B assertions could not hold. They pass against the instance-owned implementation.

Final acceptance results:

| Gate                           | Result                                           |
| ------------------------------ | ------------------------------------------------ |
| Core typecheck                 | Passed                                           |
| Seven focused test files       | 111 passed                                       |
| Full deterministic suite       | 845/845 files passed; 7,896 passed and 2 skipped |
| Root script suite              | 21/21 files passed; 113 passed                   |
| Repository structure           | Passed                                           |
| Formatting and diff whitespace | Passed                                           |

Remote delivery proof is recorded in the phase plan and acceptance commit.
