/**
 * Bounded-run lifecycle for the headless `run` command: the --timeout timer,
 * the SIGINT/SIGTERM handlers, the shared abort signal threaded into every
 * SDK call, the single-writer guard for the terminal stdout line, and the
 * terminal exit-code precedence live here so the once-only guards and the
 * precedence rule (1 > 130 > 124 > 3) are unit-testable without a server.
 *
 * Guarantees:
 * - The timeout handler is a no-op once the run has settled (`settle()`), so
 *   a timer that fires just after `execute` finished can never overwrite a
 *   successful exit code or re-abort a completed session (F2).
 * - The abort signal is only aborted after the server abort request has been
 *   issued (`onServerAbort`), and the server abort request itself never
 *   carries this signal (the caller gives it a short independent timeout so
 *   it cannot hang either) (F11).
 * - The abort request is recorded (`recordServerAbort`) and the terminal
 *   path — plus every handler return path — awaits its delivery
 *   (`awaitServerAbort`) before reporting timeout/cancelled: a
 *   fire-and-forget request loses the race with process teardown and can
 *   leave the generation running. The wait is bounded by the request's own
 *   short timeout and never rejects (F13).
 * - A pre-session timeout or signal commits the run's terminal outcome
 *   itself — one early result line for stream formats (status "timeout" /
 *   "cancelled"), one stderr notice in text mode, terminal guard set — and
 *   cuts the pending SDK calls through the shared signal instead of being
 *   silently ignored (F3).
 * - Exactly one terminal stdout line per run: once `markTerminal()` ran
 *   (a result or error line was written), the flag makes every other writer
 *   log-only, and a rejection racing the teardown can neither add a second
 *   terminal line nor flip the committed exit code.
 * - After a post-session timeout or signal requested the server abort, an
 *   unref'd last-resort exit bound is armed so a wedged fetch or SSE read
 *   cannot keep the process alive past it; `settle()` clears it on normal
 *   shutdown.
 */

/**
 * Upper bound for the server-abort request and for awaiting its delivery: the
 * request carries `AbortSignal.timeout(this)` (F11) and a terminal catch, so
 * it settles — delivered or failed — within this bound no matter what the
 * server does.
 */
export const RUN_SERVER_ABORT_BOUND_MS = 5000

/**
 * Delay before the last-resort process exit after a server abort was
 * requested: the terminal path first awaits the abort's delivery, which may
 * legitimately hold it for up to {@link RUN_SERVER_ABORT_BOUND_MS}, so the
 * bound must not fire into that wait — abort bound plus the teardown margin.
 */
export const RUN_LAST_RESORT_EXIT_DELAY_MS = RUN_SERVER_ABORT_BOUND_MS + 5000

export type RunLifecycle = {
  /** Shared abort signal for every SDK call of the run. */
  signal: AbortSignal
  timedOut(): boolean
  cancelled(): boolean
  /** True once `settle()` ran: the run body finished and the timer is disarmed. */
  settled(): boolean
  /** Marks the run body as finished; disarms the timer and neuters the timeout handler. */
  settle(): void
  /** Arms the --timeout timer (no-op when no timeout was requested). */
  arm(): void
  /** Clears the --timeout timer. */
  disarm(): void
  /** Marks the session as resolved: timeout/signal now route through the server abort. */
  markSession(): void
  /** SIGINT/SIGTERM handler; register with `process.once` as before. */
  onSignal: () => void
  /** Records the in-flight server abort request so `awaitServerAbort()` can wait for its delivery. */
  recordServerAbort(request: Promise<void>): void
  /**
   * Resolves once the recorded server abort request settled (delivered,
   * failed, or past its own bound); never rejects and never waits past
   * {@link RUN_SERVER_ABORT_BOUND_MS}. Returns immediately when no abort
   * was issued.
   */
  awaitServerAbort(): Promise<void>
  /** True once the run's terminal stdout line (result or error) was written. */
  terminal(): boolean
  /** Records that the terminal line was written; every later writer becomes log-only. */
  markTerminal(): void
  /** Terminal exit code by precedence: error 1 > cancel 130 > timeout 124 > blocked 3; undefined is success. */
  exitCode(input: { failed: boolean; blocked: boolean }): number | undefined
}

