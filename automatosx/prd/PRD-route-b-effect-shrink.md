# PRD: Route B — Effect Shrink + Selective Extraction

**Status:** Approved
**Author:** automatosx
**Date:** 2026-04-06
**Priority:** P0

---

## 1. Goal

Make ax-code's codebase **AI-editable, AI-debuggable, AI-stable** by:
- Reducing Effect coupling (45 files → ~15-20)
- Standardizing logging (Pino backend, keep Log.create API)
- Standardizing schema (Zod only, drop Effect Schema for new code)
- Introducing explicit error handling (Result type for critical paths)
- Replacing InstanceState with AsyncLocalStorage

### KPIs

| Metric | Target |
|---|---|
| AI patch success rate | +25-40% |
| AI refactor regression | -30% |
| Debug time | -40% |
| Effect file count | 45 → ~15-20 |
| New modules using Effect | 0% |
| Logging coverage (critical paths) | ≥ 95% |

---

## 2. Phases

### Phase 0: Freeze (this PR)
- ARCHITECTURE.md with allowed/disallowed patterns
- No new Effect.gen, Layer, InstanceState outside core

### Phase 1: Logging Enrichment + Error Model
- Swap Pino backend into existing Log.create (zero API change)
- Add Result<T, E> type for critical paths
- Unified structured fields: requestId, sessionId, toolName, durationMs, status

### Phase 2: Schema Standardization
- New schemas use Zod (already 117 files)
- Keep Effect-Zod bridge (99 lines) for existing code
- No Valibot (avoids third schema library)

### Phase 3: Effect Shrink + InstanceState Migration
- Effect.gen → async/await (27 files)
- InstanceState → AsyncLocalStorage (17 files, 99 uses)
- Layer/ServiceMap → minimal factories (26 files)

### Phase 4: Tracing Expansion
- OTel already integrated (5 files) — just expand coverage
- Add spans for tool calls, LLM requests, file operations

### Phase 5: Enable Rust Native Addons
- Enable AX_CODE_NATIVE_* flags by default
- Validate with benchmarks

---

## 3. Design Principles

1. **Minimize decision points** — one way to do each thing
2. **Boundary-first** — validation only at edges
3. **Explicit visibility > abstract correctness** — logs/traces over elegance
4. **Linear control flow** — async/await by default
5. **Selective patterns** — Result/schema/factories are opt-in per use case

---

## 4. Implementation Priority

Phase 0 first (this session), then Phase 1, then iterative.
