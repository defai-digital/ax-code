# BUGS — Systematic Bug Audit

**Original Scan Date:** 2026-04-05  
**Second Scan Date:** 2026-04-05  
**Second Scan Review Date:** 2026-04-05  
**Third Review Date:** 2026-04-05  
**Fourth Review Date:** 2026-04-05  
**Fifth Scan Date:** 2026-04-05  
**Sixth Scan Date:** 2026-04-05  
**Sixth Scan Review Date:** 2026-04-05  
**Seventh Scan Date:** 2026-04-05  
**Eighth Scan Date:** 2026-04-05  
**Ninth Scan Date:** 2026-04-06  
**Tenth Scan Date:** 2026-04-06  
**Eleventh Scan Date:** 2026-04-06  
**Twelfth Scan Date:** 2026-04-06  
**Twelfth Scan Review Date:** 2026-04-06  
**Scope:** `packages/ax-code/src`  
**Method:** 6+6+3+5+4+3+4 parallel scans — null/undefined access, race conditions, error handling, resource leaks, security, logic/type bugs, concurrency/state, plus unbounded maps, RegExp patterns, prototype pollution, parseInt/numeric, signal handling, encoding/Date, automated hardcode/dedup scans, deep targeted directory scans, SSRF redirect bypass verification, MCP transport lifecycle audit, config loading resilience, database schema integrity, config validation logic  
**Original Findings:** 33 (28 fixed, 3 invalid, 2 deferred) — BUG-03 resolved 2026-04-05  
**Second Scan Findings:** 19 (17 fixed, 2 invalid, 0 deferred) — BUG-49 resolved 2026-04-05  
**Third Review:** 4 TODO-scan findings (1 fixed, 1 duplicate of BUG-12, 2 out of scope)  
**Fifth Scan Findings:** 13 new reports (BUG-53 through BUG-65) — 13 fixed, 0 deferred  
**Sixth Scan Findings:** 17 new reports (BUG-66 through BUG-82) — 13 fixed, 3 invalid, 1 by design  
**Seventh Scan Findings:** 18 new reports (BUG-83 through BUG-100) — 14 fixed, 4 invalid/informational, 0 deferred  
**Eighth Scan Findings:** 18 new reports (BUG-101 through BUG-118) — 18 fixed, 0 invalid, 0 deferred  
**Ninth Scan Findings:** 28 new reports (BUG-119 through BUG-146) — 22 fixed, 6 invalid/by-design/informational  
**Ninth Scan Review Date:** 2026-04-06  
**Tenth Scan Findings:** 28 new reports (BUG-147 through BUG-174) — 15 fixed, 13 deferred/by-design/informational  
**Tenth Scan Review Date:** 2026-04-06  

**Eleventh Scan Findings:** 21 new reports (BUG-175 through BUG-195) — 14 fixed, 7 deferred/by-design/informational  
**Eleventh Scan Review Date:** 2026-04-06  

**Twelfth Scan Findings:** 25 raw findings (BUG-196 through BUG-205) — 10 novel, 1 duplicate, 4 previously fixed, 10 invalid after verification  

**Totals across all scans:** 205 findings — 167 fixed, 48 invalid/by-design/informational/deferred, 2 out-of-scope, 10 pending

---

## Twelfth Scan — Database Integrity, Config Logic, and Cross-Domain Audit (2026-04-06)

| # | Severity | File | Category | Description |
|---|----------|------|----------|-------------|
| 196 | **HIGH** | `config/config.ts:105` + `cli/cmd/providers.ts:336` | Security | Wellknown `auth.env` used as env var name without sanitization — allows setting `NODE_OPTIONS` via RCE |
| 197 | **HIGH** | `session/session.sql.ts:37` | Data Integrity | `session.workspace_id` missing FK to `workspace` table — orphaned references accumulate |
| 198 | **MEDIUM** | `session/index.ts:652-669` | Data Integrity | `Session.remove` only deletes immediate children, not grandchildren — orphaned sessions |
| 199 | **MEDIUM** | `debug-engine/query.ts:76-91` | Data Integrity | `upsertEmbedding` delete+insert without transaction — data loss window on crash |
| 200 | **MEDIUM** | `session/session.sql.ts:73` | Data Integrity | `part.session_id` missing FK to `session` — unlike `message.session_id` which has one |
| 201 | **LOW** | `config/paths.ts:118` | Logic Bug | `{env:VAR}` substitution treats `"0"` as empty string via `\|\|` instead of `??` |
| 202 | **MEDIUM** | `cli/cmd/github-agent/index.ts:1193-1196` | Error Handling | Swallowed error in PR existence check — can cause duplicate PRs |
| 203 | **LOW** | `cli/cmd/github-agent/index.ts:279-281` | Logic Bug | `isMock` true when `--token` provided without `--event` — `JSON.parse(undefined)` crash |
| 204 | **MEDIUM** | `file/watcher.ts:117-123` | Dead Code | Native watcher callback defined but never subscribed — only polling runs |
| 205 | **LOW** | `share/share-next.ts:64` | Logic Bug | `AX_CODE_DISABLE_SHARE` uses case-sensitive check, not in `Flag` namespace |

### Methodology — Twelfth Audit (4 scan groups + automated tools + verification)

1. **Null/undefined access** — sub-agent scan for unsafe `[0]` indexing after filter/find/split, `find()` without null guards, non-null assertions on uninitialized variables
2. **Error handling + logic bugs** — sub-agent scan for swallowed errors, fire-and-forget promises, wrong boolean logic, `||` vs `??` coercion, missing validation, error type handling
3. **Concurrency + race conditions** — sub-agent scan for shared mutable state, TOCTOU patterns, file system races, database race conditions, stale closures, missing cleanup
4. **Database integrity + config validation** — sub-agent scan for missing FK constraints, schema drift, read-modify-write outside transactions, migration issues, config merge/parsing bugs, env var handling, path resolution

Plus automated tools:
- `dedup_scan` (0 duplicate clusters found)
- `hardcode_scan` (500 files, 1513 findings — mostly false positives)
- Source code verification of all 25 raw findings against actual files

### Cross-Reference Against Prior Scans

25 raw findings were checked against all 195 prior bugs (BUG-01 through BUG-195):
- **10 NOVEL** — genuinely new bugs (BUG-196 through BUG-205)
- **1 DUPLICATE** — F9 maps to BUG-181 (same TOCTOU pattern)
- **4 FIXED** — F12→BUG-125, F19→BUG-165, F23→BUG-195, F25→BUG-58
- **10 INVALID** — 3 by design (ADR-004, intentional env var pattern, migration optimization), 3 factually incorrect (code_edge index exists, single SQL is atomic, loadFile reads any path), 2 JS single-threaded (cache race, stream listener auto-cleanup), 2 code doesn't exist at referenced location (finishReason, Instance.provide race)

### Key Findings

