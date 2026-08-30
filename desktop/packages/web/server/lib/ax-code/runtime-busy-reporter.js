// S2.5c (SPEC-2026-08-29-desktop-process-model-collapse §5 S2.5): reports the
// web-local busy-session count to Electron main over the utilityProcess
// channel as `{ type: "runtime-busy", count }` messages. Main feeds the count
// to the runtime supervisor so its wedged-kill honors the busy-session
// restart grace (the pre-S2.5 web-local shouldSkipRestartForBusySessions
// policy, lifecycle.js). Reports are deduped by count — one message per
// count change, so bursty session activity never floods the channel.
// process.parentPort only exists inside the Electron utilityProcess;
// standalone web mode keeps this inert.

export const createRuntimeBusyReporter = ({ getProcess = () => process, getActiveSessionCount }) => {
  if (typeof getActiveSessionCount !== "function") {
    throw new TypeError("createRuntimeBusyReporter requires a getActiveSessionCount() function")
  }

  // -1 forces the first report (even a 0) so main learns the initial state.
  let lastReported = -1

  const report = () => {
    const parentPort = getProcess()?.parentPort ?? null
    if (!parentPort || typeof parentPort.postMessage !== "function") return
    const raw = Number(getActiveSessionCount())
    const count = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0
    if (count === lastReported) return
    lastReported = count
    try {
      parentPort.postMessage({ type: "runtime-busy", count })
    } catch {}
  }

  return { report }
}
