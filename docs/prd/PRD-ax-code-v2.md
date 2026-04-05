# Product Requirements Document (PRD)

# ax-code v2.0 — From Agent Collection to Enterprise Coding System

**Document Version:** 1.0
**Date:** 2026-04-03
**Author:** Engineering Team
**Status:** Draft — Pending Stakeholder Approval
**References:** ADR-003 (Hardening), ADR-004 (Positioning)

---

## 1. Overview

### 1.1 What v1.7 Is

ax-code v1.7 is a feature-rich AI coding runtime. It has 9 agents, 25+ tools, 13+ providers, LSP integration, session persistence, a programmatic SDK, and multi-surface deployment. It works.

### 1.2 What v1.7 Is Not

v1.7 is not yet an enterprise coding system. It has:

- No new execution model — still uses the inherited agent conversation loop
- No independent runtime kernel — still has structural inheritance from OpenCode
- No performance or algorithmic breakthrough — the same prompt-in, tool-call-out cycle
- No deterministic replay — sessions are recorded but not reproducible
- No policy engine — permissions are local, not org-governed
- No audit trail — actions are logged but not structured for compliance export
- No infrastructure integration — no multi-node routing, no heterogeneous compute

### 1.3 What v2.0 Must Be

v2.0 makes the leap from **feature-rich agent collection** to **enterprise coding system**. The four pillars:

| Pillar                         | What It Means                                                                                  | Why It Matters                                                                                               |
| ------------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Deterministic replay**       | Same input -> same output. Every session reproducible.                                         | Trust. Compliance. Debugging. The single feature that separates a "coding assistant" from a "coding system." |
| **Policy engine**              | Organization-level governance via AX Trust. Policy-as-code for what agents can/cannot do.      | Enterprise adoption. Security team approval. Centralized control.                                            |
| **Audit trail**                | Every action structured, exportable, SIEM-compatible. Cryptographically anchored via AX Trust. | Compliance. Accountability. Incident response.                                                               |
| **Infrastructure integration** | Multi-node routing via AX Serving. Cost-aware model selection. Heterogeneous compute.          | Scale. Cost optimization. Sovereign deployment.                                                              |

### 1.4 Reviewed But Not v2.0 Scope

The following suggestions were reviewed and acknowledged as valuable future directions. They are **not in v2.0 scope** because they require deeper architectural research and risk destabilizing the runtime:

| Suggestion                                                                                                                                                                                    | Assessment                                                                                                                                                                                                                                                             | When |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| **Workflow-based router** (upgrade routing from "agent selection" to "execution path selection" with task classifier, evidence planner, edit strategy, verification planner, recovery policy) | Valid. The current router is prompt-level intelligence. But redesigning the router is a v3.0 concern — v2.0 must first establish the governance and replay layer that any future router will need.                                                                     | v3.0 |
| **Persistent semantic cache** (LSP results cached as repo-level semantic index — symbols, references, call hierarchy, type edges, import graph — used by planner/router/editor)               | Valid. This would make the runtime genuinely code-aware rather than text-aware. But building a persistent semantic index is a major engineering effort (graph storage, invalidation, incremental updates) that belongs in v3.0 after the runtime kernel is stabilized. | v3.0 |
| **Patch candidate ranking** (generate 2-4 candidate patches, rank by verifier score before applying)                                                                                          | Valid. This is a genuine quality improvement. But it requires reliable verification (typecheck, test, lint) as input — which depends on the workflow router. Sequence: v2.0 (replay + policy) -> v3.0 (workflow router + semantic cache) -> v3.x (patch ranking).      | v3.x |
| **Verification-first editing** (decide how to verify before editing — success conditions, failure fallback)                                                                                   | Valid. Partially exists in the plan agent. Full implementation is coupled with the workflow router redesign.                                                                                                                                                           | v3.0 |
| **Failure memory** (record which patches/workflows succeeded or failed, which commands are flaky)                                                                                             | Valid. Useful for cost reduction and quality improvement. Depends on AX Fabric for cross-session knowledge storage — which v2.0 is introducing. Can be added incrementally on top of AX Fabric integration.                                                            | v2.x |
| **Architectural boundary system** (AX.md defines modification zones, do-not-touch zones, coding rules, test policy — agent becomes "governed developer")                                      | Valid. This is essentially policy-as-code applied to code structure. v2.0's AX Trust integration provides the policy engine foundation. Architectural boundaries can be expressed as AX Trust policies in v2.x.                                                        | v2.x |

**The strategic sequence:**

