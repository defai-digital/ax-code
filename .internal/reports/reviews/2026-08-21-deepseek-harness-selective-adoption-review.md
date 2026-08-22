# DeepSeek Harness Selective-Adoption Review

**Date:** 2026-08-21
**Scope:** `.internal/reference/deepseek-harness` compared with AX Code runtime
**Reviewers:** DeepSeek V4 Pro, Qwen 3.8 Max, Grok 4.6 fallback, Codex CLI Sol Max, AX Code maintainer synthesis

> The requested Grok 4.7 model was not available in the installed AX Code model catalog. The review used
> `grok-build-cli/grok-4.6` and does not represent it as Grok 4.7.

## Executive decision

Adopt a small set of DeepSeek Harness ideas that strengthen AX Code's existing runtime, without replacing AX
Code's architecture. The highest-value work is execution integrity: isolate caches by `Instance`, make every tool
surface use a shared lifecycle boundary, preserve Batch's fail-closed isolation behavior, and record a raw-prompt-free,
privacy-minimized request manifest for replay evidence.

Do not adopt an everything-is-a-plugin rewrite, DeepSeek Harness session/event formats, MCP-in-Batch, interactive
permission escalation from parallel Batch calls, or a new workflow/scheduling substrate. AX Code is already stronger
in durable workflows, scheduling, memory, audit, code intelligence, multi-model verification, Desktop/TUI/SDK, and
its existing browser-agent surface.

## Corrected capability comparison

| Runtime capability                                                           | AX Code                             | DeepSeek Harness                                | Review conclusion                                                 |
| ---------------------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------- |
| Agent runtime, providers, tools, files, shell, MCP, skills, agents, planning | Yes                                 | Yes                                             | Broad parity; implementation models differ.                       |
| Sandbox and permissions                                                      | Strong, integrated                  | Strong, plugin-oriented                         | Preserve AX boundaries and close alternate execution paths.       |
| Sessions, replay, fork                                                       | Durable                             | Event/session architecture                      | Do not replace AX persistence; improve request evidence narrowly. |
| Memory                                                                       | Dedicated subsystem                 | No equivalent general long-term subsystem found | AX advantage.                                                     |
| Desktop                                                                      | Native Electron product             | Web UI                                          | AX advantage.                                                     |
| Scheduling                                                                   | Operational cron/headless scheduler | Robust session-local reminders                  | Both useful; AX is stronger operationally.                        |
| Browser agent                                                                | Implemented, experimental           | Possible through tool/plugin                    | Describe AX status accurately; graduate separately.               |
| Audit/evidence                                                               | Strong user-visible audit           | Strong event/session concepts                   | Add final-request fingerprints to close one gap.                  |
| Code intelligence                                                            | Index/LSP/graph                     | Not a primary focus                             | AX advantage.                                                     |
| Arena / multi-model verification                                             | First-class                         | Not the same focus                              | AX advantage.                                                     |
| Dynamic workflows                                                            | Durable declarative engine          | More dynamic script composition                 | Borrow composition ideas only where they preserve resumability.   |
| Everything-is-plugin                                                         | Selective extension points          | Architectural center                            | A trade-off, not an inherent advantage.                           |

## Reference code inspected

The review was code-level, not a comparison of README checkmarks. In particular it traced DeepSeek Harness's ordered
tool scheduler and lifecycle in `packages/core/agent-loop/src/tool-calls.ts`, request-header reconstruction in
`packages/core/session/src/request-header.ts`, MCP generation swaps and exact disposers in
`packages/mcp/mcp-client/src/tools.ts`, session durability in `packages/session/session-persistence/src/`, and Cordis
scope/effect ownership in `vendor/cordis/src/context.ts`, `registry.ts`, and `fiber.ts`. Those paths were compared
against AX Code's registry, prompt-tool, MCP, replay, workflow, scheduler, memory, audit, and code-intelligence code.

## Findings agreed by the reviewers

### P0 — cross-instance state contamination

`packages/ax-code/src/tool/registry.ts` stores its initialized-tool cache at module scope. Its cache key does not
include project or `Instance` identity, and cache hits occur before the per-instance state is loaded. Some tool
initializers capture `directory` or `worktree`, so two projects hosted in one process can receive stale tools from
the other project. This is cross-instance stale-cache contamination, not an unbounded-memory leak.

`packages/ax-code/src/mcp/impl.ts` has the same class of problem for discovered MCP tools, the in-flight discovery
promise, cache generation, event subscription, and connection queue. Disposal by one instance can invalidate or
unsubscribe another instance's shared state.

**Decision:** move all of those fields into existing `Instance.state` records and add two-instance regression tests.

### P1 — alternate tool surfaces bypass the canonical lifecycle

Direct model-selected tools pass through plugin hooks, lifecycle hooks, permission checks, and isolation handling in
`session/prompt-tools.ts`. Batch calls `ToolRegistry.tools()` and then `tool.execute()` directly, so it can bypass
disabled-tool visibility and the surrounding lifecycle. Direct MCP calls run plugin hooks and permission checks but
do not currently emit the same Pre/PostToolUse lifecycle hooks.