The most critical finding is **BUG-196** (env var name injection) — a security issue where a compromised well-known endpoint can set `NODE_OPTIONS` or any other env var via the `auth.env` field. This is a novel attack vector not covered by prior SSRF fixes (BUG-54, BUG-55).

The **database integrity cluster** (BUG-197, 198, 199, 200) reveals missing FK constraints and transaction boundaries in schema definitions. These are data integrity risks that accumulate over time as sessions, workspaces, and code intelligence nodes are created and deleted.

Twelfth scan findings reference `main` branch at current HEAD.

---

## Eleventh Scan — SSRF, MCP Lifecycle, and Cross-Domain Audit (2026-04-06)

| # | Severity | File | Category | Description |
|---|----------|------|----------|-------------|
| 175 | **HIGH** | `config/config.ts:125` | SSRF | Redirect bypass in well-known config fetch — `fetch()` follows redirects without re-validation |
| 176 | **HIGH** | `session/instruction.ts:159` | SSRF | Redirect bypass in instruction URL fetch — same pattern as BUG-175 |
| 177 | **MEDIUM** | `config/config.ts:131-133` | Error handling | Uncaught throw on well-known HTTP error crashes entire config loading |
| 178 | **HIGH** | `mcp/index.ts:408-471` | Resource leak | Non-OAuth remote MCP transport never closed on connection failure |
| 179 | **HIGH** | `mcp/index.ts:897-912` | Resource leak | startAuth client+transport leak when error is not UnauthorizedError |
| 180 | **MEDIUM** | `mcp/index.ts:1019-1023` | Resource leak | finishAuth deletes transport from map before re-add, unreachable on failure |
| 181 | **MEDIUM** | `server/routes/isolation.ts:73-80` | Race condition | TOCTOU on config file read-modify-write without file lock |
| 182 | **LOW** | `config/config.ts:575-582` | Config validation | loadMode() silently skips invalid configs (inconsistent with loadAgent) |
| 183 | **LOW** | `util/filelock.ts:34-36`, `code-intelligence/lockfile.ts:67-69` | Resource leak | File handle leak when writeFile throws between open and close |
| 184 | **LOW** | `server/server.ts:478-481` | CORS | Missing https://localhost and IPv6 loopback in CORS origin check |
| 185 | **MEDIUM** | `cli/cmd/tui/util/terminal.ts:43-46` | Logic bug | NaN >> 8 === 0 bypasses isFinite check in terminal color parser |
| 186 | **MEDIUM** | `mcp/index.ts:604-614` | Race condition | Connect lock defeated when concurrent calls read same prev before set |
| 187 | **MEDIUM** | `cli/cmd/github-agent/index.ts:1047,1049` | Logic bug | parseInt without NaN check on git rev-list output |
| 188 | **HIGH** | `code-intelligence/query.ts:50,274,402` | Null safety | DB query [0] returns undefined when no row matches, callers may not check |
| 189 | **HIGH** | `debug-engine/query.ts:33,103` | Null safety | Same [0] pattern in debug-engine query functions |
| 190 | **MEDIUM** | `context/analyzer.ts:205` | Null safety | Object.values({})[0] returns undefined for empty bin object |
| 191 | **MEDIUM** | `mcp/index.ts:136-148` | Error handling | MCP tool invocation has no error wrapping, raw SDK errors propagate |
| 192 | **MEDIUM** | `acp/agent.ts:159-165` | Error handling | Event subscription permanently dead after startup failure, no retry |
| 193 | **MEDIUM** | `provider/provider.ts:433,436-437` | Code smell | 5× ! assertions after filter that doesn't narrow in chained map |
| 194 | **LOW** | `mcp/index.ts:244-248` | Error handling | process.kill empty catch should be ESRCH-only |
| 195 | **MEDIUM** | `session/prompt.ts:720`, `session/processor.ts:460` | Error handling | Summarize failure leaves session without title permanently |

### Methodology — Eleventh Audit (3 scan groups + automated tools)

1. **Null safety + logic bugs** — sub-agent scan for unsafe [0] indexing, parseInt without NaN checks, NaN bitwise coercion, filter-then-map narrowing gaps, Object.values on potentially empty objects
2. **Error handling + resource leaks** — sub-agent scan for swallowed errors, fire-and-forget promises, resource leaks (file handles, network connections, transports), event subscription lifecycle, TOCTOU races on config files, MCP transport/client lifecycle
3. **Security + config loading** — sub-agent scan for SSRF redirect bypasses (re-verification of BUG-36/BUG-54/BUG-55 fixes), CORS origin completeness, config loading resilience, isolation config race conditions

Plus automated tools:
- `dedup_scan` (0 duplicate clusters found)
- `hardcode_scan` (500 files, 1490 findings — mostly false positives from class names/DB identifiers)
- `pnpm typecheck` (all packages clean)
- Source code verification of all high-severity findings against actual files

### Key Findings

The most critical cluster is **MCP resource leaks** (BUG-178, 179, 180) — three related bugs in `mcp/index.ts` where transport objects and their underlying TCP connections are leaked in various error paths. The pattern is consistent: the OAuth path properly stores transports in `pendingOAuthTransports`, but every non-OAuth error path leaks them.

The **SSRF redirect bypass** findings (BUG-175, 176) are variants of previously-fixed bugs. BUG-55 and BUG-54 added `Ssrf.assertPublicUrl()` to validate initial URLs, but the raw `fetch()` still follows redirects to unvalidated targets. The `Ssrf.pinnedFetch()` function (added in BUG-15) already solves this by resolving DNS once and connecting to the resolved IP, but `config.ts` and `instruction.ts` still use raw `fetch()`.

Eleventh scan findings reference `dev` branch at current HEAD.

---

## Tenth Scan — Deep Cross-Domain Audit (2026-04-06)

| Outcome | Count | Notes |
|---------|-------|-------|
| **Fixed** | 15 | Applied in fix/close-open-issues branch |
| **Deferred** | 7 | BUG-148, 149, 150, 152, 156, 157, 158 — require larger refactors or deeper analysis |
| **Informational** | 4 | BUG-153 (timing-safe compare overkill for local OAuth), 154 (structured logging already mitigates), 160 (editor temp file is short-lived), 167 (JSONC leading comments are rare) |
| **By design** | 2 | BUG-161 (regex cached + patterns are trusted), 162 (Effect framework handles defects) |

### Fixed (15) — reports removed