```
v2.0: Deterministic replay + policy engine + audit trail + infra integration
      (make the runtime trustworthy and governable)

v2.x: Failure memory + architectural boundaries
      (leverage v2.0's AX Fabric + AX Trust for code-aware governance)

v3.0: Workflow router + persistent semantic cache + verification-first editing
      (upgrade the execution model from "agent conversation" to "semantic workflow engine")

v3.x: Patch ranking + multi-agent parallelism
      (quality and throughput improvements on top of the new execution model)
```

---

## 2. v2.0 Requirements

### Pillar 1: Deterministic Replay

**The single most important v2.0 feature.**

#### 2.1 Problem

ax-code sessions are recorded in SQLite (messages, tool calls, tool results, provider responses). But they are not reproducible. If you run the same session again:

- The LLM may produce different output (temperature, provider-side changes)
- Tool results may differ (files changed on disk, time-dependent commands)
- The session cannot be "replayed" to prove what happened

This makes ax-code unusable for:

- Compliance teams that need reproducible execution
- Debugging teams that need to replay a failing session
- Enterprise buyers that need deterministic CI/CD integration

#### 2.2 Requirements

| #   | Requirement                                                                                                                                                                                                                                                                                                                                   | Priority |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| R1  | **Event capture** — record every event in the execution loop as a structured event: user input, agent routing decision, tool call (name, args), tool result (output, duration), provider request (model, prompt hash, params), provider response (content, tokens, latency), permission decision (rule, action), error (type, message, stack) | P0       |
| R2  | **Event log format** — JSON Lines, one event per line, with `session_id`, `step_id`, `event_id`, `timestamp`, `event_type`, and event-specific payload                                                                                                                                                                                        | P0       |
| R3  | **Session replay** — `ax-code replay <session-id>` command that replays a session by feeding recorded provider responses and tool results back through the execution loop, producing identical tool calls and final output                                                                                                                    | P0       |
| R4  | **Replay verification** — compare replayed session against original: tool call sequence match, file change match, final output match. Report divergence as structured diff.                                                                                                                                                                   | P0       |
| R5  | **Replay without provider** — replay must work without calling the LLM (uses recorded responses). This enables air-gapped replay and cost-free debugging.                                                                                                                                                                                     | P0       |
| R6  | **Session export** — `ax-code export <session-id>` produces a self-contained replay package (event log + initial file state snapshot) that can be replayed on another machine                                                                                                                                                                 | P1       |
| R7  | **Partial replay** — replay from a specific step, not just from the beginning. Enables "replay from the point it went wrong."                                                                                                                                                                                                                 | P1       |
| R8  | **Replay divergence tolerance** — configurable tolerance for non-deterministic tool results (e.g., `date`, `ls` output order). Events marked as `deterministic: false` are skipped in comparison.                                                                                                                                             | P1       |

#### 2.3 Technical Approach

**Event capture layer** — new module `src/replay/` that instruments the session processor loop:

```
Session processor loop (existing):
  user message -> agent routing -> LLM call -> tool calls -> tool results -> next iteration

With replay instrumentation:
  user message -> [RECORD: user_input]
  -> agent routing -> [RECORD: agent_decision]
  -> LLM call -> [RECORD: provider_request + provider_response]
  -> tool call -> [RECORD: tool_call]
  -> tool result -> [RECORD: tool_result]
  -> permission -> [RECORD: permission_decision]
  -> error -> [RECORD: error]
```

**Replay mode** — when replaying, the session processor reads from the event log instead of calling the LLM:

```
Replay mode:
  read user_input from log
  -> agent routing (verify matches log)
  -> read provider_response from log (skip LLM call)
  -> execute tool call (or read from log for non-deterministic tools)
  -> compare results with log
  -> report divergence
```

**File state snapshot** — on session start, capture a lightweight snapshot of the workspace (file list + hashes, not full content). On replay, verify the initial state matches.

#### 2.4 Acceptance Criteria

- [ ] Every event in the execution loop is captured to the event log
- [ ] `ax-code replay <session-id>` produces identical tool call sequence for a deterministic session
- [ ] Replay works without network access (uses recorded provider responses)
- [ ] Replay divergence is reported as structured diff
- [ ] Event log is JSON Lines, parseable by external tools
- [ ] `ax-code export <session-id>` produces a portable replay package

**Effort:** 4-5 weeks

---

### Pillar 2: Policy Engine (AX Trust Integration)

#### 2.5 Problem

ax-code's permission system is local — rules configured per-user, per-project. There is no organizational governance:

- No centralized policy for what agents can do across a team
- No policy-as-code (declarative, version-controlled, reviewable)
- No policy enforcement at the infrastructure level (only at the client)
- No contract-based execution (pre-approve actions before they happen)

#### 2.6 Requirements

