"use strict"

// Unified, dependency-injected supervision FSM for child processes owned by
// the Electron main process (SPEC-2026-08-29-desktop-process-model-collapse
// §4). One instance supervises one process: the web-server utilityProcess and
// (S2.5a) the ax-code runtime process. The FSM owns all supervision state
// (phase, restart budget, backoff/stability/boot/stop timers); the injected
// driver owns the actual process handle and OS calls, so unit tests run
// deterministically with a fake clock and a fake driver.
//
// States: idle → resolving → spawning → booting → healthy → degraded →
// restarting → exhausted → stopping → stopped. `resolving` is a pass-through
// for drivers that need asynchronous pre-spawn resolution (binary path,
// version check); the web-server driver resolves synchronously. `degraded`
// is entered when a healthy process is lost (exit or health-probe failure)
// and immediately yields to `restarting`.
//
// Driver contract:
//   spawn(wire, context) -> handle | Promise<handle>   (context = { restart, attempt })
//     Synchronous drivers return the handle directly; asynchronous drivers
//     (e.g. spawn + stdout parsing) return a promise. The FSM stays in
//     `spawning` until the promise settles, then enters `booting`. A rejected
//     spawn promise is a boot failure on the same path as wire.failed. If the
//     promise settles after the attempt was abandoned (stop, boot timeout,
//     newer attempt), the FSM terminates the late handle so no process is
//     orphaned — unless it already reported wire.ready.
//     The driver MUST route process events back through `wire`:
//       wire.ready(info)          — the process reported readiness (boot success)
//       wire.failed(error)        — the process reported a boot error (still alive)
//       wire.exited(code, signal) — the process exited (exactly once per handle);
//                                   code may be null when killed by a signal
//     Events from stale (replaced/killed) attempts are ignored by the FSM.
//   terminate(handle)               — force-kill (boot timeout, wedged probe)
//   gracefulStop(handle, { termTimeoutMs, killTimeoutMs }) -> Promise
//     Graceful stop with SIGTERM/SIGKILL escalation; resolves when gone.
//
// Optional boot readiness probing (S2.5a; former policy B of SPEC §4): when
// `readiness: { maxAttempts, baseDelayMs, capDelayMs, probe(handle) }` is
// configured, the driver may omit wire.ready entirely — after spawn the FSM
// runs up to maxAttempts probes while `booting`, with an exponential delay of
// min(baseDelayMs * 2^(n-1), capDelayMs) between attempts n and n+1. The first
// success transitions to `healthy` with the handle as the ready info;
// exhaustion is a boot failure that counts against the crash budget. A
// wire.ready arriving first cancels probing (drivers may use either style).
// bootTimeoutMs still bounds the whole boot window, so drivers enabling
// readiness must size it to fit the probe schedule.
//
// All delays go through the injected clock ({ setTimeout, clearTimeout, now }),
// and every state change is emitted as a structured event to `onEvent` so
// diagnostics can consume them.
//
// Busy-session restart grace (optional probe config): when the liveness probe
// reaches maxConsecutiveFailures but `probe.shouldDeferRestart()` returns
// true, the wedged kill is deferred and the probe cycle re-arms (event
// "restart-deferred"). Deferral is capped by `probe.deferralGraceMs`
// (default 2 min) measured from the first deferral of the streak; once the
// grace expires the kill proceeds regardless. A probe success resets the
// streak.

const { createServerRestartPolicy, shouldRecoverAfterServerExit } = require("./server-restart-policy")

const DEFAULT_POLICY = {
  maxCrashRestarts: 5,
  stabilityWindowMs: 60_000,
  backoffBaseMs: 500,
  backoffCapMs: 5_000,
  bootTimeoutMs: 30_000,
  stopTermTimeoutMs: 5_000,
  stopKillTimeoutMs: 3_000,
}

function clampPositiveInteger(value, fallback) {
  return Number.isInteger(value) && value >= 0 ? value : fallback
}