| # | File | Fix applied |
|---|------|-------------|
| 147 | `session/processor.ts:389` | Removed `\|\| undefined` — zero token totals now preserved as `0` |
| 151 | `sdk/programmatic.ts:744` | Already fixed in ninth scan — `Promise.allSettled` for tool registration |
| 155 | `mcp/index.ts:496-497` | MCP stderr logged as structured field instead of interpolated template |
| 163 | `cli/cmd/stats.ts:199-209` | Changed 9 occurrences of `\|\| 0` to `?? 0` |
| 164 | `config/config.ts:948-949` | Removed orphan `Filesystem.write` dead code lines |
| 165 | `provider/models.ts:103-108` | ENOENT logged at `debug` level; real errors still `warn` |
| 166 | `cli/cmd/github-agent/index.ts:187` | Replaced `exec()` with `execFile()` to prevent shell injection |
| 168 | `cli/boot.ts:82-86` | `uncaughtException` handler now exits process after 100ms flush |
| 169 | `mcp/index.ts:496` | Stderr log restructured (fix shared with BUG-155) |
| 171 | `server/routes/isolation.ts:72-75` | Validates parsed JSON is plain object before spreading |
| 172 | `util/wildcard.ts:58-68` | `matchSequence` uses index parameter instead of array slicing |
| 173 | `session/prompt.ts:1776` | Added 5-minute default timeout to `shell()` function |
| 174 | `server/server.ts:793` | Service name validated with max(64) + alphanumeric regex |
| 159 | `cli/cmd/github-agent/pr.ts:60-61` | Deferred — requires deeper GH CLI integration review |
| 170 | Multiple files | Deferred — requires audit of all `Filesystem.writeJson` call sites |

### Methodology — Tenth Audit (4 scan groups + automated tools)

1. **Type/logic edge cases** — sub-agent scan for `\|\|` vs `??` coercion, string split/join edge cases, array mutation during iteration, regex edge cases, template literal injection, type coercion, default parameter mutation, JSON.parse safety
2. **Async/error/resource** — sub-agent scan for `new Promise(async ...)` anti-pattern, TOCTOU cache races, `Promise.allSettled` result discarding, AbortController lifecycle, error re-throwing gaps, event listener accumulation, stream lifecycle, finally block side effects, missing await
3. **Security/encoding/process** — sub-agent scan for path traversal, prototype pollution, ReDoS, timing side-channels, process signal handling, child process injection beyond bash tool, file permissions, integer overflow, header injection, log injection (CRLF)
4. **Deep subsystem review** — sub-agent targeted scan of session/processor.ts, session/prompt.ts, session/correction/, tool/edit.ts, tool/apply_patch.ts, code-intelligence/builder.ts, code-intelligence/auto-index.ts, config/config.ts, config/migrate-tui-config.ts, effect/run-service.ts, control-plane/workspace-server/

Plus automated tools:
- `dedup_scan` (0 duplicate clusters found)
- `hardcode_scan` (500 files, 1473 findings — mostly false positives from class names/DB identifiers; real inline URLs/secrets already addressed in prior scans)

Tenth scan findings reference `dev` branch at current HEAD.

---

## Ninth Scan — Deep Multi-Domain Audit (2026-04-06)

| Outcome | Count | Notes |
|---------|-------|-------|
| **Fixed** | 22 | Applied in fix/close-open-issues branch |
| **Invalid** | 4 | BUG-128 (already fixed), BUG-132 (already has retry loop), BUG-139 (JS is single-threaded, no TOCTOU), BUG-144 (void catch is intentional unhandled-rejection guard) |
| **By design** | 1 | BUG-138 (fuzzy matching is intentional, uniqueness guard is the safety mechanism) |
| **Informational** | 1 | BUG-145 (as any[] in migration is low-risk, would require large refactor) |

### Fixed (22) — reports removed

| # | File | Fix applied |
|---|------|-------------|
| 119 | `planner/verification/index.ts:60-71,116-128` | Read stdout/stderr concurrently with `proc.exited` via `Promise.all` to prevent pipe deadlock |
| 120 | `sdk/programmatic.ts:510-514` | Check `currentText.startsWith(text)` before slicing; emit full text on non-append edits |
| 121 | `config/config.ts:824-830` | Replaced `Instance.dispose()` with `Instance.reload()` to avoid tearing down all state |
| 122 | `tool/multiedit.ts:50` | Changed `results.at(-1)!.output` to `results.at(-1)?.output ?? ""` |
| 123 | `tool/batch.ts:145` | Replaced `Promise.all` with `Promise.allSettled` with per-item error wrapping |
| 124 | `session/prompt-helpers.ts:135` | Replaced `Promise.all` with `Promise.allSettled` with `"<shell command failed>"` fallback |
| 125 | `auth/encryption.ts:156-159` | By-design (already addressed in earlier scan — `__needsReEncrypt` flag added for migration) |
| 126 | `server/routes/isolation.ts:72` | Added `log.warn()` in catch handler instead of silent swallow |
| 127 | `mcp/index.ts:603-611` | Added `.finally()` to delete settled entries from `connectLocks` Map |
| 129 | `storage/json-migration.ts:97-106` | Added `log.error()` on insert failure for diagnostics |
| 130 | `cli/boot.ts:151-157` | Changed `process.exit()` to `setTimeout(() => process.exit(), 500)` for cleanup window |
| 131 | `acp/agent.ts:1681` | Replaced `uri.slice(7)` with `new URL(uri).pathname` for proper file URI parsing |
| 133 | `tool/edit.ts:224-250` | Added single-line search case (`searchBlockSize === 1`), lowered guard to `< 1` |
| 134 | `tool/webfetch.ts:87` | Fixed off-by-one: `hop <= MAX_REDIRECTS` to `hop < MAX_REDIRECTS` |
| 135 | `session/llm.ts:82-91` | Skip rejoin normalization if plugin modified the system array (length changed) |
| 136 | `format/index.ts:112-121` | Added 30s timeout via `Promise.race` on formatter spawn |
| 137 | `session/prompt.ts:1828` | Changed `proc.on("close")` to `proc.once("close")` to prevent listener leak |
| 140 | `mcp/index.ts:666-730` | Added generation counter; skip cache write if invalidated during computation |
| 141 | `sdk/programmatic.ts:739` | Replaced `Promise.all` with `Promise.allSettled` for tool registration |
| 142 | `project/instance.ts:122,131` | Replaced `Promise.all` with `Promise.allSettled` in reload/dispose |
| 143 | `session/llm.ts:72-91` | Skip pushing empty string to system array when all prompt sources are empty |
| 146 | `cli/cmd/tui/util/clipboard.ts:94` | Changed `.catch(() => {})` to `.catch(() => "")` for proper string fallback |

### Methodology — Ninth Audit (5 scan groups + automated tools)

1. **Null/undefined access** — sub-agent scan for unsafe `!` assertions, array access without bounds checks, `.find()` without null guards, `Map.get()` without guards
2. **Error handling** — sub-agent scan for empty catch blocks, `Promise.all` cascade failures, silent error swallowing, missing validation
3. **Logic/type bugs** — sub-agent scan for off-by-one errors, boolean logic, type coercion, shared state mutation, dead code
4. **Resource leaks** — sub-agent scan for pipe deadlocks, event listener leaks, process spawn without timeout/cleanup, stream lifecycle
5. **Concurrency/state** — sub-agent scan for TOCTOU races, stale closures, unbounded Maps, fire-and-forget promises, shared mutable state

