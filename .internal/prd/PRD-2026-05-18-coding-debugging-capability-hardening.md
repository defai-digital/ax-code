# PRD: Coding & Debugging Capability Hardening

**Date:** 2026-05-18
**Status:** In Progress
**Scope:** Internal
**Owner:** AX Code runtime
**Related:** `.internal/prd/PRD-token-efficiency-and-context-budgeting.md`, `.internal/prd/PRD-debug-fix-closed-loop-v1.md`, `.internal/prd/PRD-v5-agent-control-plane.md`, `.internal/adr/ADR-005-subagent-orchestration.md`

This is an internal planning artifact under `.internal/`, which is gitignored by default. Force-add only when the maintainer explicitly wants this PRD versioned.

---

## Purpose

Improve AX Code's coding and debugging capabilities by hardening the 40% of the system that is under our control: tool design, context management, feedback loops, and code intelligence completeness.

User feedback suggests AI coding ability is roughly 60% LLM model quality and 40% tool/methodology design. This PRD targets that 40% with concrete, testable improvements that do not depend on changing the underlying model.

## Problem

AX Code has strong foundations:

- Debug Engine with structured case/evidence/hypothesis/verification workflow
- 35+ tools with model-aware selection and per-tool fault isolation
- Multi-agent architecture with permission isolation and subagent fan-out control
- Code Intelligence graph with SQLite-backed symbol/call/reference edges
- Deterministic scanners for duplicates, hardcodes, races, lifecycle, and security

However, several practical gaps limit the system's effectiveness regardless of model quality:

### 1. Context management is reactive, not proactive

Compaction only fires when the token budget is exceeded. Before that threshold, the LLM may already be drowning in irrelevant context. Tool output truncation tells the model "output was cut" but not "what was lost" or "where to find the rest." The LLM must decide what to read on its own, often making suboptimal choices.

### 2. Tool error feedback is one-dimensional

When a tool fails, the error message is appended to the prompt. This tells the LLM something went wrong but does not teach it why or how to avoid repeating the same mistake. Common error patterns (edit `oldString` not found, bash path errors, wrong tool parameter shapes) recur across sessions with no system-level learning.

### 3. Code Intelligence is missing import/dependency edges

`findImports` and `findDependents` return empty arrays (Phase 2). Impact analysis and refactor planning lack cross-file dependency information. The LLM makes structural decisions without knowing what files depend on what.

### 4. Debug Engine scanners are JS/TS-oriented

Race scan, lifecycle scan, security scan, and dedup scan explicitly note limited coverage for Rust, Python, and Ruby. Modern projects are polyglot; the debug engine's value drops significantly outside JS/TS.

### 5. Debug knowledge is session-scoped

Instrumentation plans and evidence live in the session event log. There is no cross-session debug pattern memory. The same bug pattern investigated in session A is forgotten by session B.

### 6. Prompt loop is a 1400+ line monolith

`prompt.ts` handles subtask, compaction, context overflow, agent routing, todo continuation, completion gate, empty turn recovery, and normal processing in a single while-true loop. This is the most complex file in the codebase and the most likely source of session-level bugs that indirectly reduce LLM effectiveness.

## Goals

1. Keep the LLM focused on relevant context through proactive, tiered context management
2. Reduce repeated tool errors through pattern detection and pre-validation
3. Complete Code Intelligence import/dependency edges for accurate impact analysis
4. Extend Debug Engine scanners to Rust and Python with language-native patterns
5. Enable cross-session debug pattern memory for recurring bug recognition
6. Keep all changes compatible with existing session records, provider integrations, and DRE artifact schemas

## Non-Goals

- Do not replace or wrap the LLM provider abstraction layer
- Do not introduce new Effect usage outside legacy allowed areas
- Do not change persisted message, part, or debug artifact schemas unless a later phase proves it necessary
- Do not redesign the agent permission system
- Do not replace the prompt loop entirely in the first release (incremental extraction only)
- Do not add cloud-based pattern learning or telemetry