function normalizePolicy(policy = {}) {
  return {
    maxCrashRestarts: clampPositiveInteger(policy.maxCrashRestarts, DEFAULT_POLICY.maxCrashRestarts),
    stabilityWindowMs: clampPositiveInteger(policy.stabilityWindowMs, DEFAULT_POLICY.stabilityWindowMs),
    backoffBaseMs: clampPositiveInteger(policy.backoffBaseMs, DEFAULT_POLICY.backoffBaseMs),
    backoffCapMs: clampPositiveInteger(policy.backoffCapMs, DEFAULT_POLICY.backoffCapMs),
    bootTimeoutMs: clampPositiveInteger(policy.bootTimeoutMs, DEFAULT_POLICY.bootTimeoutMs),
    stopTermTimeoutMs: clampPositiveInteger(policy.stopTermTimeoutMs, DEFAULT_POLICY.stopTermTimeoutMs),
    stopKillTimeoutMs: clampPositiveInteger(policy.stopKillTimeoutMs, DEFAULT_POLICY.stopKillTimeoutMs),
  }
}

function computeBackoffMs(attempt, policy) {
  return Math.min(policy.backoffBaseMs * 2 ** (attempt - 1), policy.backoffCapMs)
}

function toError(value, fallbackMessage) {
  if (value instanceof Error) return value
  if (typeof value === "string" && value) return new Error(value)
  return new Error(fallbackMessage || "unknown supervision error")
}

// Default stale-busy grace for the busy-session restart deferral (former web
// lifecycle policy, lifecycle.js shouldSkipRestartForBusySessions): while the
// probe says the process is wedged but sessions are still busy, the wedged
// kill is deferred; once deferrals have continued for this long, the kill
// proceeds regardless (a stuck busy flag must not pin a dead process forever).
const DEFAULT_PROBE_DEFERRAL_GRACE_MS = 2 * 60 * 1000

// The probe config is validated eagerly: a missing/invalid interval or
// timeout would otherwise collapse into a ~1 ms hot probe loop.
function normalizeProbe(probe) {
  if (probe == null) return null
  if (typeof probe.check !== "function") {
    throw new TypeError("supervision FSM probe requires a check(handle) function")
  }
  for (const key of ["intervalMs", "timeoutMs", "maxConsecutiveFailures"]) {
    if (!Number.isInteger(probe[key]) || probe[key] <= 0) {
      throw new TypeError(`supervision FSM probe requires ${key} to be a positive integer`)
    }
  }
  if (probe.shouldDeferRestart != null && typeof probe.shouldDeferRestart !== "function") {
    throw new TypeError("supervision FSM probe shouldDeferRestart must be a function when provided")
  }
  const deferralGraceMs = probe.deferralGraceMs == null ? DEFAULT_PROBE_DEFERRAL_GRACE_MS : probe.deferralGraceMs
  if (!Number.isInteger(deferralGraceMs) || deferralGraceMs <= 0) {
    throw new TypeError("supervision FSM probe deferralGraceMs must be a positive integer when provided")
  }
  return { ...probe, deferralGraceMs }
}

// Same eager-validation rationale as normalizeProbe, for the boot readiness
// schedule: an invalid delay would turn boot into a hot probe loop.
function normalizeReadiness(readiness) {
  if (readiness == null) return null
  if (typeof readiness.probe !== "function") {
    throw new TypeError("supervision FSM readiness requires a probe(handle) function")
  }
  for (const key of ["maxAttempts", "baseDelayMs", "capDelayMs"]) {
    if (!Number.isInteger(readiness[key]) || readiness[key] <= 0) {
      throw new TypeError(`supervision FSM readiness requires ${key} to be a positive integer`)
    }
  }
  return readiness
}

function computeReadinessDelayMs(attemptNumber, readiness) {
  return Math.min(readiness.baseDelayMs * 2 ** (attemptNumber - 1), readiness.capDelayMs)
}