Plus automated tools:
- `dedup_scan` (0 duplicate clusters found)
- `hardcode_scan` (500 files, mostly false positives from class names/DB identifiers)

Ninth scan findings reference `dev` branch at current HEAD.

---

## Eighth Scan — Comprehensive Cross-Domain Audit (2026-04-05)

| Outcome | Count | Notes |
|---------|-------|-------|
| **Fixed** | 18 | Applied in v2.4.3 — `bun typecheck` clean |

### Fixed (18) — reports removed

| # | File | Fix applied |
|---|------|-------------|
| 101 | `share/share-next.ts:136` | `dispose()` now clears pending sync timeouts via `clearTimeout` and clears `queue`/`inflight` maps |
| 102 | `control-plane/workspace-server/server.ts:13` | Added 10s heartbeat `setInterval` to workspace SSE endpoint, matching the global SSE pattern |
| 103 | `tool/lsp.ts:69-93` | Added `default: return []` case to LSP operation switch — unrecognized operations return empty array |
| 104 | `cli/cmd/providers.ts:293` | Added `res.ok` check and `wellknown?.auth?.command` null guard before accessing well-known config |
| 105 | `stats/breakdown.ts:36` | Added `if (key === "default") continue` to skip the fallback key in partial match loop |
| 106 | `server/routes/session.ts:1023` | Added missing `await` on `Permission.reply()` call |
| 107 | `debug-engine/detect-hardcodes.ts:97` | Split quote counting into separate `dblQuotes` and `sglQuotes` — each checked independently for even parity |
| 108 | `session/llm.ts:254` | `resolveTools` now shallow-clones `input.tools` before mutation (`{ ...input.tools }`) |
| 109 | `session/prompt.ts:1305,1364` | Orphaned `new AbortController().signal` replaced with `AbortSignal.timeout(30_000)` for bounded lifetime |
| 110 | `cli/cmd/uninstall.ts:164,175` | Added `err instanceof Error ? err.message : String(err)` guards at both error sites |
| 111 | `lsp/server-defs.ts:900` | Early-return with error log when `jarFileName` is undefined/empty, before `path.join` with empty string |
| 112 | `util/rpc.ts:93` | Unsubscribe closure now looks up current `listeners.get(event)` instead of using captured local variable |
| 113 | `server/routes/tui.ts:384` | Added null check on `Session.get()` return — returns 404 for non-existent sessions |
| 114 | `provider/models.ts:125` | Added `res.ok` check and `AbortSignal.timeout(10_000)` to models URL fetch |
| 115 | `lsp/server-defs.ts` (14 locations) | All 14 LSP fetch calls now include `AbortSignal.timeout` — 30s for API calls, 60s for downloads |
| 116 | `tool/edit.ts:440` | Removed unreachable `\n` alternative from regex and dead `case "\n"` from switch |
| 117 | `control-plane/workspace-router-middleware.ts:22` | Replaced `as any` with proper `as WorkspaceID` branded type cast with explicit import |
| 118 | `worktree/index.ts:270` | Added atomic `fs.mkdir` after exists/show-ref checks; EEXIST triggers retry with new name |

### Methodology — Eighth Audit (3 scan groups + automated tools)

33. **Automated hardcode scan** — `hardcode_scan` tool across 500 files (mostly false positives from class names/DB identifiers)
34. **Automated dedup scan** — `dedup_scan` tool across 2000 symbols (0 duplicate clusters found)
35. **Deep null/unsafe patterns** — sub-agent scan for non-null assertions, Map.get() without guards, .find() without checks, optional chaining gaps, `as` type assertions
36. **Deep async/race/security** — sub-agent scan for floating promises, race conditions, missing abort signals, resource leaks, eval/exec patterns, process.exit in library code
37. **Deep logic/type/edge cases** — sub-agent scan for off-by-one, type coercion, regex issues, error handling, Promise.all misuse, switch fallthrough, mutable defaults, Date handling
38. **Remaining directory deep scan** — sub-agent targeted scan of server/routes/, session/llm.ts, session/summary.ts, session/correction/, cli/cmd/storage/, cli/cmd/debug/, cli/cmd/providers.ts, cli/cmd/run.ts, cli/cmd/context.ts, cli/cmd/tui/routes/, code-intelligence/query.ts, effect/, filesystem/, replay/, telemetry/, stats/, snapshot/, worktree/, mcp/auth.ts, mcp/oauth-provider.ts, plugin/, project/, pty/, isolation/

Eighth scan findings reference `dev` branch at current HEAD.

---

## Seventh Scan — Deep Pattern Audit (2026-04-05)

| Outcome | Count | Notes |
|---------|-------|-------|
| **Fixed** | 14 | Applied in v2.4.1 — `bun typecheck` clean; 572 tests pass across affected suites |
| **Invalid** | 3 | Reports were incorrect (83, 95) or informational/won't-fix (91) |
| **Duplicate** | 1 | BUG-97 had two report files for the same issue |

### Fixed (14) — reports removed

| # | File | Fix applied |
|---|------|-------------|
| 84 | `cli/cmd/github-agent/index.ts:1309,1437` | Added radix 10 to both `parseInt(c.databaseId)` calls and `Number.isNaN` guard so malformed IDs are excluded from comment lists instead of silently included. |
| 85 | `control-plane/sse.ts:75` | Replaced per-iteration `buf.search(/\r?\n\r?\n/)` regex with `indexOf("\n\n")` / `indexOf("\r\n\r\n")` lookups. Eliminates regex compilation overhead on every SSE event boundary. |
| 86 | `code-intelligence/auto-index.ts:100` | Added `MAX_STATE_ENTRIES = 64` cap on `stateByProject` Map. When exceeded, evicts the oldest idle entry. Prevents unbounded growth in long-running processes. |
| 87 | `code-intelligence/builder.ts:235` | `projectMutexes` entries now self-clean via `.then()` sentinel: when the chain settles and no newer operation replaced it, the entry is deleted. |
| 88 | `debug-engine/shadow-worktree.ts:62` | `releaseSlot` no longer deletes the gate when a waiter was just dequeued. The waiter's microtask needs the gate to increment `inFlight`; premature deletion could exceed `MAX_CONCURRENT_PER_PROJECT`. |
| 89 | `storage/storage.ts:141` | Migration version `parseInt` now uses radix 10 and returns 0 on `NaN`. Corrupted migration files no longer silently skip all migrations. |
| 90 | `lsp/server-defs.ts:865` | JDTLS Java version `parseInt(m[1])` now passes radix 10 for consistency. |
| 92 | `cli/cmd/tui/util/terminal.ts:82` | Added radix 10 and bounds check `index < 0 || index >= 16` to palette color parser. Out-of-range indices no longer extend the sparse array, which would prevent the 16-color early-exit condition from firing. |
| 93 | `memory/generator.ts:91,132` | Both `JSON.parse(package.json)` catch blocks now also tolerate `SyntaxError` alongside `ENOENT`. Malformed JSON (merge conflicts, truncation) no longer crashes memory generation. |
| 94 | `provider/models.ts:123` | `AX_CODE_MODELS_URL` now calls `Ssrf.assertPublicUrl()` before `fetch()`. Internal service probing via `http://169.254.169.254/...` is blocked. |
| 96 | `code-intelligence/index.ts:82` | Query ID switched from `Math.random().toString(36)` to `crypto.randomUUID()`. |
| 97 | `format/index.ts:125,132` | Removed `...item.environment` spread from both error log sites. Secrets configured as formatter env vars are no longer written to log files. |
| 98 | `lsp/server-defs.ts:1452` | texlab version `replace("v", "")` changed to anchored `replace(/^v/, "")` to match line 1001's pattern. |
| 99 | `shell/shell.ts:28-39` | `killTree` fallback path now wraps `proc.kill("SIGTERM")` and `proc.kill("SIGKILL")` in try/catch so `ESRCH` from a process that exited during the 200ms sleep is swallowed instead of propagating. |
| 100 | `config/config.ts:68-72` | `managedDir` constant replaced with `getManagedDir()` function that reads the env var on each call. Tests that set `AX_CODE_TEST_MANAGED_CONFIG_DIR` after import now take effect. |