export function createRunLifecycle(input: {
  timeoutSeconds?: number
  isStream: boolean
  /** Text-mode stderr notice for a timeout; called only when `isStream` is false. */
  onTimeoutNotice?: () => void
  /** Text-mode stderr notice for a pre-session cancel; called only when `isStream` is false. */
  onCancelNotice?: () => void
  /**
   * Emits the terminal early result for stream consumers (pre-session
   * timeout/signal only); the status distinguishes "timeout" from "cancelled".
   */
  onEarlyResult: (status: "timeout" | "cancelled") => void
  /** Issues the server-side session abort; the request must carry its own short timeout signal, not this lifecycle's. */
  onServerAbort: (reason: "timeout" | "cancelled") => void
}): RunLifecycle {
  const controller = new AbortController()
  let timedOut = false
  let cancelled = false
  let settledFlag = false
  let hasSession = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let terminalFlag = false
  let lastResortTimer: ReturnType<typeof setTimeout> | undefined
  let pendingServerAbort: Promise<void> | undefined

  const markTerminalFlag = () => {
    terminalFlag = true
  }

  const armLastResortExit = () => {
    if (lastResortTimer !== undefined) return
    lastResortTimer = setTimeout(() => {
      process.exit(process.exitCode ?? 1)
    }, RUN_LAST_RESORT_EXIT_DELAY_MS)
    lastResortTimer.unref?.()
  }

  const clearLastResortExit = () => {
    if (lastResortTimer === undefined) return
    clearTimeout(lastResortTimer)
    lastResortTimer = undefined
  }

  const fireTimeout = () => {
    // F2: a run that already settled keeps its result and exit code.
    if (settledFlag || timedOut) return
    // Single-writer: a pre-session signal may have committed the terminal
    // outcome already (early cancelled result, exit 130). A later timeout
    // firing adds no second terminal line, no notice, and no exit-code
    // flip — only the pending-call cut, which is idempotent here.
    if (!hasSession && terminalFlag) {
      timedOut = true
      controller.abort()
      return
    }
    timedOut = true
    // Cancellation has higher precedence and already requested the server
    // abort. Keep its exit code and original delivery promise while teardown
    // is still waiting; a second request could outlive the awaited one.
    if (cancelled) return
    process.exitCode = 124
    if (!input.isStream && !terminalFlag) input.onTimeoutNotice?.()
    if (hasSession) {
      // Post-session: ask the server to abort the running generation first
      // (the request carries its own short timeout and is recorded so the
      // terminal path can await its delivery, F13), then cut the pending
      // SDK calls so a black-holed server cannot keep the process alive.
      // The last-resort bound covers a fetch or SSE read that ignores the
      // abort signal and wedges the teardown past it; it is long enough to
      // never fire into the awaited abort delivery itself.
      input.onServerAbort("timeout")
      armLastResortExit()
      controller.abort()
      return
    }
    // Pre-session timeout: there is no session to abort server-side yet.
    // The run commits its terminal outcome now — the caller's callback
    // writes the terminal result (stream formats) — so later terminal
    // writers (early errors, the result emission, the failure converter)
    // are log-only from here on. Then cut the pending SDK calls.
    markTerminalFlag()
    if (input.isStream) input.onEarlyResult("timeout")
    controller.abort()
  }

  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cancelled: () => cancelled,
    settled: () => settledFlag,
    settle() {
      settledFlag = true
      if (timer) clearTimeout(timer)
      timer = undefined
      // Normal shutdown: the run body finished inside the bound, so the
      // last-resort exit must not fire into the ordinary teardown.
      clearLastResortExit()
    },
    arm() {
      if (input.timeoutSeconds === undefined || timer) return
      timer = setTimeout(fireTimeout, input.timeoutSeconds * 1000)
    },
    disarm() {
      if (timer) clearTimeout(timer)
      timer = undefined
    },
    markSession() {
      hasSession = true
    },
    recordServerAbort(request) {
      pendingServerAbort = request
    },
    async awaitServerAbort() {
      const pending = pendingServerAbort
      if (pending === undefined) return
      // F13: the request settles on its own — it carries
      // AbortSignal.timeout(RUN_SERVER_ABORT_BOUND_MS) (F11) and a terminal
      // catch — so awaiting it is bounded. The race below only guards the
      // terminal path against a regression that would leave a
      // never-settling promise holding the run open forever; the bound timer
      // is cleared as soon as the request settles, so the happy path keeps
      // nothing pending.
      let bound: ReturnType<typeof setTimeout> | undefined
      try {
        await new Promise<void>((resolve) => {
          bound = setTimeout(resolve, RUN_SERVER_ABORT_BOUND_MS)
          bound.unref?.()
          void pending.then(
            () => resolve(),
            () => resolve(),
          )
        })
      } finally {
        if (bound !== undefined) clearTimeout(bound)
      }
    },
    terminal: () => terminalFlag,
    markTerminal: markTerminalFlag,
    onSignal() {
      // Idempotent like fireTimeout: a second signal (SIGINT then SIGTERM —
      // the two `process.once` registrations share this handler — or a direct
      // double call) must not write a second terminal line, flip the exit
      // code again, or issue a second server abort.
      if (settledFlag || cancelled) return
      // Single-writer: a pre-session --timeout may have committed the
      // terminal outcome already (early timeout result, exit 124). A later
      // signal adds no second terminal line, no notice, and no exit-code
      // flip — only the pending-call cut, which is idempotent here.
      if (!hasSession && terminalFlag) {
        cancelled = true
        controller.abort()
        return
      }
      cancelled = true
      process.exitCode = 130
      // Upgrade a pending timeout to cancellation without replacing its
      // in-flight server abort or restarting the last-resort deadline.
      if (timedOut) return
      if (hasSession) {
        // Same ordering as the timeout: server abort first (own signal),
        // then cut the pending SDK calls (F11), with the same last-resort
        // bound against a wedged fetch or SSE read.
        input.onServerAbort("cancelled")
        armLastResortExit()
        controller.abort()
        return
      }
      // Pre-session signal: there is no session to abort server-side yet, so
      // — exactly like the pre-session timeout — the run commits its terminal
      // outcome now: the caller's callback writes the terminal result with
      // status "cancelled" (stream formats) or one stderr notice (text mode),
      // and the terminal guard makes every later writer log-only. Then cut
      // the pending SDK calls; the rejection is swallowed by the
      // handler-level conversion (cancelled + committed outcome) and exit
      // 130 stands.
      markTerminalFlag()
      if (input.isStream) input.onEarlyResult("cancelled")
      else input.onCancelNotice?.()
      controller.abort()
    },
    exitCode({ failed, blocked }) {
      if (failed) return 1
      if (cancelled) return 130
      if (timedOut) return 124
      if (blocked) return 3
      return undefined
    },
  }
}