**Decision:** introduce a thin shared invocation boundary. Direct tools use normal isolation escalation. Batch sees
only the already-enabled registry tools and uses fail-closed isolation; it must not open interactive escalation from
inside parallel `Promise.all` work. MCP remains excluded from Batch and gains lifecycle-hook parity at its external
trust boundary.

### P2 — request provenance is weaker than session provenance

The replay stream records model, message count, and temperature before the final request is assembled. Later system
prompt transformations, enabled tool names/schemas, and model options are not represented by durable evidence.

**Decision:** record a versioned manifest at AX Code's final AI-SDK pre-adapter assembly boundary: provider/model
identifiers, ordered tool identifiers, counts, selected options, and deterministic SHA-256 fingerprints. Do not
persist raw prompt content by default. This is pseudonymous, privacy-minimized evidence—not anonymous evidence:
unsalted hashes expose equality and low-entropy values can be dictionary-guessed, so the event remains subject to the
same access and retention controls as other replay data. It does not claim byte-for-byte provider-wire fidelity.

### P2 — scoped registration

`ToolRegistry.register()` mutates instance state but offers no exact disposer. DeepSeek Harness's effect/disposer
discipline is useful here without requiring its full plugin container.

**Decision:** return an idempotent disposer and preserve stacked registrations correctly.

## Reviewer differences and resolution

- Qwen favored applying interactive isolation retry to Batch for parity. Grok identified the reentrant-prompt and
  deadlock risk in concurrent Batch execution. The accepted design is fail-closed Batch isolation.
- Qwen rated missing AX isolation around MCP highly. MCP is an external transport boundary with its own permission
  contract; this change adds lifecycle evidence but does not silently reinterpret MCP process isolation.
- Codex CLI Sol Max identified shutdown admission races, stale MCP callback ownership, schema-cache identity gaps,
  partial-looking provenance hashes, and over-strong privacy terminology. The accepted implementation closes queue
  admission during disposal, captures state owners in callbacks/disposers, keys transforms by schema plus full model
  identity, fails provenance manifests closed while allowing provider dispatch, and documents hash leakage.
- All reviewers supported selective adoption rather than a Cordis/everything-is-plugin rewrite.

## Explicit non-goals

- Replacing AX Code sessions, replay, workflows, scheduling, memory, or plugin runtime.
- Putting MCP tools into Batch.
- Persisting raw prompts, headers, credentials, or provider payloads by default.
- Requiring per-file 100% coverage.
- Copying DeepSeek Harness's simpler environment sanitization; AX Code's sanitizer is already broader.
- Claiming feature parity based only on checkmarks; maturity and operational semantics remain part of the review.

## Final implementation review

| Reviewer          | Result              | Findings and resolution                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DeepSeek V4 Pro   | `APPROVE`           | Confirmed the instance, Batch, lifecycle, and provenance design. Its non-blocking teardown observation led to closing established MCP clients before waiting for startup/queue drain; its duplicate-attachment-ID observation was also fixed. Its isolated prompt-tools rerun could not resolve `os.userInfo()` inside the reviewer sandbox, while the same tests passed in the primary and Sol Max environments. |
| Qwen 3.8 Max      | No blocking finding | Confirmed the security boundaries. Its provenance observation led to hashing the sanitized provider-specific options and reusing the exact same object for `streamText`; documentation now describes direct isolation visibility, teardown ordering, and attachment ownership.                                                                                                                                    |
| Grok 4.6 fallback | `APPROVE`           | Found no blocking correctness or security issue across teardown, scoped registration, Batch isolation, lifecycle ordering, and provenance. This is the explicit fallback review, not a Grok 4.7 result.                                                                                                                                                                                                           |
| Codex CLI Sol Max | `APPROVE`           | Re-ran the seven focused files and core typecheck, then identified and rechecked the final code-documentation drift. It approved after PRD, ADR-060, this spec, and the phase plan were aligned with the reviewer-driven amendments.                                                                                                                                                                              |

No blocking finding remains. Deferred improvements are recorded in the phase plan rather than expanding this change
into a plugin-container or session rewrite.

## Post-review acceptance audit

On 2026-08-22, a requirement-by-requirement audit added explicit coverage for direct attachment mapping and
interactive isolation escalation, successful Batch child permissions and hooks, Batch's complete final-visible
exclusion set, MCP permission preservation, provider-option/tool-argument redaction, manifest material-change
sensitivity, fail-closed manifest fallback, and legacy replay parsing. The resulting seven focused files passed
111/111 tests, core typecheck passed, and the full deterministic suite passed 845/845 files with 7,896 tests passed
and 2 skipped. This audit did not alter the production design approved by the four-model review.

## Delivery map

The requirements are in `PRD-2026-08-21-tool-execution-integrity.md`, the durable decisions in ADR-060, the exact
implementation in `SPEC-2026-08-21-tool-execution-integrity.md`, and phase status in
`reports/planning/tool-execution-integrity/PHASES.md`.