### Invalid (3) — reports removed

| # | File | Why invalid |
|---|------|-------------|
| 83 | `mcp/oauth-provider.ts:104,116` | Report claimed mixed seconds/milliseconds units. Both lines consistently use `Date.now() / 1000` (converting ms to seconds). The `Math.floor` truncation is normal precision loss, not a unit mismatch. |
| 91 | `util/wildcard.ts:11` | Informational: regex cache uses FIFO instead of LRU. Functionally correct; the 500-entry cap means recompilation cost is negligible. Won't fix. |
| 95 | `provider/error.ts:55,82` | Report claimed numeric error codes are "silently dropped". Actually, the fallback path at line 75 returns `${msg}: ${e.responseBody}` which includes the full response body. Numeric codes are not lost. |

### Duplicate (1) — report removed

| # | File | Notes |
|---|------|-------|
| 97 (second file) | `format/index.ts:125,132` | `97-formatter-log-environment-secret-leak.md` was a duplicate of `97-format-log-environment-secret-leak.md`. Same issue, same fix. |

### Methodology — Seventh Audit (12 scans)

21. **Unbounded Map scan** — module-level Maps that grow without eviction or cleanup
22. **Floating promise scan** — async calls without `await`, `.then()`, `.catch()`, or `void` prefix
23. **RegExp pattern scan** — dynamic `new RegExp(userInput)`, missing flags, catastrophic backtracking, per-iteration compilation
24. **Prototype pollution scan** — `Object.assign`/spread with user-controlled keys, `JSON.parse` of untrusted input assigned to config
25. **Numeric conversion scan** — `parseInt` without radix, `NaN` propagation, `Number()` on nullable values, division by zero, bitwise on large numbers
26. **Process lifecycle scan** — signal handling, SIGTERM/SIGKILL race conditions, `process.exit()` in library code, subprocess cleanup
27. **Encoding/Date scan** — `atob`/`btoa` issues, `new Date()` timezone pitfalls, base64 edge cases
28. **Timer cleanup scan** — `setTimeout`/`setInterval` without `.unref()` or cleanup on disposal
29. **Error swallowing scan** — empty `catch {}` blocks, `catch (err: any)` patterns remaining
30. **JSON.parse safety scan** — untrusted input parsed without individual error handling
31. **Secret leakage scan** — structured log output containing env vars or credentials
32. **SSRF consistency scan** — `fetch()` calls not covered by existing SSRF guards

Seventh scan findings reference `dev` branch at current HEAD.

---

## Sixth Scan — Status After Review (2026-04-05)

| Outcome | Count | Notes |
|---------|-------|-------|
| **Fixed** | 13 | Applied in v2.3.14 — `bun typecheck` clean; 377 tests pass across affected suites (code-intelligence, storage, session, memory, util, config/paths, cli/index-graph) |
| **Invalid** | 3 | Reports were incorrect against current source |
| **By design** | 1 | Behavior is intentional with mitigations in place |

### Fixed (13) — reports removed

| # | File | Fix applied |
|---|------|-------------|
| 66 | `config/paths.ts` | `fs.realpath` catch now narrows to `ENOENT` only — every other errno (EACCES / ELOOP / EIO) fails closed with an `InvalidError` instead of silently falling back to the unresolved relative path. Closes the confinement-bypass attack where a broken symlink's unresolved form would `contains()`-pass against the configDir while the real target escaped. |
| 67 | `storage/storage.ts` | `list()` now strips the `.json` suffix via anchored regex (`.replace(/\.json$/, "")`) instead of hardcoded `.slice(0, -5)`. Short filenames and any future non-`.json` storage files no longer get mangled. |
| 68 | `session/processor.ts` | Doom-loop handler's `Agent.get(...)` now narrows to `agent?.permission ?? []`. An agent removed mid-session (via config reload) no longer crashes the whole processor pipeline with a `TypeError`; empty ruleset falls through to the default "ask" behavior. |
| 70 | `acp/agent.ts` | `cachedReadTokens` / `cachedWriteTokens` / `thoughtTokens` switched from `\|\|` to `??`. Legitimate zero counts are now reported to the ACP client as 0 instead of being coerced to `undefined`. |
| 72 | `session/prompt-helpers.ts` | `commandTemplate` now guards both ends of the arg index range (`arg < 0 \|\| arg >= args.length`). `$0` placeholder no longer produces `args[-1]` = undefined which would stringify to the literal `"undefined"` in the rendered template. |
| 73 | `memory/store.ts` | `clear()` now narrows its catch to `ENOENT` only — `EACCES` / `EBUSY` / `EIO` propagate so a caller that proceeds to start a "fresh" session can't silently leak stale memory through a failed delete. |
| 74 | `code-intelligence/lockfile.ts` | Post-steal retry catch in `tryAcquire()` now narrows to `EEXIST` (the only legitimate contention signal). Every other errno propagates so a disk-full or permissions failure after a successful steal can't silently return "no lock acquired" while the caller proceeds without the lock it thinks it holds. This was a self-report against the v2.3.13 lockfile — inconsistency between the initial attempt (already narrowed) and the retry (catch-all). |
| 75 | `worktree/index.ts` | `Project.addSandbox` failure now logs at warn level with the directory and error instead of silently swallowing. Orphaned worktrees can now be detected in logs; full rollback would risk losing partially-populated tree state so the safer mitigation is visibility. |
| 76 | `code-intelligence/builder.ts` | `LSP.references` failures inside the Phase 2 reference pass now log at warn level with file/symbol/line context AND increment a `referenceFailures` counter. If any reference query throws, the file's completeness flag downgrades to `"partial"` — the contract downstream consumers (findCallers / findReferences) use to know a file's edge set is untrustworthy. |
| 77 | `util/rpc.ts` | `Rpc.client` `call()` now has a 60s timeout per RPC plus a rejection path. `pending` map entries are cleaned up on both resolve and timeout, so a crashed worker no longer hangs caller promises forever or leaks the map unboundedly. |
| 79 | `planner/verification/index.ts` | Added `"error"` to the `VerificationStatus` union. Both `typecheck()` and `custom()` catch blocks now report process-level failures (spawn ENOENT, missing tsc binary, parse crashes) as `status: "error"` distinct from `status: "failed"` — the planner no longer conflates "your code has type errors" with "the typechecker isn't installed". |
| 80 | `storage/db.ts` | `effect()` catch now narrows to `Context.NotFound` (matching `use()` / `transaction()` patterns directly above it). Non-context errors propagate instead of silently falling through to non-transactional execution. |
| 82 | `session/revert.ts` | `revert!` non-null assertion inside the `.filter()` closure replaced by capturing `const narrowed = revert` before the closure. TypeScript's narrowing now survives across the closure boundary without an assertion that would become a real crash risk under future refactoring. |

