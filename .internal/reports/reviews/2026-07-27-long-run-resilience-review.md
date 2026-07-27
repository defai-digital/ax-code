# Long-Run Resilience Review — 72h to Multi-Week Operation

**Date:** 2026-07-27  
**Revised:** 2026-07-27 (anchor fact-check + long-run feature map)  
**Scope:** Can ax-code / ax-engine run very long-running tasks (72 hours → weeks)?  
**Method:** Static review of durability, supervisory, leak, and recovery mechanisms + deterministic scanner output (`lifecycle_scan`, `race_scan`). Scanner scans were partial (file-cap hit); treat counts as lower bounds, not complete inventories.

## Headline verdict

A single long **interactive** session will mostly survive **up to the product’s intentional 72h super-long ceiling**. **Unattended multi-week scheduled execution will NOT work as-shipped** — it requires an external process supervisor (systemd / launchd / pm2) that does not exist as a first-class product artifact in the repository today.

## Long-run product machinery (do not ignore)

These are first-class long-run features and must be part of any 72h→weeks assessment:

| Mechanism | Role | Anchor |
|---|---|---|
| **SuperLongPolicy** | Hard ceiling `MAX_DURATION_MS = 72h`; duration clamp; pacing grace for marathon tail | `session/super-long-policy.ts:6,36` |
| **SuperLongRuntime / prompt-super-long** | Touch run state; enforce deadline stop during agent loop | `session/super-long-runtime.ts`, `session/prompt-super-long.ts` |
| **SessionRetry** | Product-owned retries (`RETRY_MAX_ATTEMPTS = 5`), permanent-error detection, Retry-After, network circuit | `session/retry.ts` |
| **Provider maxRetries = 0** | AI SDK default (2) is **disabled** so SessionRetry owns retry policy | `provider/provider-impl.ts:776-782` |
| **LLM stream idle watchdog** | Idle abort when no stream chunk arrives | `session/llm-impl.ts:392-399,600-640` |
| **Tool/shell timeouts** | bash max 600s; shell defaults; AbortSignal on several prompt helpers | `tool/bash-impl.ts`, `session/prompt-shell-command.ts` |
| **SessionRecurring (loop mode)** | Server-side recurring session prompts (ADR-050); timers live with session backend | `session/recurring.ts`, ADR-050 |
| **ScheduledTask (core)** | SQLite-backed schedules + in-process poller | `session/scheduled-task.ts` |
| **Desktop scheduled-tasks runtime** | Separate Express-side scheduler (cron-parser, concurrency, `DEFAULT_MAX_RUN_MS = 30m`) | `desktop/packages/web/server/lib/scheduled-tasks/runtime.js` |

**Implication:** “72h interactive” is an intentional product design point (super-long ceiling), not an accident of durability alone. “Weeks unattended” is a different problem class (process lifetime + scheduler durability + catch-up).

## Per-dimension verdict

