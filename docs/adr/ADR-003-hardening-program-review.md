# ADR-003: Hardening Program Review — PRD Assessment & Revised Roadmap

**Status:** Accepted
**Date:** 2026-04-03
**Updated:** 2026-04-03
**Decision Makers:** Engineering + Leadership
**Related:** Hardening PRD (v1.7 → v2.x), ADR-004 (Sovereign AI Positioning)

---

## Context

A PRD was submitted proposing a two-phase hardening program for ax-code:

- **Phase 1: Production Hardening** (4–6 weeks) — execution kernel separation, deterministic replay, tool sandbox, E2E testing, observability, release strategy
- **Phase 2: Enterprise Hardening** (6–10 weeks) — policy engine, RBAC, multi-tenant, audit, long-running stability

This ADR documents the **code-verified assessment** of each PRD claim, identifies factual gaps, and proposes a revised execution plan calibrated to actual codebase state.

---

## Assessment Methodology

Every PRD claim was verified against the live codebase (`packages/ax-code/src/`). Findings are based on actual file reads, not assumptions.

---

## Decisions

### AD-1: CLI / Execution Kernel Separation — Defer (Not Required)

**PRD claim:** "CLI entry 過重（index.ts orchestration）", proposes splitting into `ax-core` / `ax-cli` / `ax-server`.

**Actual state:**
- `src/index.ts` is **5 lines** — pure delegation to `cli/boot.ts`
- `cli/boot.ts` is 155 lines — yargs parser + middleware, no business logic
- Agent, tool, provider, session subsystems already use Effect Layer pattern with proper dependency injection
- `src/server/` (Hono) already operates independently from CLI

**Decision: Do not extract separate packages.**

**Rationale:**
- The functional separation already exists. Package extraction adds monorepo linking complexity, increases build time, and complicates version coordination for zero architectural benefit.
- Creating `ax-core` is justified only when a **second consumer** of the core appears (e.g., a standalone agent runtime or embedded SDK).

**Alternative approach:**
- Enforce existing module boundaries via barrel exports and ESLint import rules (e.g., `no-restricted-imports` to prevent `src/cli/` from importing `src/session/` internals)
- Effort: ~1 day

---

### AD-2: Deterministic Replay — Defer to Phase 2

**PRD claim:** Record every step (input prompt, tool call, provider response) and support `ax replay <session-id>`.

**Decision: Implement session export first; defer full replay.**

**Rationale:**
- Full replay requires capturing every LLM response verbatim (token-level), which means significant storage overhead
- LLM non-determinism (temperature, provider-side changes, rate limiting) means "replay" is inherently approximate — you can reproduce the sequence of tool calls but not the exact LLM outputs
- Sessions are already persisted in SQLite with full message/part history — the data is mostly there
- Higher ROI: implement `ax export <session-id>` (JSON dump of session + messages + tool calls) for debugging and audit
- Defer true replay until there is concrete customer demand or compliance requirement

**Consequences:**
- Session export covers 80% of the debugging use case at 20% of the implementation cost
- Full replay remains a Phase 2 option if enterprise customers require it

---

### AD-3: Tool Sandbox Strengthening — Accept (Highest Priority)

**PRD claim:** Three-layer isolation (logical permission → filesystem boundary → process isolation).

**Actual state:**
- **Layer 1 (logical permission):** Well-implemented. Rule-based evaluation with pattern matching, tree-sitter bash command parsing (`src/permission/arity.ts`), three-state model (allow/deny/ask).
- **Layer 2 (filesystem boundary):** Partially implemented. `assertExternalDirectory()` and `Instance.containsPath()` exist. However, tools could theoretically bypass permission by using raw `fs` / `Bun.file()` calls directly instead of routing through the permission layer.
- **Layer 3 (process isolation):** Not present. No seccomp, AppArmor, or container-based sandboxing.

**Decision: Focus on Layer 2 audit; defer Layer 3.**

**Specific requirements:**
1. **Audit all 29 tools** for raw filesystem access that bypasses permission checks — verify every `Bun.file()`, `fs.readFile()`, `fs.writeFile()` call goes through the permission gate
2. **Add integration tests** for permission bypass attempts (tool tries to read outside workspace, tool tries to write without permission)
3. **Document the threat model** — what the sandbox prevents vs. what it does not

**Rationale:**
- Layer 2 audit is high security ROI with low implementation cost (1–2 weeks)
- Layer 3 (process isolation) is complex, platform-specific (Linux-only for seccomp/landlock), and overkill for a single-user CLI in Phase 1
- Layer 3 becomes relevant for enterprise/server deployment (Phase 2)

---

### AD-4: Testing Strategy — Refocus, Not Rebuild

**PRD claim:** "E2E 覆蓋不足" — proposes rebuilding the entire test taxonomy.