## Success Metrics

- Tool error recurrence rate drops by measurable margin (same error pattern within a session)
- Edit tool `oldString` pre-validation catches mismatches before LLM round-trip
- `findImports` and `findDependents` return non-empty results for TS/JS projects
- Rust scanner (`cargo clippy` pattern ingestion) produces findings in Rust workspaces
- Cross-session debug pattern matching suggests known fixes for recurring bug signatures
- Context compaction fires earlier on long sessions without false-positive over-compaction

## Requirements

### R0: Tiered Context Management

Context should be organized into three tiers that the system manages, not the LLM:

- **Tier 1 (always present):** Current task description, recent tool results, active file content
- **Tier 2 (on demand):** Related symbols, caller/callee chains, dependency context
- **Tier 3 (background):** Historical conversation, compaction summaries, reference docs

The system should automatically promote/demote context based on the current tool execution phase, rather than waiting for the token budget to overflow.

### R1: Tool Output Structured Truncation

When tool output is truncated, the model should receive structured metadata:

```json
{
  "truncated": true,
  "originalSize": 45000,
  "truncatedTo": 10000,
  "contentHint": "test output with 12 failures",
  "fullOutputPath": "/tmp/ax-code-truncated-abc123.txt"
}
```

This lets the LLM decide whether to re-read the full output or proceed with the truncated summary.

### R2: Tool Call Pre-Validation

Before sending tool calls to the LLM for execution, validate high-failure parameters:

- **Edit tool:** Check that `oldString` exists in the target file before execution
- **Bash tool:** Validate that referenced paths exist (when statically determinable)
- **Refactor apply:** Verify the plan is still fresh (graph cursor hasn't moved)

Failed pre-validation returns a structured guidance message instead of a runtime error, reducing wasted LLM turns.

### R3: Tool Error Pattern Learning

Track tool error patterns within a session:

- When the same error pattern recurs (e.g., edit `oldString` not found 3+ times), inject a proactive guidance prompt
- Pattern matching is heuristic-based, not LLM-based: string similarity on error messages, tool ID, and file path
- Patterns reset on session compaction to avoid stale guidance in new context windows

### R4: Import/Dependency Edge Ingestion

Complete the Phase 2 Code Intelligence gap:

- Parse TypeScript/JavaScript import statements and add edges to the graph
- Support `import`, `require()`, and dynamic `import()` patterns
- `findImports` and `findDependents` return real results
- Impact analysis includes file-level dependency blast radius

### R5: Language-Native Scanner Plugins

Extend Debug Engine scanners beyond JS/TS:

- **Rust:** Ingest `cargo clippy --all-targets --all-features` output as structured findings
- **Python:** Ingest `ruff check` and `mypy` output as structured findings
- Scanner plugins register as additional evidence sources for `register_finding`
- DRE hypothesis can cite language-native scanner findings alongside JS/TS scan results

### R6: Cross-Session Debug Pattern Memory

Store debug case summaries in a persistent pattern index:

- When a debug case is resolved (confirmed hypothesis), store a compact signature: problem description, root cause category, fix pattern, affected file patterns
- On new debug case open, query the pattern index for similar cases
- Similarity is heuristic: keyword overlap + file path similarity + error category match
- Patterns are stored in the existing session SQLite database, not a separate index

## Phases

## Gap Closure Plan

The first implementation pass landed useful helpers but did not close the runtime acceptance contract. Close the gaps in small, verifiable slices:

1. **P0: Phase 1/2 runtime closure**
   - Propagate structured truncation metadata from `Truncate.output()` through every tool wrapper path, including `originalSize`, `truncatedTo`, `contentHint`, and `fullOutputPath`.
   - Keep `outputPath` as a backward-compatible alias while exposing `fullOutputPath` for the PRD contract.
   - Narrow bash path pre-validation to arguments that are statically and semantically paths. Do not treat grep patterns, find predicates, numeric option values, or new `mv` destinations as missing paths.
   - Pass file path hints from tool input into `ToolErrorPatternTracker` so repeated edit failures can name the affected files.
   - Add focused regression tests for truncation metadata, bash false positives, and file path extraction.

2. **P1: Phase 3 compaction evidence**
   - Add a long-session compaction test proving Tier 3 tool results are compacted before Tier 1.
   - Keep context-tier metadata internal to compaction unless model-message metadata becomes necessary.

3. **P2: Phase 4 import/dependency correctness**
   - Make import edge ingestion order-insensitive by resolving pending file imports after each indexing batch or by creating file-level placeholder nodes.
   - Add tests for `import`, `require()`, and dynamic `import()` across a small TS/JS project.
   - Update `impact_analyze` to include file-level dependents once import edges are reliable.

4. **P3: Phase 5 scanner integration**
   - Expose language-native scans through a DRE tool or evidence source.
   - Map clippy/ruff/mypy findings to `register_finding`-compatible metadata.
   - Add graceful missing-tool tests plus parser tests with sample JSON outputs.

5. **P4: Phase 6 debug pattern memory**
   - Add a real migration for `debug_engine_pattern`.
   - Wire pattern storage to confirmed debug-case resolution.
   - Query pattern matches on debug-case open and emit a `debug_pattern_match` result.
   - Add storage/retrieval and false-positive guard tests.

### Phase 1: Tool Pre-Validation and Structured Truncation

**Intent:** Lowest-risk, highest-impact fixes that reduce wasted LLM turns immediately.

**Scope:**

- Add `oldString` existence check in edit tool before execution
- Add structured truncation metadata to `Truncate.output()` return type
- Update tool wrapper to include truncation metadata in tool result
- Add bash path existence pre-check for simple `cd`, `cat`, `rm` commands
- Tests for pre-validation paths and structured truncation output

**Acceptance:**

- Edit tool with non-existent `oldString` returns guidance instead of runtime error
- Truncated tool results include `originalSize`, `contentHint`, and `fullOutputPath`
- Existing edit tool tests remain green
- No new Effect usage

### Phase 2: Tool Error Pattern Detection

**Intent:** Reduce repeated tool errors within a session through heuristic pattern matching.

**Scope:**

- Add `ToolErrorPatternTracker` in session processor
- Track (toolID, errorMessage, filePath) tuples with occurrence count
- When count >= 3 within a session, inject guidance prompt into next tool result
- Pattern reset on compaction
- Tests for pattern detection threshold and compaction reset

**Acceptance:**

- Session test demonstrates guidance injection after 3 repeated edit failures
- Pattern tracker resets after compaction
- No impact on single-occurrence tool errors

### Phase 3: Proactive Context Tiering

**Intent:** Keep the LLM focused on relevant context without waiting for token overflow.

**Scope:**

- Add context tier classification to session message processor
- Tier 1: last 5 tool results, current file, active task
- Tier 2: symbols referenced in last 3 tool calls (resolved via CodeIntelligence)
- Tier 3: everything else (subject to compaction)
- Add `ContextTier` metadata to model messages
- Compaction prioritizes Tier 3 removal before Tier 2 before Tier 1
- Tests for tier classification and compaction priority

**Acceptance:**

- Long session test shows Tier 3 messages compacted before Tier 1
- Context tier metadata does not change model message content, only compaction priority
- Existing compaction tests remain green

### Phase 4: Import/Dependency Edge Ingestion

**Intent:** Complete the Code Intelligence Phase 2 gap for accurate impact analysis.

**Scope:**

- Add import edge parser for TypeScript/JavaScript files
- Support `import ... from '...'`, `require('...')`, dynamic `import('...')`
- Add edges to Code Intelligence graph during indexing
- Implement `findImports` and `findDependents` query methods
- Update `impact_analyze` to include file-level dependency edges
- Tests for import parsing and graph edge queries

**Acceptance:**

- `findImports` returns real import edges for a TS test project
- `findDependents` returns real dependent edges
- `impact_analyze` includes file-level dependencies in blast radius
- Indexing performance does not degrade beyond 10% for TS projects

### Phase 5: Language-Native Scanner Plugins

**Intent:** Extend Debug Engine value to Rust and Python projects.

**Scope:**

- Add `CargoClippyScanner` that runs `cargo clippy --all-targets --all-features -- -D warnings` and parses JSON output
- Add `RuffScanner` that runs `ruff check --output-format json` and parses results
- Add `MypyScanner` that runs `mypy --json-report` and parses results
- Scanner output maps to `register_finding` schema
- DRE hypothesis can cite language-native findings
- Tests for scanner output parsing

**Acceptance:**

- Rust workspace test project produces clippy findings through DRE
- Python test project produces ruff/mypy findings through DRE
- Scanner failures (missing tool, non-zero exit) are handled gracefully
- No changes to existing JS/TS scanner behavior

### Phase 6: Cross-Session Debug Pattern Memory

**Intent:** Enable the system to remember and suggest fixes for recurring bug patterns.

**Scope:**

- Add `debug_pattern` table to session SQLite database
- On debug case resolution (confirmed hypothesis), store compact pattern record
- On new debug case open, query for similar patterns (keyword overlap + file path similarity)
- Add `debug_pattern_match` tool result when similar patterns found
- TUI renders pattern match suggestions in debug activity
- Tests for pattern storage and retrieval

**Acceptance:**

- Resolved debug case creates a pattern record
- New debug case with similar problem returns pattern match suggestions
- Pattern matching does not false-positive on unrelated bugs
- Pattern storage does not grow unbounded (cap at 1000 patterns, LRU eviction)

### Phase 7: Prompt Loop Incremental Extraction (Optional)

**Intent:** Reduce session-level bugs by extracting the prompt loop into a state machine.

**Scope:**

- Extract `PromptLoopStateMachine` from `prompt.ts`
- States: `assess`, `subtask`, `compacting`, `context_overflow`, `normal`, `completing`
- Each state has explicit entry/exit conditions
- `prompt.ts` delegates to the state machine instead of inline while-true logic
- Tests for state transitions
- No change to user-facing behavior

**Acceptance:**

- All existing session tests pass with state machine backend
- State machine test covers all transition paths
- `prompt.ts` line count reduces by 40%+
- No regression in session behavior

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Context tiering changes compaction behavior unexpectedly | Start shadow-mode: classify tiers without changing compaction priority, verify behavior matches expectations before enabling |
| Import edge ingestion slows indexing | Batch edge insertion, stay under SQLite 999-parameter limit, measure before/after indexing time |
| Tool pre-validation adds latency | Pre-validation is synchronous file read; cap at 50ms timeout, skip on timeout |
| Language-native scanners require toolchain installation | Scanner gracefully skips when `cargo`/`ruff`/`mypy` not found; logs at info level |
| Cross-session pattern matching false positives | Similarity threshold starts high (0.7); suggestions are advisory, not auto-applied |
| Prompt loop extraction introduces regression | Keep existing while-true as fallback; state machine runs in parallel for one release before switching |

## Open Questions

- Should context tier classification be model-aware (different models have different context window sizes)?
- Should tool error patterns persist across sessions (via memory system) or reset per session?
- Should import edge ingestion support monorepo cross-package imports?
- Should language-native scanner output be stored as DebugEvidence or as separate Finding records?
- Should cross-session debug patterns be scoped to project or global?

## Initial Validation Commands

Run from `packages/ax-code`:

```sh
bun run test
bun run typecheck
```

For repo-level typecheck after wider changes:

```sh
pnpm typecheck
```

For Rust scanner validation (when Phase 5 is implemented):

```sh
cd crates && cargo clippy --all-targets --all-features -- -D warnings
```