| #   | Requirement                                                                                                                                                          | Priority |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| R9  | **AX Trust client** — `src/trust/` module that communicates with AX Trust API for policy evaluation and audit anchoring                                              | P0       |
| R10 | **Contract submission** — before executing agent actions, submit a contract (agent type, tools requested, file patterns, operation scope) to AX Trust for evaluation | P0       |
| R11 | **Policy evaluation** — AX Trust returns allow / deny / modify (e.g., restrict tool set, limit file scope, require additional verification)                          | P0       |
| R12 | **Policy-as-code** — policies expressed as declarative YAML, version-controlled, applied per organization / team / project                                           | P0       |
| R13 | **Audit anchoring** — after execution, submit results (actions taken, files changed, duration, success/failure) to AX Trust. Receive cryptographic audit receipt.    | P0       |
| R14 | **Graceful degradation** — if AX Trust is unavailable, fall back to local permission system with warning log                                                         | P0       |
| R15 | **Policy examples** — ship 3-5 example policies: read-only-audit, restricted-write, no-bash, allow-list-tools, file-scope-limit                                      | P1       |
| R16 | **Local policy mode** — support local policy files (`.ax-code/policy.yaml`) that use the same format as AX Trust policies, for teams not yet running AX Trust        | P1       |

#### 2.7 Policy Format

```yaml
# .ax-code/policy.yaml or AX Trust managed policy
version: "1"
name: "engineering-team-default"

rules:
  - agent: security
    tools: [read, grep, glob, codesearch, lsp]
    files: ["**"]
    action: allow

  - agent: build
    tools: [read, write, edit, bash, grep, glob]
    files: ["src/**", "test/**"]
    action: allow

  - agent: build
    tools: [bash]
    commands: ["rm -rf", "git push --force"]
    action: deny

  - agent: "*"
    tools: [write, edit]
    files: [".env", "*.key", "*.pem"]
    action: deny

  - agent: "*"
    tools: ["*"]
    files: ["**/node_modules/**"]
    action: deny
```

#### 2.8 Data Flow

```
User message
  -> Agent routing
    -> Contract: { agent: "build", tools: ["edit", "bash"], files: ["src/auth/*"] }
      -> AX Trust: evaluate(contract, org_policy)
        <- allow | deny { reason } | modify { restricted_contract }
    -> Execute within approved contract boundary
    -> Result: { files_changed: ["src/auth/login.ts"], lines: +15/-3, duration: 2.3s }
      -> AX Trust: anchor(result)
        <- AuditReceipt { hash, timestamp, policy_version }
    -> Store receipt in session metadata
```

#### 2.9 Acceptance Criteria

- [ ] Agent actions submit contracts to AX Trust when configured
- [ ] Policy deny stops execution with clear, actionable error message
- [ ] Policy modify restricts the agent's tool/file scope transparently
- [ ] Audit receipts stored in session metadata, retrievable via CLI
- [ ] Local policy mode works without AX Trust server
- [ ] 3+ example policy files shipped in `docs/policies/`
- [ ] Runtime works identically when no policy is configured

**Effort:** 4-5 weeks

---

### Pillar 3: Audit Trail

#### 2.10 Problem

ax-code records session history in SQLite, but:

- The format is not structured for external consumption
- There is no export command for compliance teams
- Events are not correlated (no trace_id / step_id / tool_id)
- There is no SIEM-compatible output format
- AX Trust audit receipts are not integrated

#### 2.11 Requirements

| #   | Requirement                                                                                                                                                                                         | Priority |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| R17 | **Trace correlation** — every event gets `session_id`, `step_id` (per user turn), `tool_id` (per tool call), `trace_id` (correlates across components)                                              | P0       |
| R18 | **Audit event schema** — structured JSON for each event: who (user/agent), what (tool, action, file paths, command), when (ISO timestamp), result (success/failure/error), duration_ms, token_usage | P0       |
| R19 | **`ax-code audit export <session-id>`** — export single session as JSON Lines (one event per line)                                                                                                  | P0       |
| R20 | **`ax-code audit export --all --since <date>`** — bulk export                                                                                                                                       | P0       |
| R21 | **SIEM-compatible schema** — JSON Lines format parseable by Splunk, Datadog, ELK without custom transform                                                                                           | P0       |
| R22 | **AX Trust receipt inclusion** — when AX Trust is configured, each audit event includes the cryptographic receipt                                                                                   | P1       |
| R23 | **OpenTelemetry export** — opt-in OTLP export of trace spans to external observability systems                                                                                                      | P1       |
| R24 | **Audit log retention** — configurable TTL for audit events (default: 90 days), separate from session TTL                                                                                           | P1       |
| R25 | **SDK audit access** — audit export available via programmatic SDK, not just CLI                                                                                                                    | P1       |

#### 2.12 Audit Event Schema