**Actual state:**
- **9 E2E tests** already exist (CLI smoke, server routes, session sync, project init)
- **11 recovery tests** already exist (session recovery, message recovery, diff recovery, auth recovery, abort-leak)
- **~70 unit tests** cover tools, permissions, config, session operations
- Tests are organized into 4 groups via `script/test-group.ts`: live, e2e, recovery, unit

**Decision: Keep existing test structure. Add three missing categories.**

**What's actually missing:**
1. **Chaos / fault injection tests** — kill provider mid-stream, corrupt session DB rows, exhaust disk, simulate network partition
2. **Long-session soak test** — 1hr+ session to surface memory leaks, connection pool exhaustion, SQLite lock contention
3. **Permission bypass fuzzing** — adversarial inputs that attempt to escape the sandbox (path traversal, symlink attacks, command injection in bash tool)

**What is NOT missing:**
- E2E framework (exists)
- Recovery tests (11 already)
- Test taxonomy (4-group structure is fine)

**Effort:** 2–3 weeks for the three new categories

---

### AD-5: Observability — Extend, Not Replace

**PRD claim:** "缺少統一 trace ID" — proposes building a new observability layer from scratch.

**Actual state:**
- **128 uses** of `Effect.fn()` — operations are named and traceable within Effect's runtime
- **27 service loggers** via `Log.create({ service })` with structured key-value metadata
- **Timing support** via `log.time()` for duration measurement
- **No distributed tracing** (no OpenTelemetry, no trace_id/span_id correlation)
- **No session_id propagation** across log entries

**Decision: Add OpenTelemetry export layer on top of existing Effect tracing.**

**Specific requirements:**
1. Add `session_id` to all log entries within a session context
2. Export Effect spans to OpenTelemetry format (OTLP)
3. Add `step_id` correlation for tool execution within a session turn
4. Add provider latency and error rate metrics

**Rationale:**
- Effect already provides the span structure — we need export, not replacement
- OpenTelemetry is the industry standard; exporting to it enables integration with Grafana, Datadog, etc.
- `session_id` correlation is the highest-value single addition

**Effort:** 1–2 weeks

---

### AD-6: Release Strategy — Formalize Existing Channels

**PRD claim:** Build alpha/beta/stable channels from scratch with 48hr soak test requirement.

**Actual state:**
- `AX_CODE_CHANNEL` build-time variable already exists
- `Installation.isPreview()` distinguishes preview from stable
- Multi-method install support (npm, brew, scoop, choco, curl) with channel awareness
- No formal promotion criteria or CI gates

**Decision: Define promotion criteria and CI gates for existing channels.**

**Specific requirements:**
1. Define `beta` → `stable` promotion criteria (all E2E pass, no P0 bugs open, 48hr soak period)
2. Add CI gate that blocks `stable` npm publish without beta soak
3. Document release process in `CONTRIBUTING.md`

**Effort:** ~1 week (CI/CD configuration, not engineering)

---

### AD-7: Enterprise Phase (Phase 2) — Conditional on Product Direction

**PRD proposes:** Policy engine, RBAC, multi-tenant isolation, audit, long-running stability.

**Decision: Accept only if product direction is "enterprise agent platform." Defer entirely if direction is "local AI coding tool."**

**Analysis:**

| Feature | Relevant if local CLI? | Relevant if enterprise platform? |
|---------|----------------------|--------------------------------|
| Policy Engine (YAML-based) | No — single user sets own permissions | Yes — org controls what agents can do |
| RBAC (admin/developer/viewer) | No — single user | Yes — team deployment |
| Multi-tenant isolation | No — single user, single machine | Yes — shared server deployment |
| Audit & compliance export | Partially — useful for debugging | Yes — regulatory requirement |
| Long-running stability (24hr soak) | Yes — power users run sessions for hours | Yes — critical for always-on agents |

**Recommendation:**
- **Regardless of direction:** Implement long-running stability tests and session auto-cleanup (TTL, eviction policy)
- **If enterprise direction chosen:** Policy engine → audit → RBAC → multi-tenant (in that order)
- **If CLI direction chosen:** Skip RBAC and multi-tenant entirely. Policy engine is optional. Audit export is nice-to-have.

**The PRD must explicitly declare the product direction before Phase 2 execution begins.**

---

### AD-8: Session Lifecycle Management — Accept (Quick Win)

**Not in original PRD but identified during review.**

**Current state:**
- Sessions persist indefinitely in SQLite — no TTL, no auto-cleanup, no eviction policy
- No background cleanup jobs
- `time_archived` column exists but is not used programmatically
- InstanceState has finalizer support but no session-level GC

**Decision: Implement session lifecycle management.**

**Requirements:**
1. Configurable session TTL (default: 30 days for archived sessions)
2. `ax-code session prune` CLI command
3. Auto-cleanup on startup (remove sessions older than TTL)
4. Memory usage tracking per session (message count, part count, total data size)

**Rationale:** Low-effort stability win. Prevents SQLite database growth from degrading performance over time.