function createSupervisionFsm(options = {}) {
  const label = typeof options.label === "string" && options.label ? options.label : "process"
  const policy = normalizePolicy(options.policy)
  const driver = options.driver
  if (!driver || typeof driver.spawn !== "function") {
    throw new TypeError("supervision FSM requires a driver with a spawn(wire, context) function")
  }
  if (typeof driver.terminate !== "function") {
    throw new TypeError("supervision FSM requires a driver with a terminate(handle) function")
  }
  if (typeof driver.gracefulStop !== "function") {
    throw new TypeError("supervision FSM requires a driver with a gracefulStop(handle, timeouts) function")
  }

  const clock = options.clock || {}
  const setTimer = typeof clock.setTimeout === "function" ? clock.setTimeout : setTimeout
  const clearTimer = typeof clock.clearTimeout === "function" ? clock.clearTimeout : clearTimeout
  const now = typeof clock.now === "function" ? clock.now : Date.now
  const onEvent = typeof options.onEvent === "function" ? options.onEvent : () => {}
  const onRecovered = typeof options.onRecovered === "function" ? options.onRecovered : null
  const onExhausted = typeof options.onExhausted === "function" ? options.onExhausted : null
  const probe = normalizeProbe(options.probe)
  const readiness = normalizeReadiness(options.readiness)

  const restartPolicy = createServerRestartPolicy({ maxRestarts: policy.maxCrashRestarts })

  let state = "idle"
  // The current spawn attempt: { id, handle, settled, becameReady, restart }.
  // Kept after a failed attempt (until exit/stop/next spawn) so a later
  // stop() can still gracefully stop a handle the FSM already gave up on.
  let attempt = null
  let attemptSeq = 0
  let bootTimer = null
  let backoffTimer = null
  let stabilityTimer = null
  let probeTimer = null
  let probeFailures = 0
  // First time the current wedged-kill deferral streak began (busy-session
  // grace). Reset on probe success, stop, and when the kill finally proceeds.
  let probeDeferralStartedAt = null
  let readinessTimer = null
  let startSettlement = null
  let stopPromise = null
  let lastError = null
  // Last exit observed for the current attempt ({ code, signal }); fed into
  // the exhausted payload so diagnostics see why the process actually died.
  let lastExit = null

  function emit(event) {
    const full = { label, at: now(), ...event }
    try {
      onEvent(full)
    } catch (error) {
      // A throwing listener must not wedge the FSM mid-transition. Report it
      // through the callback-error path exactly once; if that listener also
      // throws, swallow rather than recurse forever.
      if (event.type === "callback-error") return
      try {
        onEvent({ label, at: now(), type: "callback-error", callback: "onEvent", error: toError(error).message })
      } catch {
        // The callback-error listener threw as well; drop the error.
      }
    }
  }

  function transition(to, context = {}) {
    const event = { type: "state-change", from: state, to, ...context }
    state = to
    emit(event)
  }

  function unref(timer) {
    if (timer && typeof timer.unref === "function") timer.unref()
  }

  function clearBootTimer() {
    if (bootTimer) {
      clearTimer(bootTimer)
      bootTimer = null
    }
  }

  function clearBackoffTimer() {
    if (backoffTimer) {
      clearTimer(backoffTimer)
      backoffTimer = null
    }
  }

  function clearStabilityTimer() {
    if (stabilityTimer) {
      clearTimer(stabilityTimer)
      stabilityTimer = null
    }
  }

  function stopProbe() {
    if (probeTimer) {
      clearTimer(probeTimer)
      probeTimer = null
    }
    probeFailures = 0
    probeDeferralStartedAt = null
  }

  function clearReadinessTimer() {
    if (readinessTimer) {
      clearTimer(readinessTimer)
      readinessTimer = null
    }
  }

  function isStopping() {
    return state === "stopping" || state === "stopped"
  }

  function safeTerminate(handle) {
    if (!handle) return
    try {
      driver.terminate(handle)
    } catch {
      // The process may already be gone; a failed kill must not corrupt the FSM.
    }
  }

  function settleStart(error, info) {
    const settlement = startSettlement
    startSettlement = null
    if (!settlement) return
    if (error) settlement.reject(error)
    else settlement.resolve(info)
  }

  function notifyCallback(callback, callbackName, args) {
    try {
      const result = callback(...args)
      if (result && typeof result.catch === "function") {
        result.catch((error) => {
          emit({ type: "callback-error", callback: callbackName, error: toError(error).message })
        })
      }
    } catch (error) {
      emit({ type: "callback-error", callback: callbackName, error: toError(error).message })
    }
  }

  function scheduleStabilityReset() {
    clearStabilityTimer()
    stabilityTimer = setTimer(() => {
      stabilityTimer = null
      restartPolicy.markStable()
      emit({ type: "stability-reset", crashRestarts: restartPolicy.crashRestarts })
    }, policy.stabilityWindowMs)
    unref(stabilityTimer)
  }

  function startProbe() {
    if (!probe || probeTimer) return
    probeFailures = 0
    probeTimer = setTimer(runProbe, probe.intervalMs)
    unref(probeTimer)
  }

  async function runProbe() {
    probeTimer = null
    if (state !== "healthy" || !attempt) return
    const handle = attempt.handle
    let timeoutTimer = null
    let ok = false
    try {
      ok = await Promise.race([
        Promise.resolve()
          .then(() => probe.check(handle))
          .then(
            // A probe fails by resolving falsy, rejecting, or timing out.
            (result) => Boolean(result),
            () => false,
          ),
        new Promise((resolve) => {
          timeoutTimer = setTimer(() => resolve(false), probe.timeoutMs)
        }),
      ])
    } finally {
      if (timeoutTimer) clearTimer(timeoutTimer)
    }
    // A crash/stop may have changed the state while the probe was in flight.
    if (state !== "healthy" || !attempt) return
    if (ok) {
      probeFailures = 0
      probeDeferralStartedAt = null
    } else {
      probeFailures += 1
      emit({ type: "health-probe-failed", consecutiveFailures: probeFailures })
      if (probeFailures >= probe.maxConsecutiveFailures) {
        // Busy-session restart grace (former web lifecycle policy): while the
        // injected hook reports active sessions, defer the wedged kill and
        // re-arm the probe cycle — a busy server can fail health checks under
        // load without being dead. Deferral is capped by the stale-busy grace
        // (probe.deferralGraceMs, default 2 min) measured from the FIRST
        // deferral of this streak; afterwards the kill proceeds regardless.
        if (typeof probe.shouldDeferRestart === "function" && probe.shouldDeferRestart()) {
          const at = now()
          if (probeDeferralStartedAt === null) probeDeferralStartedAt = at
          if (at - probeDeferralStartedAt < probe.deferralGraceMs) {
            emit({
              type: "restart-deferred",
              consecutiveFailures: probeFailures,
              deferralStartedAt: probeDeferralStartedAt,
            })
            probeTimer = setTimer(runProbe, probe.intervalMs)
            unref(probeTimer)
            return
          }
        }
        probeDeferralStartedAt = null
        // Wedged process: kill it and run the normal crash-recovery path.
        // Its exit event is ignored (attempt is detached) and the restart
        // counts against the crash budget like any other recovery.
        const wedged = attempt
        attempt = null
        clearStabilityTimer()
        lastError = new Error(`${label} process failed ${probeFailures} consecutive health probes`)
        // Symmetric with the exit-recovery branch: drop probe bookkeeping
        // (also resets the failure streak) before restarting.
        stopProbe()
        transition("degraded", { reason: "health-probe" })
        safeTerminate(wedged.handle)
        transition("restarting")
        scheduleNextAttempt(0)
        return
      }
    }
    probeTimer = setTimer(runProbe, probe.intervalMs)
    unref(probeTimer)
  }

  // Boot readiness probing (optional config): runs only while the attempt is
  // unsettled in `booting`, so a wire.ready/wire.failed/exit/stop arriving
  // first cancels the loop via the attempt/settled guards.
  function runReadinessProbe(current, attemptNumber) {
    if (attempt !== current || current.settled) return
    Promise.resolve()
      .then(() => readiness.probe(current.handle))
      .then(
        (result) => ({ ok: Boolean(result), error: undefined }),
        (error) => ({ ok: false, error: toError(error, `${label} readiness probe failed`).message }),
      )
      .then(({ ok, error }) => {
        if (attempt !== current || current.settled) return
        if (ok) {
          // wire.ready semantics with the handle as the ready info, so the
          // start() settlement / healthy event carry what the driver spawned.
          handleReady(current, current.handle)
          return
        }
        emit({ type: "readiness-probe-failed", attempt: attemptNumber, maxAttempts: readiness.maxAttempts, error })
        if (attemptNumber >= readiness.maxAttempts) {
          // Exhaustion is a boot failure: it counts against the crash budget
          // like any other failed boot (SPEC §4), and the not-ready process
          // is terminated like a boot-timeout kill.
          handleBootFailure(current, new Error(`${label} process failed ${attemptNumber} readiness probes`), {
            terminate: true,
          })
          return
        }
        readinessTimer = setTimer(
          () => {
            readinessTimer = null
            runReadinessProbe(current, attemptNumber + 1)
          },
          computeReadinessDelayMs(attemptNumber, readiness),
        )
        unref(readinessTimer)
      })
  }

  // After a failed restart attempt (or immediately after a crash, with
  // delayMs 0), wait, then consume budget and spawn the next attempt. The
  // budget check runs when the timer fires — including after the final
  // allowed attempt's backoff — so exhaustion timing matches the former
  // hand-rolled loop exactly.
  function scheduleNextAttempt(delayMs) {
    clearBackoffTimer()
    backoffTimer = setTimer(() => {
      backoffTimer = null
      if (isStopping()) return
      if (!restartPolicy.beginRestart()) {
        // The exhausted event / onExhausted context carries the last observed
        // exit ({ exitCode, exitSignal }, either may be undefined) alongside
        // the error. Driver-level diagnostics (binary path, version) are
        // attached by the supervisor module that owns the driver.
        const context = {
          crashRestarts: restartPolicy.crashRestarts,
          exitCode: lastExit ? lastExit.code : undefined,
          exitSignal: lastExit ? lastExit.signal : undefined,
        }
        transition("exhausted", {
          ...context,
          error: lastError ? lastError.message : undefined,
        })
        if (onExhausted) {
          notifyCallback(onExhausted, "onExhausted", [
            lastError || new Error(`${label} process exited unexpectedly`),
            context,
          ])
        }
        return
      }
      spawnAttempt({ restart: true })
    }, delayMs)
  }

  function handleFailedAttempt(current, error) {
    if (!current.restart) {
      // Initial start failure: the caller of start() owns the retry (matching
      // the former launchServer contract); the crash budget is untouched.
      transition("idle", { error: error.message })
      settleStart(error)
      return
    }
    const failedAttempt = restartPolicy.crashRestarts
    const backoffMs = computeBackoffMs(failedAttempt, policy)
    transition("restarting", { attempt: failedAttempt })
    emit({ type: "restart-backoff", attempt: failedAttempt, backoffMs, error: error.message })
    scheduleNextAttempt(backoffMs)
  }

  function handleBootFailure(current, error, { terminate }) {
    if (attempt !== current || current.settled) return
    current.settled = true
    clearBootTimer()
    clearReadinessTimer()
    restartPolicy.completeRestart()
    if (terminate) safeTerminate(current.handle)
    lastError = error
    if (isStopping()) return
    handleFailedAttempt(current, error)
  }

  function handleReady(current, info) {
    if (attempt !== current || current.settled) return
    current.settled = true
    current.becameReady = true
    clearBootTimer()
    clearReadinessTimer()
    restartPolicy.completeRestart()
    const wasRestart = current.restart
    transition("healthy", { info })
    scheduleStabilityReset()
    startProbe()
    settleStart(null, info)
    if (wasRestart && onRecovered) notifyCallback(onRecovered, "onRecovered", [info])
  }

  function handleExit(current, code, signal) {
    if (attempt !== current) return // stale exit from a replaced/killed process
    lastExit = { code, signal }
    if (!current.settled) {
      current.settled = true
      clearBootTimer()
      clearReadinessTimer()
      restartPolicy.completeRestart()
      attempt = null
      // A signal-killed process exits with code null; name the signal when
      // the wire event carries one, otherwise admit the code is unknown.
      const exitDescription = signal
        ? `signal ${signal}`
        : Number.isInteger(code)
          ? `code ${code}`
          : "unknown exit code"
      const error = new Error(`${label} process exited before ready (${exitDescription})`)
      lastError = error
      if (isStopping()) return
      handleFailedAttempt(current, error)
      return
    }
    if (
      shouldRecoverAfterServerExit({
        becameReady: current.becameReady,
        wasCurrent: true,
        quitting: isStopping(),
      })
    ) {
      attempt = null
      clearStabilityTimer()
      stopProbe()
      lastError = new Error(`${label} process exited unexpectedly`)
      transition("degraded", { exitCode: code })
      transition("restarting")
      scheduleNextAttempt(0)
      return
    }
    // Settled, non-recoverable exit (killed after a boot timeout, reported a
    // boot error, or stopped): the process is gone, so detach the handle.
    attempt = null
  }

  // Shared post-spawn path for sync and async drivers: attach the handle and
  // open the boot window. `late` marks a handle that arrived via a settled
  // spawn promise, possibly after the attempt was already abandoned.
  function settleSpawn(current, context, handle, { late }) {
    if (attempt !== current) {
      // Only reachable for a late async handle: the attempt was dropped
      // (stop, or replaced by a newer attempt) while the spawn was in flight.
      // Nobody supervises this process — kill it so it is never orphaned.
      safeTerminate(handle)
      return
    }
    current.handle = handle
    if (current.settled) {
      // The attempt settled while an async spawn was in flight (boot timeout,
      // wire.failed, exit). A late handle from that spawn is likewise
      // unsupervised, so terminate it — unless it already reported ready
      // (the driver called wire.ready before resolving its spawn promise,
      // the async analogue of a sync driver settling inside spawn()).
      if (late && !current.becameReady) safeTerminate(handle)
      return
    }
    transition("booting", current.restart ? { attempt: context.attempt } : {})
    if (readiness) runReadinessProbe(current, 1)
  }

  function spawnAttempt({ restart }) {
    const id = ++attemptSeq
    const context = { restart, attempt: restart ? restartPolicy.crashRestarts : 0 }
    transition("spawning", restart ? { attempt: context.attempt } : {})
    const current = { id, handle: null, settled: false, becameReady: false, restart }
    attempt = current
    // The boot window covers spawn AND booting: it is armed before the driver
    // runs so an async spawn that never settles still hits the boot timeout.
    bootTimer = setTimer(() => {
      bootTimer = null
      handleBootFailure(current, new Error(`${label} process start timed out`), { terminate: true })
    }, policy.bootTimeoutMs)
    const wire = {
      ready: (info) => handleReady(current, info),
      failed: (error) =>
        handleBootFailure(current, toError(error, `${label} process failed to start`), { terminate: false }),
      exited: (code, signal) => handleExit(current, code, signal),
    }
    let spawned
    try {
      spawned = driver.spawn(wire, context)
    } catch (error) {
      handleBootFailure(current, toError(error, `${label} process failed to start`), { terminate: false })
      return
    }
    if (spawned && typeof spawned.then === "function") {
      // Async spawn driver: the FSM stays in `spawning` until the promise
      // settles; a rejection is a boot failure on the wire.failed path (the
      // driver owns killing any half-started process before rejecting).
      spawned.then(
        (handle) => settleSpawn(current, context, handle, { late: true }),
        (error) => handleBootFailure(current, toError(error, `${label} process failed to start`), { terminate: false }),
      )
      return
    }
    settleSpawn(current, context, spawned, { late: false })
  }

  function start() {
    if (state !== "idle" && state !== "exhausted" && state !== "stopped") {
      return Promise.reject(new Error(`${label} supervision cannot start from state "${state}"`))
    }
    // A previous attempt may still hold a LIVE handle here (an attempt that
    // reported wire.failed with terminate: false and never exited, kept so
    // stop() could still gracefully stop it). Terminate it before spawning
    // anew — the old process must never linger next to its replacement.
    const lingering = attempt
    attempt = null
    if (lingering && lingering.handle) safeTerminate(lingering.handle)
    if (state !== "idle") {
      // Manual restart escape from exhausted/stopped: fresh budget.
      restartPolicy.markStable()
      lastError = null
      lastExit = null
    }
    stopPromise = null
    transition("resolving")
    return new Promise((resolve, reject) => {
      startSettlement = { resolve, reject }
      spawnAttempt({ restart: false })
    })
  }

  function stop() {
    if (state === "stopped") return stopPromise || Promise.resolve()
    if (state === "stopping") return stopPromise
    transition("stopping")
    clearBootTimer()
    clearBackoffTimer()
    clearStabilityTimer()
    stopProbe()
    clearReadinessTimer()
    // A stop may interrupt an in-flight restart attempt; clear the policy's
    // relaunching flag so it can never linger into the next start().
    restartPolicy.completeRestart()
    settleStart(new Error(`${label} process stopped before ready`))
    const current = attempt
    attempt = null
    const handle = current ? current.handle : null
    const finish = () => {
      transition("stopped")
    }
    stopPromise = Promise.resolve()
      .then(() =>
        handle
          ? driver.gracefulStop(handle, {
              termTimeoutMs: policy.stopTermTimeoutMs,
              killTimeoutMs: policy.stopKillTimeoutMs,
            })
          : undefined,
      )
      .then(finish, finish)
    return stopPromise
  }

  return {
    start,
    stop,
    get state() {
      return state
    },
    get crashRestarts() {
      return restartPolicy.crashRestarts
    },
  }
}

module.exports = {
  createSupervisionFsm,
  computeBackoffMs,
  computeReadinessDelayMs,
  DEFAULT_POLICY,
}
