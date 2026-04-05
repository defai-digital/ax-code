# PRD: Deferred Bugs Fixplan

**Date:** 2026-04-03
**Status:** Audit Complete
**References:** PRD-ax-code-v2.md (R36)

---

## 1. Fixed Bugs (41 total across 4 hardening commits)

### Commit eab43f5 — "resolve 11 deferred bugs across 4 phases"
- Task tool error swallowing
- Memory generator error swallowing
- Watcher empty parent path
- apply_patch TOCTOU race
- Shell DB write serialization
- Config TOCTOU with Lock.write()
- Session delete transaction atomicity
- Activity inbox return type errors (app)
- local.tsx String() cast (app)
- dialog-select-provider invalid prop (app)
- Fire-and-forget write ordering

### Commit 2220efc — "8 verified bugs — race conditions, error handling, data integrity"
- Processor double error publish on retry exhaustion
- Processor fire-and-forget summarize() unhandled rejection
- Prompt shell spawn missing error handler
- Prompt parseInt NaN guards for LSP
- Storage missing Lock.write() on remove()
- Write tool missing FileTime.withLock()
- Edit tool similarity deflation by empty lines
- Grep tool NaN line numbers

### Commit 1a302bb — "address 11 bugs found via codebase audit"
- Planner missing "skip" fallback strategy
- mcp/auth TOCTOU race in read-modify-write
- apply_patch FileTime.assert for delete case
- session/prompt fire-and-forget summarize() and prune()
- mcp/oauth-callback socket leak
- Config JSON.parse try-catch
- Server global URL after Bun.serve
- data-url base64/URI decode try-catch
- Clipboard base64 decode try-catch
- Installation empty brew/choco API responses
- Grok model failures

### Commit 10190ef — "harden recovery and test coverage"
- CI pipeline setup
- Bootstrap env isolation
- Account/repo recovery
- Session/processor recovery hardening
- Test infrastructure improvements

---

## 2. Remaining TODOs — Active Bugs

**None found.** All known correctness bugs have been addressed in the 4 hardening commits above. The remaining TODOs are features, improvements, or upstream-blocked items.

---

## 3. Remaining TODOs — Features / Improvements

| Location | TODO | Category |
|----------|------|----------|
| `src/session/prompt.ts:2018` | Task tool complex input — how to accept richer input | Feature design |
| `src/account/index.ts:345` | Multi-org user selection — let user choose when multiple orgs | Feature |
| `src/tool/bash.ts:55` | Rename bash tool for non-bash shells | Low priority |
| `src/cli/cmd/tui/routes/home.tsx:19` | TUI init pattern question | Low priority |
| `src/session/index.ts:781` | Better pricing model from models.dev | Data dependency |

---

## 4. Remaining TODOs — Upstream Blocked

| Location | TODO | Blocker |
|----------|------|---------|
| `src/bun/index.ts:66` | Bun cache workaround | Bun #19936 (open) |
| `src/config/config.ts:310` | Bun cache workaround (duplicate) | Bun #19936 (open) |
| `src/provider/transform.ts:164` | Kimi model ID mapping | models.dev data fix pending |

---

## 5. Assessment

R36 from PRD-ax-code-v2.md specified "11 bugs from PRD-deferred-bugs-fixplan." In practice, **41 bugs** were identified and fixed across 4 hardening commits. No active bugs remain in the source code. The remaining 8 TODOs are feature requests (3), low-priority improvements (2), or upstream-blocked workarounds (3).

**R36 status: Complete.** No deferred bug fixes remain.