**Effort:** ~1 week

---

## Revised Phase 1 Execution Plan

Ordered by ROI, calibrated to actual gaps:

| # | Work Item | Weeks | Risk | Justification |
|---|-----------|-------|------|---------------|
| 1 | Tool permission audit (no raw fs bypass) | 1–2 | Low | Highest security ROI — verify sandbox integrity |
| 2 | Chaos / fault injection test suite | 2–3 | Medium | Fills the real test gap (not E2E, which exists) |
| 3 | OpenTelemetry + session_id correlation | 1–2 | Low | Extends existing Effect tracing |
| 4 | Session TTL + auto-cleanup | 1 | Low | Quick stability win |
| 5 | Permission bypass fuzzing tests | 1 | Low | Security hardening |
| 6 | Long-session soak test (1hr+) | 1 | Medium | Surfaces memory leaks |
| 7 | Release channel formalization | 1 | Low | CI/CD config, not code |
| **Total** | | **6–8 weeks** | | With buffer for unknowns |

### Items Deferred from Original PRD

| Item | Reason | When |
|------|--------|------|
| Execution kernel package split | Already functionally separated | When second consumer exists |
| Deterministic replay | High cost, low immediate ROI | Phase 2 if customer demand |
| Process-level sandbox (seccomp) | Platform-specific, overkill for CLI | Phase 2 enterprise |

---

## Strategic Recommendation

**The PRD correctly identifies the destination but overestimates the distance.**

ax-code's architecture is closer to production-hardened than the PRD assumes. The codebase already has:
- Well-separated CLI entry point (not monolithic)
- Effect-based module isolation with DI
- 90+ tests including recovery and E2E
- Structured logging with service tags
- Rule-based permission system with bash parsing

**The real gaps are:**
1. Sandbox integrity verification (can tools bypass permission?)
2. Adversarial/chaos testing (what happens when things fail?)
3. Distributed tracing (can we trace a request across components?)
4. Session lifecycle (do old sessions accumulate?)

Phase 1 work is direction-agnostic and should proceed immediately.

**Update (2026-04-03):** Product direction resolved by ADR-004 — ax-code is an **AI coding runtime** focused on controlled execution, composability, and deployment flexibility. The runtime is standalone-first; AutomatosX integrations (AX Trust, AX Engine, AX Fabric, AX Serving) are additive Phase 2 capabilities. See ADR-004 for the full positioning and revised phase plan.

---

## Phase 2: AutomatosX Integration (from ADR-004)

With the product direction resolved as "AI coding runtime, standalone-first," Phase 2 focuses on additive integrations with the AutomatosX ecosystem. Each integration extends the runtime's capabilities without being a prerequisite for core functionality:

| # | Work Item | Weeks | Dependency |
|---|-----------|-------|-----------|
| 1 | AX Trust integration — contract-based execution for all agent actions | 3–4 | Phase 1 sandbox audit |
| 2 | AX Engine as first-class provider — local inference via Apple Silicon | 2–3 | AX Engine API stable |
| 3 | AX Fabric integration — cross-session knowledge read/write | 2–3 | AX Fabric API stable |
| 4 | AX Serving routing — delegate orchestration to AX Serving | 2–3 | AX Serving API stable |
| 5 | Deterministic session contracts — cryptographic session records | 2 | AX Trust integration |

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Tool permission audit finds bypass paths | Medium | High | Fix immediately; add regression tests |
| Chaos tests reveal unknown failure modes | High | Medium | Expected — that's why we're testing |
| OpenTelemetry adds performance overhead | Low | Medium | Use sampling; disable in production by default |
| AX Trust API not stable for integration | Medium | Medium | Runtime is standalone-first; integration is additive |
| Refactor slows feature velocity | Certain | Low | Phase 1 is 6–8 weeks, acceptable trade |

---

## Summary

| ID | Decision | Status |
|----|----------|--------|
| AD-1 | Defer kernel package split — already functionally separated | **Accepted** |
| AD-2 | Defer replay — implement session export first | **Accepted** |
| AD-3 | Tool sandbox audit — highest priority | **Accepted** |
| AD-4 | Refocus testing — add chaos/fuzzing/soak, keep existing structure | **Accepted** |
| AD-5 | Extend observability — OpenTelemetry on Effect, not rebuild | **Accepted** |
| AD-6 | Formalize release channels — CI gates on existing infrastructure | **Accepted** |
| AD-7 | Enterprise phase — **Accepted** (AutomatosX integration, see ADR-004) | **Accepted** |
| AD-8 | Session lifecycle management — TTL + auto-cleanup | **Accepted** |

---

*This ADR is based on code-verified analysis of the ax-code codebase (v1.7.x, 2026-04-03). All claims reference actual files, line counts, and implementation patterns found in `packages/ax-code/src/`. Updated to reflect product direction from ADR-004 (AI Coding Runtime positioning).*
