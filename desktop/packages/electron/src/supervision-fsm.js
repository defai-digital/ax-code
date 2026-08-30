"use strict"

// Unified, dependency-injected supervision FSM for child processes owned by
// the Electron main process (SPEC-2026-08-29-desktop-process-model-collapse
// §4). One instance supervises one process: the web-server utilityProcess
// today, the ax-code runtime process in a later sub-step. The FSM owns all
// supervision state (phase, restart budget, backoff/stability/boot/stop
// timers); the injected driver owns the actual process handle and OS calls,
// so unit tests run deterministically with a fake clock and a fake driver.
//
// States: idle → resolving → spawning → booting → healthy → degraded →
// restarting → exhausted → stopping → stopped. `resolving` is a pass-through
// for drivers that need asynchronous pre-spawn resolution (binary path,
// version check); the web-server driver resolves synchronously. `degraded`
// is entered when a healthy process is lost (exit or health-probe failure)
// and immediately yields to `restarting`.
//
// Driver contract:
//   spawn(wire, context) -> handle   (synchronous; context = { restart, attempt })
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
// All delays go through the injected clock ({ setTimeout, clearTimeout, now }),
// and every state change is emitted as a structured event to `onEvent` so
// diagnostics can consume them.

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
  return probe
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
    } else {
      probeFailures += 1
      emit({ type: "health-probe-failed", consecutiveFailures: probeFailures })
      if (probeFailures >= probe.maxConsecutiveFailures) {
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
        // the error. S2.5 will extend this context with binary path / version
        // diagnostics from the driver side.
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

  function spawnAttempt({ restart }) {
    const id = ++attemptSeq
    const context = { restart, attempt: restart ? restartPolicy.crashRestarts : 0 }
    transition("spawning", restart ? { attempt: context.attempt } : {})
    const current = { id, handle: null, settled: false, becameReady: false, restart }
    attempt = current
    const wire = {
      ready: (info) => handleReady(current, info),
      failed: (error) =>
        handleBootFailure(current, toError(error, `${label} process failed to start`), { terminate: false }),
      exited: (code, signal) => handleExit(current, code, signal),
    }
    let handle
    try {
      handle = driver.spawn(wire, context)
    } catch (error) {
      handleBootFailure(current, toError(error, `${label} process failed to start`), { terminate: false })
      return
    }
    current.handle = handle
    // A synchronous fake/real driver may have already settled this attempt.
    if (current.settled) return
    transition("booting", restart ? { attempt: context.attempt } : {})
    bootTimer = setTimer(() => {
      bootTimer = null
      handleBootFailure(current, new Error(`${label} process start timed out`), { terminate: true })
    }, policy.bootTimeoutMs)
  }

  function start() {
    if (state !== "idle" && state !== "exhausted" && state !== "stopped") {
      return Promise.reject(new Error(`${label} supervision cannot start from state "${state}"`))
    }
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
  DEFAULT_POLICY,
}