### Invalid (3) — reports removed

| # | File | Why invalid |
|---|------|-------------|
| 69 | `server/routes/session.ts:125,415,485,524` | Report claimed `Session.get()` returns `undefined` for missing sessions, letting routes return 200-with-null or crash. Actual behavior: `Session.get` throws `NotFoundError` (see `src/session/index.ts:405-411`), which is caught by the global `app.onError` handler at `server/server.ts:428` and converted to HTTP 404. The routes are already correct. |
| 71 | `config/config.ts:438` (`rel()`) | Report claimed the implicit `undefined` return could propagate into string operations. Actual callers at lines 472 and 511 use `rel(item, patterns) ?? path.basename(item)` — the implicit undefined IS the signal, and the fallback is explicit. Intentional design. |
| 78 | `session/revert.ts:110` (ID comparison) | Report claimed lexicographic `<`/`>` on message IDs was "brittle if IDs vary in length". Actual ID generator (`src/id/id.ts:27-89`) produces fixed-length IDs: `LENGTH = 26` characters plus a shared `prefix + "_"` — every ID for a given prefix has byte-identical length. Lexicographic comparison is guaranteed correct by design. |

### By design (1) — report removed

| # | File | Reason |
|---|------|--------|
| 81 | `storage/storage.ts:55` / `project/project.ts:252` (project ID from lexicographic root sort) | For 99%+ of repos with a single root commit this is irrelevant. For multi-root repos (git-subtree, merge-unrelated-histories) the ID is derived from the set of root commits; different clones at the same point in history see the same set and produce the same ID. The only "non-determinism" is after history rewrites, which is inherent to any commit-based identification scheme. Additionally the resolved ID is cached in `.git/ax-code` (`project/project.ts:256`) so it's stable per-clone for the lifetime of that clone. Not worth the additional complexity of a timestamp-based tiebreaker. |

### Deferred cleanup of BUG-12

The v2.3.13 `IndexLock` (code-intelligence/lockfile.ts) proves the cross-process lockfile pattern end-to-end. BUG-12 (`Storage.update` cross-process race) remains deferred, but the `TODO(BUG-12)` comment in `storage/storage.ts:200` now points at the code-intelligence lockfile as the reference implementation to reuse when the fix lands. The natural next step is extracting that namespace into `util/lockfile.ts` and wiring it through `Storage.update`.

---

## Fifth Scan — Status After Review (2026-04-05)

| Outcome | Count | Notes |
|---------|-------|-------|
| **Fixed** | 13 | Applied; `bun typecheck` + tool/util/session/config/lsp/mcp/acp/code-intel/debug/share/storage/file suites green — 875 tests pass / 0 fail |

### Fixed (13) — reports removed

| # | File | Fix applied |
|---|------|-------------|
| 53 | `mcp/index.ts` | All 5 `e.message` on catch-`unknown` sites now route through `NamedError.message(e)`. Also corrected two log message labels that said "failed to get prompts" when they should have said "resources" / "read resource". |
| 54 | `session/instruction.ts` | Instruction URL fetches now call `Ssrf.assertPublicUrl()` before touching the network. A malicious project config referencing `http://169.254.169.254/...` no longer exfiltrates cloud metadata into the LLM system prompt. |
| 55 | `config/config.ts` | Well-known config fetches now call `Ssrf.assertPublicUrl()` on both primary and legacy endpoints before fetch. If an attacker can influence the auth URL, they can no longer pivot to internal services. |
| 56 | `tool/registry.ts` | Per-tool `try/catch` wraps each `tool.init()`; failing tools are logged and filtered out. One broken MCP tool no longer takes out every built-in tool. |
| 57 | `lsp/index.ts` | Per-client `.catch()` on LSP shutdown — matches the MCP shutdown pattern. One hung client no longer leaks the rest. |
| 58 | `share/share-next.ts` | Queue entries now kept until the POST succeeds; failures schedule a retry timer (5s backoff). Transient share-server errors no longer drop accumulated message/part deltas. |
| 59 | `acp/agent.ts` | Deferred `sessionUpdate` timer is now tracked in `pendingSessionUpdates`, cancelled on `dispose()`, and guards against the eventAbort signal before firing. Rapid create/close cycles no longer call sessionUpdate on a closed connection. |
| 60 | `session/message-v2.ts` | `toModelOutput` now explicitly excludes `null` before the `typeof === "object"` branch. Null LLM outputs fall through to the JSON fallback instead of producing `{ text: undefined }`. |
| 61 | `config/config.ts`, `session/processor.ts`, `memory/store.ts`, `cli/cmd/github-agent/index.ts` | All 4 `catch (err: any)` sites rewritten to `catch (err: unknown)` with appropriate `instanceof Error` type guards. |
| 62 | `tool/apply_patch.ts` (×3), `patch/index.ts` | `throw new Error(\`...: \${error}\`)` replaced with `error instanceof Error ? error.message : String(error)` — removes the "Error:" prefix on thrown Error instances and handles `[object Object]` fallthrough for thrown plain objects. `{ cause: error }` still preserved for stack trace consumers. |
| 63 | `worktree/index.ts` | Start-script timers tracked in `startScriptTimers` set, cancelled by `remove()` via new `cancelPendingStartScripts()` helper, and marked `.unref()` so they don't hold the event loop open. Rapid create→remove cycles no longer execute start scripts against deleted directories. |
| 64 | `server/server.ts` | Request middleware now validates the `directory` param: must be absolute, must exist, must be a directory — else returns 400. `process.cwd()` default path is trusted (no user input). Prevents `?directory=/etc` from silently becoming the containment root. |
| 65 | `config/paths.ts` | `{env:VAR}` substitution in untrusted configs now routes through `Env.sanitize` — same secret-pattern filter the bash tool uses. Project / well-known configs can no longer reference `{env:OPENAI_API_KEY}` and have the value substituted into LLM-facing text. Trusted configs (global, managed, AX_CODE_CONFIG, account) still resolve any env var — account configs specifically need this for `{env:AX_CODE_CONSOLE_TOKEN}`. Covered by 2 new tests in `test/config/config.test.ts`. |