```json
{
  "trace_id": "01JQWX...",
  "session_id": "01JQWX...",
  "step_id": "01JQWX...",
  "tool_id": "01JQWX...",
  "timestamp": "2026-04-03T16:30:00.000Z",
  "event_type": "tool_execution",
  "agent": "build",
  "tool": "edit",
  "action": "write",
  "target": "src/auth/login.ts",
  "result": "success",
  "duration_ms": 45,
  "token_usage": { "prompt": 1200, "completion": 340, "total": 1540 },
  "policy": { "name": "engineering-team-default", "version": "1.2" },
  "audit_receipt": "sha256:abc123...",
  "metadata": { "lines_added": 15, "lines_removed": 3 }
}
```

#### 2.13 Acceptance Criteria

- [ ] Every tool execution, permission decision, and provider call produces an audit event
- [ ] `ax-code audit export <session-id>` produces valid JSON Lines
- [ ] Audit events include trace correlation IDs
- [ ] Schema is parseable by Splunk/Datadog without custom transform (verified)
- [ ] AX Trust receipts included when configured
- [ ] OpenTelemetry export functional when OTLP endpoint is configured
- [ ] Audit export available via SDK

**Effort:** 2-3 weeks

---

### Pillar 4: Infrastructure Integration (AX Serving)

#### 2.14 Problem

ax-code routes all inference requests directly to providers. This works for individual developers but breaks down at scale:

- No cost optimization — every request goes to the configured model regardless of task complexity
- No multi-node routing — can't distribute work across Mac Studio Grid + Jetson Thor + cloud
- No heterogeneous compute — same model for simple completion and complex architecture analysis
- No infrastructure awareness — ax-code doesn't know about available compute resources

#### 2.15 Requirements

| #   | Requirement                                                                                                                                                    | Priority |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| R26 | **AX Serving client** — `src/serving/` module that communicates with AX Serving API for routing and orchestration                                              | P0       |
| R27 | **Routing delegation** — when AX Serving is configured, inference requests are routed through AX Serving instead of direct provider calls                      | P0       |
| R28 | **Cost-aware model selection** — AX Serving selects model based on task complexity, budget constraints, and available compute                                  | P0       |
| R29 | **Heterogeneous compute** — AX Serving routes to appropriate hardware: Mac Studio (control + light inference), Jetson Thor (heavy inference), cloud (fallback) | P1       |
| R30 | **Transparent fallback** — if AX Serving is unavailable, fall back to direct provider calls                                                                    | P0       |
| R31 | **Routing metrics** — report routing decisions, latency overhead, and cost savings in session stats                                                            | P1       |
| R32 | **AX Engine as routing target** — AX Serving can route to AX Engine instances for sovereign inference                                                          | P1       |

#### 2.16 Routing Flow

```
Without AX Serving (current):
  ax-code -> Provider API (direct)

With AX Serving:
  ax-code -> AX Serving -> { Provider API | AX Engine | Mac Studio | Jetson Thor }
                        <- response
  ax-code <- response (transparent to agent/user)
```

#### 2.17 Acceptance Criteria

- [ ] Inference requests route through AX Serving when configured
- [ ] Direct provider calls work when AX Serving is not configured
- [ ] Routing overhead < 50ms per request
- [ ] Cost-aware selection demonstrably reduces API spend in test scenarios
- [ ] Routing decisions visible in `ax-code stats` output
- [ ] AX Engine reachable as routing target through AX Serving

**Effort:** 3-4 weeks

---

## 3. Production Hardening (Prerequisites)

The following items from ADR-003 must be completed before or in parallel with the four pillars. They are prerequisites for enterprise credibility.

| #   | Requirement                                                                                                                                | Effort    | Justification                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------- | ------------------------------------------------------------- |
| R33 | **Tool permission audit** — verify all 29 tools route through permission layer, no raw fs bypass                                           | 1-2 weeks | Can't integrate policy engine until local sandbox is verified |
| R34 | **Chaos / fault injection tests** — >= 20 failure scenarios (provider crash, DB corruption, abort mid-stream)                              | 2-3 weeks | Enterprise customers expect resilience proof                  |
| R35 | **Session lifecycle management** — TTL, auto-cleanup, `ax-code session prune`                                                              | 1 week    | Replay and audit require clean session boundaries             |
| R36 | **Deferred bug fixes** — 11 bugs from PRD-deferred-bugs-fixplan (error swallowing, fire-and-forget writes, session atomicity, type errors) | 1-2 weeks | Stability baseline for v2.0                                   |
| R37 | **Deferred perf fixes** — tool init cache, summary message passthrough (~500ms savings/task)                                               | 1 week    | Runtime performance baseline                                  |
| R38 | **Sandbox gaps** — CLI flag, settings UI, escalation flow                                                                                  | 1 week    | Completes the user-facing sandbox experience                  |
| R39 | **Release channel formalization** — beta -> stable promotion with 48hr soak                                                                | 1 week    | Needed for v2.0 release process                               |