| Dimension | Status | Evidence | 72h | Weeks |
|---|:---:|---|:---:|:---:|
| Session durability | ✅ | Messages → SQLite; replay/fork/compact under `session/` + `runtime/` | ✅ | ✅ |
| Context growth (compaction) | ✅ | Auto-compaction on token budget in `session/prompt-loop-compaction.ts` (~230 LOC) | ✅ | ✅ |
| Super-long deadline / pacing | ✅ | 72h ceiling + deadline enforcement + pacing grace | ✅ | ⚠️ ceiling is 72h |
| Provider / session retry | ✅ | `SessionRetry` (5 attempts) + `error.ts` retryable classification; SDK `maxRetries` forced to **0** | ✅ | ⚠️ |
| LLM stream idle watchdog | ✅ | Idle abort in `llm-impl.ts` | ✅ | ⚠️ |
| Tool-level timeouts | ✅ | bash/shell and several AbortSignal paths | ✅ | ⚠️ |
| ax-engine local server lifecycle | ✅ | PID-liveness + cmdline validation + SIGTERM→SIGKILL + port reuse in `provider/ax-engine/server.ts` | ✅ | ✅ |
| Rust mutex-poisoning recovery | ✅ | BUG-277 in `crates/ax-code-daemon/src/daemon.rs:165-168,189-195` | ✅ | ✅ |
| Scheduled-task persistence (core) | ✅ | SQLite + atomic conditional claim in `session/scheduled-task.ts:435-478` | ✅ | ✅ |
| Loop mode (recurring prompts) | ⚠️ | In-memory registry + timers in process (`session/recurring.ts`); dies with process | ✅ | ❌ |
| Desktop scheduled-tasks path | ⚠️ | Separate runtime with max-run and concurrency; still process-bound | ✅ | ❌ |
| Scheduled-task catch-up (core) | ❌ | Advances to next future run (`nextRunAt(schedule, now+1)`) — missed runs stay missed | — | ❌ |
| Process supervisor / auto-restart | ❌ | **None** as product artifact. `ax-code-daemon` is a file-scanner, not a supervisor | ⚠️ | ❌ |
| Scheduler fires while app closed | ❌ | In-process `setInterval(...).unref()` in `scheduled-task.ts:505-506` — does not keep Node alive | — | ❌ |
| Agent-loop **executor** stall watchdog | ❌ | No heartbeat/timeout in `task-queue-executor-impl.ts` (1061 LOC) — **gap above** tool/LLM timeouts | ⚠️ | ❌ |
| Timer / child-process cleanup | ⚠️ | `lifecycle_scan`: 125 findings (partial, 800-file cap); many are static false positives — see below | ⚠️ | ⚠️ |
| Async race safety (long-run) | ⚠️ | `race_scan`: 63 findings (partial); provider cache “TOCTOU” may be intentional single-flight — verify with tests | ⚠️ | ⚠️ |
| Map growth hygiene | ⚠️ | Rough `.set` vs `.delete` balance is a weak proxy only | ⚠️ | ⚠️ |
| Token/credential refresh on expiry | ⚠️ | `provider/auth.ts`, `account/repo.ts` exist; proactive long-window refresh not verified | ⚠️ | ❓ |

## What actually fails at scale

### 1. Crash = dead (P0 blocker for unattended operation)

No supervisor restarts the process. OOM, uncaught exception, OS reboot, or closed terminal ends everything: scheduler, in-progress agent loop, managed ax-engine server. **This is the #1 blocker for unattended weeks-long operation.**

`crates/ax-code-daemon` is a Unix-socket file-scanner (`daemon.rs` scan/glob/status), not a process supervisor. It reports uptime for its own scan process only.

### 2. Scheduled tasks silently skip while the process is down

A daily 09:00 task is **not** OS cron — it only fires if the Node process is running at 09:00. On next boot the core scheduler reschedules to the *next* occurrence; the missed run is gone (no catch-up policy).

Evidence: `packages/ax-code/src/session/scheduled-task.ts:435-456` — `runDue()` claims with `next = nextRunAt(task.schedule, now + 1)` and advances `next_run_at`. There is no `runMissed` / `catchUp` option.

Desktop’s scheduled-tasks runtime (`desktop/packages/web/server/lib/scheduled-tasks/runtime.js`) is a second process-bound scheduler with its own max-run (default 30 minutes). It does not solve host-process death either.

### 3. Lifecycle findings need triage (do not “fix the highlighted list” blindly)

`lifecycle_scan` returned **125 findings** (partial — file-cap hit). Earlier draft anchors labeled as “leaked `setInterval` without `clear`” were **incorrect** on inspection:

| Prior citation | Actual behavior |
|---|---|
| `cli/boot.ts:128,142` | `setTimeout` for forced exit / `scheduleForcedExit` after uncaught exception (intentional; often `.unref()`) |
| `cli/boot-node.ts:36,57` | Same forced-exit pattern |
| `account/index.ts` retry path | Backoff `setTimeout` inside fetch retry |
| `mcp/discovery.ts` port check | Socket connect timeout, not a process-lifetime interval |
| `sdk/programmatic-impl.ts` keep-alive | Promise keep-alive; prior 100ms polling was **removed** |
| `session/task-queue-executor-impl.ts:214` | `setTimeout(0)` to detach queue work safely |

**Still true at a product level:** long-run processes should audit real leaked intervals, un-killed `child_process.spawn` sites (LSP, debug-engine, shell-env, format, control-plane SSE), and shutdown hooks. Re-run scanners and manually triage before filing bugs.

### 4. No executor-level stall detection (tool/LLM layers partially compensate)