### Shared infrastructure added

- **`src/util/ssrf.ts`** — new module. Extracts the private-IP / loopback / link-local / CGNAT / multicast range checks from `tool/webfetch.ts` into a shared `Ssrf.assertPublicUrl(url, label)` helper so config.ts, session/instruction.ts, and the webfetch tool can apply the exact same guard without circular imports. Fixes for BUG-54 and BUG-55 depend on this.

### Resource Leak Scan Note

The resource leak scan (separate from bug findings) found zero active leaks. Previously-fixed leaks remain documented with source comments in `util/log.ts:74-83` (file descriptor on `init()` re-entry) and `lsp/server-defs.ts:948-953` (mkdtemp on failed Java spawn).

### Account config trust re-scoped during review

My initial BUG-03 fix (round 1) marked account configs as `trusted: false` to prevent `{file:}` path traversal via a compromised console. The BUG-65 fix exposed the downside: account configs legitimately reference `{env:AX_CODE_CONSOLE_TOKEN}` as the canonical mechanism for the auth flow to thread the console token through to provider options. The env sanitizer strips any var matching a secret pattern (including `*_TOKEN`), so untrusted-mode account config broke the console integration.

Resolved by switching account configs back to `trusted: true`: the console is an authenticated upstream established by `ax-code auth login`, and a compromised console already has more powerful levers (model routing, tool permissions, MCP server install) than `{file:/etc/shadow}`. Project and well-known configs remain `trusted: false`.

---

## Second Scan — Status After Review

| Outcome | Count | Notes |
|---------|-------|-------|
| **Fixed** | 17 | Applied; `bun typecheck` + tool/session/code-intel/debug/acp/control-plane/config/lsp/file/storage/mcp/provider/share test suites green |
| **Invalid / By design** | 2 | 39 (slice logic is correct), 51 (helper contract is intentional) |
| **Deferred** | 0 | BUG-49 resolved with LRU cap on sessionBudgets |

### Fixed (17) — reports removed

| # | File | Fix applied |
|---|------|-------------|
| 34 | `tool/read.ts` | Added symlink realpath + containment check (scoped to paths inside project) |
| 35 | `mcp/index.ts` | Local MCP servers now use `Env.sanitize(process.env)` — no more API key leakage |
| 36 | `tool/webfetch.ts` | Manual redirect loop re-validates every hop via `assertPublicUrl` (max 10 hops) |
| 37 | `tool/grep.ts`, `tool/glob.ts` | Symlink realpath + containment check before search |
| 38 | `cli/cmd/tui/component/prompt/index.tsx` | Submission failures now surface via toast with the error message |
| 40 | `mcp/index.ts` | `tools()` now coalesces concurrent callers onto a single in-flight promise |
| 41 | `acp/agent.ts` | Diff apply wrapped in `FileTime.withLock` to match edit.ts/write.ts |
| 42 | `mcp/index.ts` | Per-name `connectLocks` map serializes concurrent `connect(name)` calls |
| 43 | `util/log.ts` | Added `stream.on('error', ...)` fallback to stderr on disk errors |
| 44 | `tool/apply_patch.ts` | All three `throw new Error(...)` sites now pass `{ cause: error }` |
| 45 | `provider/provider.ts` | `warmup()` logs the error at warn level instead of swallowing |
| 46 | `config/config.ts` | `disposeAll()` errors logged at error level during config reload |
| 47 | `lsp/server-defs.ts` | Archive cleanup moved to `finally` for Kotlin/Lua(×2)/Terraform installers |
| 48 | `util/log.ts` | `currentStream.end()` now awaited before the new stream is opened |
| 49 | `session/correction/index.ts` | LRU cap (MAX_SESSIONS=256) on `sessionBudgets` — old sessions evicted automatically in long-running processes |
| 50 | `share/share-next.ts` | Per-session `inflight` set prevents duplicate sync flushes during the async gap |
| 52 | `patch/index.ts`, `cli/cmd/debug/agent.ts`, `tool/exa-fetch.ts` | `throw new Error(...)` now includes `{ cause }` |

### Invalid (2) — reports removed

| # | File | Why invalid |
|---|------|-------------|
| 39 | `permission/index.ts:338` | `os.homedir() + pattern.slice(1)` is correct — homedir has no trailing slash, slice(1) keeps the `/` from `~/foo` for the concatenation. Other files use `slice(2)` because they call `path.join()` which re-adds the separator. |

### By design (1) — report retained

| # | File | Reason |
|---|------|--------|
| 51 | `effect/run-service.ts:11` | Helper contract is to propagate Effect errors as Promise rejections. Adding `.catch()` in the helper would silently swallow errors across every caller. Individual callers that need different behavior should add their own try/catch. |

---

## Third Review — TODO-scan findings (2026-04-05)

Four reports appeared during the third review pass. Outcomes:

| Report | Outcome | Notes |
|--------|---------|-------|
| `log-stream-write-after-end.md` | **Fixed** | `util/log.ts` write closure now checks `stream.writable` and swallows write callback errors to stderr — no more ERR_STREAM_WRITE_AFTER_END unhandled rejections during test teardown or worker reload. Logger methods call `write()` without awaiting, so a rejecting promise became an unhandled rejection; closed at the source. |
| `storage-cross-process-race.md` | **Duplicate** | Same issue as BUG-12 (already retained with `TODO(BUG-12)` marker in code). |
| `bash-tool-naming.md` | **Out of scope** | UX/naming concern, not a logic bug. Renaming would cascade through registry, permissions, docs, config schemas — requires a deliberate API-break decision. |
| `provider-k2p5-workaround.md` | **Out of scope** | TODO marker for upstream `models.dev` data inconsistency. The workaround is a deliberate data-layer fallback; proper fix is upstream data correction, not a code change here. |

---

## Original Audit — Status After Review

| Outcome | Count | Notes |
|---------|-------|-------|
| **Fixed** | 28 | Applied; `bun typecheck` + affected test suites green — BUG-03 resolved 2026-04-05 |
| **Invalid / Not a bug** | 3 | False positives from the original scan |
| **Deferred (now fixed)** | 2 | BUG-12 and BUG-15 resolved in v2.4.3 |

Fixed reports were removed from this folder after the fix landed.

## Original Fixed (28) — reports removed