---

## 4. Execution Plan

### 4.1 Phase 1: Hardening + Replay Foundation (8-10 weeks)

```
Week 1-2:   Deferred fixes (R36, R37, R38)
            Tool permission audit (R33)
Week 3-4:   Event capture layer — instrument the session processor loop (R1, R2)
            Trace correlation IDs (R17)
Week 5-7:   Session replay engine (R3, R4, R5)
            Chaos test suite (R34)
Week 7-8:   Session export / partial replay (R6, R7, R8)
            Session lifecycle (R35)
Week 8-10:  Audit event schema + export CLI (R18-R21)
            Release channels (R39)

Milestone: v2.0-beta.1
  - Deterministic replay functional
  - Audit export functional
  - Production hardened
```

### 4.2 Phase 2: Governance + Infrastructure (8-10 weeks)

```
Week 1-4:   AX Trust integration — policy engine (R9-R16)
Week 3-6:   AX Serving integration — routing (R26-R32)
Week 5-8:   Audit + AX Trust integration — receipts, OTEL (R22-R25)
Week 8-10:  Integration testing, beta release

Milestone: v2.0-beta.2
  - Policy engine operational
  - AX Serving routing functional
  - Audit trail with cryptographic receipts
```

### 4.3 Phase 3: Enterprise Readiness (4-6 weeks)

```
Week 1-2:   Air-gapped deployment verification
Week 2-4:   Surface parity enforcement (CLI, SDK, server)
Week 3-5:   Reference deployment + documentation
Week 5-6:   v2.0 stable release preparation, soak test

Milestone: v2.0 stable
```

### 4.4 Total Timeline

```
Phase 1:  8-10 weeks  (hardening + replay + audit)
Phase 2:  8-10 weeks  (policy engine + infrastructure)
Phase 3:  4-6 weeks   (enterprise readiness)
Total:    20-26 weeks  (5-6 months)
```

---

## 5. What Comes After v2.0

v2.0 establishes the foundation — deterministic execution, governance, audit, infrastructure integration. This unlocks the v3.0 agenda:

| Version  | Focus                                                                                                                                                                                   | Depends On                                                              |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **v2.x** | Failure memory (via AX Fabric), architectural boundaries (via AX Trust policy), AX Fabric knowledge integration                                                                         | v2.0 AX Trust + AX Fabric foundation                                    |
| **v3.0** | Workflow router (task classifier -> evidence planner -> edit strategy -> verification planner -> recovery policy), persistent semantic cache (LSP as index), verification-first editing | v2.0 replay + policy (new router needs governance), v2.x failure memory |
| **v3.x** | Patch candidate ranking (generate N patches, rank by verifier), multi-agent parallelism                                                                                                 | v3.0 workflow router + semantic cache                                   |

**The key insight:** v2.0's replay and policy systems are prerequisites for v3.0's workflow router. You cannot build a sophisticated orchestrator without first having the governance layer (policy) and the debugging layer (replay) to control and debug it.

---

## 6. Dependencies

### 6.1 External

| Dependency              | Required By            | Blocker?                                                 |
| ----------------------- | ---------------------- | -------------------------------------------------------- |
| AX Trust API (stable)   | R9-R16 (policy engine) | Yes for Phase 2; mitigated by local policy mode (R16)    |
| AX Serving API (stable) | R26-R32 (routing)      | Yes for Phase 2; mitigated by transparent fallback (R30) |
| OpenTelemetry SDK       | R23 (OTEL export)      | No — new npm dependency, low risk                        |

### 6.2 Internal

| Dependency                  | Required By                                                         |
| --------------------------- | ------------------------------------------------------------------- |
| Tool permission audit (R33) | Policy engine (R9) — can't layer org policy on broken local sandbox |
| Event capture (R1-R2)       | Replay (R3-R5), audit (R18-R21) — same event log feeds both         |
| Trace correlation (R17)     | Audit export (R19-R21), OTEL (R23) — events need IDs before export  |
| Session lifecycle (R35)     | Replay (R6) — export requires clean session boundaries              |

---

## 7. Risk Assessment