If a **task-queue item** or non-timeouted path hangs, `task-queue-executor-impl.ts` has no heartbeat / max-duration / stall strings (0 hits across 1061 LOC).

This is **not** “the whole agent stack has no timeouts”:

- LLM streaming has an idle watchdog (`llm-impl.ts`)
- bash/shell tools have timeouts
- super-long has a wall-clock deadline

What is missing is a **queue/executor-level** watchdog and alerting when those lower layers do not apply.

### 5. `initScheduler` uses `.unref()`

The core scheduler does **not** keep Node alive (`scheduled-task.ts:505-506`). A headless scheduled-only process can exit at idle and silently kill future firings.

### 6. Race conditions — investigate, do not auto-mutex

`race_scan` returned **63 findings** (partial). Material candidates for long-run multi-task workloads:

- `models` / `modelPending` caches in `provider/provider-impl.ts` (~1094-1145) — code comments claim intentional single-flight (no await between pending check and registration). Static “TOCTOU” may be a **false positive**; confirm with a concurrency test before adding locks.
- `cliBinaryCache` in `provider/loaders.ts` (~337-365) — same promise-map single-flight pattern.

Single interactive session over 72h: low exposure. Multi-week concurrent scheduled tasks: worth tests.

## Recommendations

| Priority | Fix | Effort | Anchor |
|---|---|:---:|---|
| P0 | Ship an external supervisor story (systemd unit / launchd plist / pm2 example + docs) that restarts on crash and keeps the process alive | S | new packaging/docs |
| P0 | Make the scheduler a durable runner (separate process or OS cron invoking `ax-code run`), **or** document keep-alive requirements and reconsider `.unref()` for headless scheduled mode | M | `session/scheduled-task.ts:505-506` |
| P1 | Catch-up policy option (`runMissed` / `runOnceOnBoot`) for core scheduled tasks | S | `session/scheduled-task.ts:435-456` |
| P1 | Executor-level stall watchdog in `task-queue-executor-impl.ts` (heartbeat + max-duration per task), composing with existing tool/LLM timeouts | M | `session/task-queue-executor-impl.ts` |
| P1 | Align desktop scheduled-tasks runtime with the same durability/catch-up story | M | `desktop/.../scheduled-tasks/runtime.js` |
| P2 | Re-triage lifecycle_scan findings; fix real interval leaks and spawn-without-kill paths (ignore forced-exit/backoff false positives) | M | scanner re-run |
| P2 | Add concurrency tests for provider model-cache single-flight; fix only if races reproduce | S | `provider/provider-impl.ts`, `provider/loaders.ts` |
| P3 | Verify token refresh fires proactively before expiry (not only lazily on 401) | S | `provider/auth.ts`, `account/repo.ts` |
| P3 | Document super-long 72h ceiling vs multi-week expectations in user-facing ops docs | S | `super-long-policy.ts`, product docs |

## Scanner evidence summary

- `lifecycle_scan`: 125 findings (partial — 800-file cap hit); severity labels from scanner; **highlights require manual triage** (several prior “setInterval leak” anchors were wrong)
- `race_scan`: 63 findings (partial — 800-file cap hit); mostly medium; high TOCTOU on provider caches may be intentional single-flight
- `hardcode_scan`, `security_scan`: not run for this review (out of scope)

## Conclusion

For interactive developer use, v7.4.0 is robust enough for multi-day sessions and has intentional **super-long (≤72h)** machinery, stream idle watchdogs, SessionRetry, and tool timeouts.

For autonomous multi-week operation, the missing pieces remain **process supervision (P0)**, **scheduler durability / keep-alive (P0)**, **catch-up policy (P1)**, and **executor stall detection (P1)**. None require re-architecture — they are additive — but they are not optional if “weeks unattended” is a product claim.

## Revision notes (2026-07-27)

- Corrected provider retry story: product sets `maxRetries: 0` and uses `SessionRetry`, not SDK default 2.
- Added SuperLongPolicy (72h ceiling), loop mode, LLM idle watchdog, tool timeouts, desktop scheduler.
- Softened “no stall detection” to executor-level gap.
- Removed false-positive “leaked setInterval” remediation list; documented actual code at those lines.
- Softened provider-cache TOCTOU to “verify with tests.”
- Marked scanner results as partial lower bounds.
