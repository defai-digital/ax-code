"use strict"

// A hard exit of the Electron main process (kill -9, crash) never delivers the
// graceful "stop" message, which would orphan this utility process and the
// ax-code child it spawned, leaving the port bound. Watch the parent and let
// the caller initiate the same graceful stop when it disappears.
const DEFAULT_PARENT_CHECK_INTERVAL_MS = 5_000

function startParentDeathWatchdog({
  parentPort,
  parentPid,
  onParentDeath,
  checkIntervalMs = DEFAULT_PARENT_CHECK_INTERVAL_MS,
  setTimer = setInterval,
  clearTimer = clearInterval,
  isProcessAlive = defaultIsProcessAlive,
}) {
  let stopped = false
  let interval = null

  const stop = () => {
    if (stopped) return
    stopped = true
    if (interval) clearTimer(interval)
    interval = null
    parentPort?.off?.("close", handleParentClose)
  }

  const trigger = () => {
    if (stopped) return
    stop()
    onParentDeath()
  }

  const handleParentClose = () => trigger()

  // Primary signal: the parentPort channel closes when the parent goes away.
  if (typeof parentPort?.on === "function") {
    parentPort.on("close", handleParentClose)
  }

  // Fallback: poll the parent PID, in case the channel close is not delivered.
  // Skip pid 1 — after a reparent ppid becomes init, which is always alive.
  if (Number.isInteger(parentPid) && parentPid > 1) {
    interval = setTimer(() => {
      if (!isProcessAlive(parentPid)) trigger()
    }, checkIntervalMs)
    interval.unref?.()
  }

  return { stop }
}

function defaultIsProcessAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM means the process exists but we may not signal it — still alive.
    return error?.code === "EPERM"
  }
}

module.exports = { startParentDeathWatchdog, DEFAULT_PARENT_CHECK_INTERVAL_MS }