| Risk                                          | Probability | Impact | Mitigation                                                                                                         |
| --------------------------------------------- | ----------- | ------ | ------------------------------------------------------------------------------------------------------------------ |
| Replay divergence in non-deterministic tools  | High        | Medium | R8: tolerance config, deterministic flag per tool. Accept that bash commands and time-dependent tools may diverge. |
| Event capture adds latency to every operation | Medium      | Medium | Async write to event log. Benchmark overhead target: < 5ms per event.                                              |
| AX Trust API not stable on schedule           | Medium      | High   | R16: local policy mode provides standalone value. Phase 2 can proceed with mock API.                               |
| Policy engine too restrictive for developers  | Medium      | Medium | Default policy is permissive. Policies are opt-in. Example policies demonstrate graduated restriction.             |
| Scope creep from v3.0 features                | High        | High   | Non-scope section is explicit. Workflow router, semantic cache, patch ranking are documented as v3.0.              |
| Replay storage requirements too large         | Medium      | Low    | Event log is append-only JSON Lines. Compress on export. Configurable retention (R24).                             |
| AX Serving routing overhead exceeds 50ms      | Low         | Medium | Benchmark early. Transparent fallback (R30) if unacceptable.                                                       |

---

## 8. Success Criteria

### v2.0 Release Criteria

```
Deterministic replay:
  - ax-code replay <session-id> reproduces identical tool call sequence
  - Replay works without network (uses recorded responses)
  - Session export produces portable replay package

Policy engine:
  - AX Trust contract evaluation on all agent actions
  - Local policy mode works without AX Trust server
  - 3+ example policies shipped

Audit trail:
  - ax-code audit export produces valid JSON Lines
  - Events include trace correlation IDs
  - SIEM-compatible (verified against Splunk/Datadog schema)

Infrastructure:
  - AX Serving routing functional when configured
  - Transparent fallback when not configured
  - Routing overhead < 50ms

Production quality:
  - Crash-free session rate >= 99.5%
  - All 29 tools pass permission audit
  - >= 20 chaos test scenarios passing
  - v2.0 beta soak >= 48hr before stable release
```

### Market Validation

```
Strong signals:
  - Enterprise security team approves ax-code based on audit trail + policy engine
  - Team uses replay to debug a production incident
  - CI/CD pipeline uses headless ax-code with policy enforcement
  - Customer in restricted environment deploys with AX Serving routing

Weak signals (re-evaluate if dominant):
  - Users ignore replay, policy, and audit entirely
  - All adoption driven by "free multi-provider CLI" (v1.7 value, not v2.0)
  - No enterprise conversion from developer adoption
```

---

## 9. Non-Goals (Explicitly Deferred)

| Item                             | Version       | Reason                                                  |
| -------------------------------- | ------------- | ------------------------------------------------------- |
| Workflow-based router            | v3.0          | Requires replay + policy foundation first               |
| Persistent semantic cache        | v3.0          | Major engineering effort; needs stable runtime kernel   |
| Patch candidate ranking          | v3.x          | Requires workflow router + verification engine          |
| Verification-first editing       | v3.0          | Coupled with workflow router redesign                   |
| Multi-agent parallelism          | v3.x          | Premature without semantic layer + stable orchestration |
| RBAC (role-based access control) | v3.0          | Requires team/org model design                          |
| Multi-tenant isolation           | v3.0+         | Requires hosted/SaaS deployment model                   |
| OS-level sandboxing (seccomp)    | v3.0+         | Platform-specific, Linux-only                           |
| Execution kernel package split   | When needed   | Only when second consumer of core exists                |
| New agent types / tools          | Separate PRDs | Feature work, independent of hardening                  |
| UI redesign                      | Separate PRDs | UX work, independent of runtime                         |

---

## 10. Implementation Status (2026-04-04)

### Overall: Phase 1 foundation substantially complete. Event capture done (13 types including llm.output), audit trail operational, 6 bugs fixed, code quality improved. True replay (R3-R5) and enterprise pillars not started.

### Pillar 1: Deterministic Replay