| # | File | One-line summary |
|---|------|------------------|
| 01 | `session/prompt.ts` | Session shell leaked all env vars; now sanitized via `Env.sanitize` |
| 02 | `tool/write.ts`, `edit.ts`, `apply_patch.ts` | Added symlink realpath + containment check before write |
| 03 | `config/paths.ts`, `config/config.ts`, `config/tui.ts` | `{file:}` substitution now takes a `trusted` flag; project/remote/account configs are confined to their own config directory (absolute and `~/` paths rejected). Covered by 4 new tests in `test/config/config.test.ts`. |
| 04 | `code-intelligence/builder.ts` | Project-level mutex for `indexFile` to stop cross-file stale reads |
| 05 | `debug-engine/detect-duplicates.ts` | Skip symbols without signature instead of non-null asserting |
| 06 | `acp/session.ts`, `acp/agent.ts` | Explicit null check on SDK responses |
| 07 | `debug-engine/apply-safe-refactor.ts` | 5-minute timeout on spawned checks; SIGKILL on expiry |
| 08 | `tool/edit.ts` | BlockAnchor / ContextAware loops now start at `i+1` so 2-line blocks match |
| 09 | `debug-engine/analyze-bug.ts` | `walkCallers` returns `{ chain, truncated }` — no more false positives |
| 10 | `lsp/index.ts` | Per-client `.catch` wrapper so one failing LSP doesn't kill `run`/`runAll` |
| 14 | `session/instruction.ts` | Log warnings when instruction files / URLs fail to load |
| 16 | `util/filesystem.ts` | `contains()` now resolves both paths before comparison |
| 17 | `file/index.ts` | Image / binary read errors propagate instead of returning empty buffer |
| 18 | `mcp/index.ts` | `transport.close()` in local MCP connect failure path |
| 19 | `lsp/server-defs.ts` | JDTLS temp dir cleaned up on synchronous spawn failure |
| 21 | `tool/bash.ts` | Sanitization moved to shared `Env.sanitize`; added `GIT_CREDENTIAL_HELPER` to allowlist |
| 22 | `tool/webfetch.ts` | Scheme check moved inside `assertPublicUrl` for defense in depth |
| 23 | `context/analyzer.ts` | Removed TOCTOU `exists()` probe — catch already handles ENOENT |
| 24 | `control-plane/sse.ts` | Separated JSON.parse catch from onEvent catch |
| 25 | `session/prompt-helpers.ts` | `generateTitle` explicitly returns `undefined` on failure |
| 26 | `config/config.ts` | Log at debug when plugin resolution fails |
| 27 | `debug-engine/shadow-worktree.ts` | `git status --porcelain --no-renames` to avoid rename parsing bugs |
| 28 | `debug-engine/apply-safe-refactor.ts` | Removed dead `git apply -` call |
| 29 | `code-intelligence/builder.ts` | Added `failed` counter distinct from `skipped` |
| 30 | `mcp/index.ts` | `descendants()` now uses a `Set` for O(1) dedup |
| 31 | `util/log.ts` | Close previous write stream before opening a new one on re-init |
| 32 | `acp/agent.ts` | Loose `==` → strict `===` |
| 33 | `provider/transform.ts` | Narrow structural type for `providerOptions` instead of `as any` |

## Original Invalid (3) — reports removed

| # | File | Why invalid |
|---|------|-------------|
| 11 | `file/watcher.ts:126` | `busy` flag is safe — JS is single-threaded and there's no `await` between the check and set |
| 13 | `lsp/index.ts:278` | Already mitigated by the `spawning` map — only one `schedule()` runs per key |
| 20 | `permission/index.ts:203` | `Bus.publish` already catches subscriber errors internally; `void Bus.publish(...)` is safe |

## Original Deferred (2) — now fixed, reports removed

| # | File | Fix applied |
|---|------|-------------|
| 12 | `storage/storage.ts:193` | New `util/filelock.ts` provides cross-process advisory lock via O_EXCL atomic file creation with PID-based staleness detection. `Storage.update` now acquires both in-process and cross-process locks. |
| 15 | `tool/webfetch.ts`, `util/ssrf.ts` | New `Ssrf.pinnedFetch` resolves DNS once, validates all addresses, then rewrites the URL to use the resolved IP with the original Host header for TLS SNI — eliminates the DNS rebinding window. |

---

## Methodology

### Original Audit (6 scans)
1. **Null/undefined access scan** — searched for unsafe `!` assertions, array access without bounds checks, and optional chaining gaps across 500+ files
2. **Race condition scan** — identified TOCTOU patterns, shared state without locks, concurrent async operations, and promise-chain gaps
3. **Error handling scan** — found silent `.catch(() => {})` patterns, fire-and-forget promises, overly broad catches, and error information loss
4. **Resource leak scan** — checked child process lifecycle, file handle cleanup, event listener management, timer/interval cleanup, and temp file management
5. **Security scan** — analyzed command injection, path traversal, SSRF, secret exposure, and access control patterns
6. **Logic/type bug scan** — searched for off-by-one errors, comparison issues, Promise.all misuse, type coercion, and code smells

### Second Audit (8 scans)
7. **Hardcoded value scan** — automated scan for magic numbers, inline URLs, inline paths, and high-entropy secret-like strings
8. **Duplicate code scan** — structural and semantic deduplication analysis across all functions/methods
9. **Deep null/undefined access** — focused on array `[0]` after `.filter()`, `.find()` results, `Map.get()` without checks
10. **Deep race condition** — TOCTOU, shared mutable state without synchronization, stale closures, promise ordering
11. **Deep error handling** — swallowed errors, cause chain loss, missing validation, Effect error propagation
12. **Deep logic/type** — off-by-one in `.slice()`, boolean logic, type coercion, regex correctness
13. **Deep resource leak** — WriteStream error handlers, temp file cleanup, stream drain, timer cleanup
14. **Deep security** — symlink traversal gaps across all tools, MCP env sanitization, SSRF redirect bypass

Original findings reference `dev` branch at commit `d2c02d8`.  
Second scan findings reference `dev` branch at commit `5533f16`.  
Fifth scan findings reference `dev` branch at current HEAD.

### Fifth Audit (6 scans)
15. **Null/undefined access** — `Map.get()` without guard, array `[0]` after `.filter()`, non-null assertions on potentially null values
16. **Async/race conditions** — fire-and-forget `setTimeout`, `Promise.all` without per-item error handling, stale closures, data loss windows
17. **Error handling** — `e.message` on `unknown`, `catch (err: any)`, error stringified as `[object Object]`, silent returns
18. **Resource leaks** — file handles, child processes, event listeners, timers, temp dirs, DB connections, servers, AbortControllers
19. **Security** — SSRF bypasses in instruction URLs and well-known config fetch, server directory parameter without validation, `{env:VAR}` secret leakage
20. **Logic/type bugs** — `typeof null === "object"` without null guard, implicit undefined returns, off-by-one edge cases