| Req | Description                                         | Status   | Notes                                                                                                                                                                                                                                                                                           |
| --- | --------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Event capture — instrument execution loop           | **Done** | All 13 event types emitted: session.start/end, agent.route, llm.request/response/output, step.start/finish, tool.call/result, permission.ask/reply, error. messageID on all message-scoped events. 6 bugs fixed in emission logic (recorder race, orphaned session.end, wrong reason defaults). |
| R2  | Event log format — JSON Lines, structured schema    | **Done** | Drizzle schema `event_log` table. Migration `20260403000000_event_log`. Indexes on session_id, (session_id, sequence), time_created. `bySessionWithTimestamp()` query added.                                                                                                                    |
| R3  | Session replay — re-execute from recorded responses | **Done** | Full chain: `Replay.prepareExecution()` → mock LLM stream → `SessionProcessor.process()` → result. Test proves processor consumes reconstructed stream and produces identical finish reason without calling LLM. CLI modes: `reconstruct`, `compare`, `execute`. 5 tests pass.                  |
| R4  | Replay verification — compare replayed vs original  | **Done** | `Replay.compare()` compares reconstructed steps against original events — checks step count, finish reasons, tool call counts. CLI: `replay <sid> --mode compare`.                                                                                                                              |
| R5  | Replay without provider — air-gapped replay         | **Done** | `Replay.toFullStream()` generates processor-compatible stream from recorded events without calling LLM. `reconstruct` CLI mode works offline.                                                                                                                                                   |
| R6  | Session export — portable replay package            | **Done** | `replay <sid> --mode export` produces JSON package with session metadata, all events, and reconstructed steps. Portable — can be replayed on another machine.                                                                                                                                   |
| R7  | Partial replay — resume from step N                 | **Done** | `reconstructStream(sid, { fromStep: N })` skips steps before N. CLI: `replay <sid> --mode reconstruct --from-step N`.                                                                                                                                                                           |
| R8  | Divergence tolerance — configurable non-determinism | **Done** | `deterministic: boolean` field on Base event schema. tool.result events marked `deterministic: false`. Verify mode skips non-deterministic events in comparison.                                                                                                                                |

### Pillar 2: Policy Engine (AX Trust)

| Req | Description                | Status          | Notes                                                                                                                                                                                                                                   |
| --- | -------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R9  | AX Trust client            | **Not started** | No `src/trust/` module.                                                                                                                                                                                                                 |
| R10 | Contract submission        | **Not started** |                                                                                                                                                                                                                                         |
| R11 | Policy evaluation          | **Not started** |                                                                                                                                                                                                                                         |
| R12 | Policy-as-code YAML        | **Not started** |                                                                                                                                                                                                                                         |
| R13 | Audit anchoring + receipts | **Not started** |                                                                                                                                                                                                                                         |
| R14 | Graceful degradation       | **Done**        | Runtime works identically when no AX Trust or policy is configured — falls back to local permission system. `loadPolicy()` logs warning on parse failure and returns empty ruleset. No configuration required for standalone operation. |
| R15 | Policy examples            | **Done**        | 5 example policies in `docs/policies/`: read-only-audit, restricted-write, no-bash, protect-secrets, file-scope-limit.                                                                                                                  |
| R16 | Local policy mode          | **Done**        | `.ax-code/policy.json` loaded at agent initialization. Rules converted to Permission.Ruleset and merged into all 9 agents (after defaults, before user config). Schema: `{ version, name, rules: [{ agent, tools, files, action }] }`.  |

### Pillar 3: Audit Trail

| Req | Description                  | Status          | Notes                                                                                                                                                                                                                                                                 |
| --- | ---------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R17 | Trace correlation IDs        | **Done**        | session_id, step_id, and tool_id (from callID) present on all events. trace_id = sessionID (will become real trace ID with OTEL).                                                                                                                                     |
| R18 | Audit event schema           | **Done**        | Full schema: trace_id, session_id, step_id, tool_id, timestamp, event_type, agent, tool, action, target, result, duration_ms, token_usage, cost, policy {name, version}. Only missing: audit_receipt (depends on R13/AX Trust).                                       |
| R19 | `audit export <session-id>`  | **Done**        | Streams events as JSON Lines to stdout.                                                                                                                                                                                                                               |
| R20 | `audit export --all --since` | **Done**        | Bulk export with timestamp filtering.                                                                                                                                                                                                                                 |
| R21 | SIEM-compatible schema       | **Done**        | Validated with 108 assertions in `test/audit/siem.test.ts`. ISO 8601 timestamps, trace correlation IDs, action/result fields, numeric duration, JSON Lines format — all match Splunk CIM, ELK ECS, and Datadog expectations.                                          |
| R22 | AX Trust receipt inclusion   | **Not started** | Depends on R9-R13 (Pillar 2).                                                                                                                                                                                                                                         |
| R23 | OpenTelemetry export         | **Done**        | `src/telemetry/index.ts` — opt-in OTLP export via `AX_CODE_OTLP_ENDPOINT`. Sessions exported as traces, steps as spans, tool calls as child spans. CLI: `ax-code audit otlp <sid>`. Uses `@opentelemetry/sdk-trace-node` + `@opentelemetry/exporter-trace-otlp-http`. |
| R24 | Audit log retention          | **Done**        | `ax-code audit prune --days N` (default 90). Uses single-batch DELETE.                                                                                                                                                                                                |
| R25 | SDK audit access             | **Done**        | HTTP routes: `GET /audit/export/:sessionID`, `GET /audit/export?since=`, `GET /audit/replay/:sessionID?fromStep=`. Available via server API and SDK.                                                                                                                  |

### Pillar 4: Infrastructure (AX Serving)

| Req     | Description                 | Status          | Notes                                   |
| ------- | --------------------------- | --------------- | --------------------------------------- |
| R26-R32 | All AX Serving requirements | **Not started** | No `src/serving/` module. Phase 2 work. |

### Production Hardening

| Req | Description                   | Status   | Notes                                                                                                                                                                                                                                                                                                      |
| --- | ----------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R33 | Tool permission audit         | **Done** | All 29 tools verified — permission layer routes all operations, isolation checks precede mutations. See `docs/prd/PRD-tool-permission-audit.md`.                                                                                                                                                           |
| R34 | Chaos / fault injection tests | **Done** | 22 scenarios in `test/session/chaos.test.ts`: stream failures (6), abort timing (3), tool failures (4), error events (2), multi-step (2), usage edge cases (2), reasoning (2), incomplete tools (1). All pass.                                                                                             |
| R35 | Session lifecycle management  | **Done** | `ax-code session prune --days N` deletes old sessions.                                                                                                                                                                                                                                                     |
| R36 | Deferred bug fixes            | **Done** | `docs/prd/PRD-deferred-bugs-fixplan.md` created. 41 bugs fixed across 4 prior commits. 0 active bugs remain. 8 TODOs are features/upstream. Plus 6 replay/audit bugs found and fixed this session.                                                                                                         |
| R37 | Deferred perf fixes           | **Done** | Summary passthrough done. Tool schema caching exists. Git snapshot optimization already implemented (checks `git status --porcelain`, skips `git add .` + `write-tree` when unchanged).                                                                                                                    |
| R38 | Sandbox gaps                  | **Done** | Fully verified: config schema with `isolation.mode/network/protected` and descriptions, CLI `--sandbox` flag, env var `AX_CODE_ISOLATION_MODE`, escalation via `permission.ask(isolation_escalation)`, `assertWrite/Bash/Network` enforcement, test coverage. Settings UI reads config schema annotations. |
| R39 | Release channel formalization | **Done** | Process documented in `docs/prd/PRD-release-channels.md`. GitHub Actions: `publish.yml` (beta with typecheck+test gates), `promote.yml` (stable with 48hr soak enforcement). Existing infra: channel-aware builds, npm tags, Docker, Homebrew/AUR.                                                         |

### Summary

| Category                 | Done   | Partial | Not Started | Total  |
| ------------------------ | ------ | ------- | ----------- | ------ |
| Replay (R1-R8)           | 8      | 0       | 0           | 8      |
| Policy (R9-R16)          | 3      | 0       | 5           | 8      |
| Audit (R17-R25)          | 8      | 0       | 1           | 9      |
| Infrastructure (R26-R32) | 0      | 0       | 7           | 7      |
| Hardening (R33-R39)      | 7      | 0       | 0           | 7      |
| **Total**                | **26** | **0**   | **13**      | **39** |

### What exists vs what the PRD requires

**Real working code:**

- Event capture: 13 event types (including llm.output), fully instrumented (R1) ✓
- Event log: SQLite schema, migration, query layer, recorder with race-condition fix (R2) ✓
- Trace correlation: session_id, step_id, tool_id on all events (R17) ✓
- Audit export: `audit export <sid>`, `audit export --all --since` (R19-R20) ✓
- Audit retention: `audit prune --days N` with batch DELETE (R24) ✓
- Session prune: `session prune --days N` (R35) ✓
- Deferred bugs: 47 bugs total fixed (41 prior + 6 this session), 0 active (R36) ✓
- Event validation: `replay <sid> --mode verify/check/summary` (clarified as validation, not replay) ✓
- LLM output capture: `llm.output` records full text/reasoning/tool_call parts — unblocks R3 ✓
- Code quality: 52 `any` types eliminated (133 → 81) ✓

**Unblocked but not started:**

- R3 (true session replay) — now unblocked by llm.output capture. Needs: mock provider, execution harness, comparison engine.

**Entirely missing (Phase 2):**

- Policy engine (Pillar 2) — requires AX Trust API or local YAML engine
- Infrastructure routing (Pillar 4) — requires AX Serving API
- OpenTelemetry, SIEM validation, SDK access, chaos tests

### Critical path to v2.0-beta.1

Per the execution plan (Section 4.1), the next items to build are:

1. **R3-R5: True session replay** — mock provider that feeds recorded llm.output, execution harness, comparison engine
2. **R34: Chaos test suite** — fault injection for provider crash, DB corruption, abort mid-stream
3. **R6-R8: Export, partial replay, divergence tolerance**
4. **R33: Tool permission audit** — systematic verification of all 28 tools
5. **R37: Deferred perf fixes** — tool init cache, summary passthrough
