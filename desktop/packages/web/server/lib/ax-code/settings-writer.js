// S2.3 (SPEC-2026-08-29-desktop-process-model-collapse §2 D5): Electron main is
// the sole writer of settings.json. This module is the single entry point for
// every web-side settings.json write, with two backends:
//
// - delegate: desktop (utilityProcess) mode, detected by the presence of
//   process.parentPort. The write is sent to main over the parentPort channel
//   as an id-correlated request and resolves when main replies (main applies it
//   through its serialized read-modify-write chain and atomic tmp+rename).
// - local: standalone web mode (no parentPort exists — plain node or a
//   child_process.fork IPC parent that is not Electron main). Uses the
//   pre-existing local atomic writer unchanged.
//
// Protocol (same channel as the existing "ready"/"stop" messages):
//   request : { type: "settings-write", id, settings }
//   response: { type: "settings-write-result", id, ok, error? }
//
// There is intentionally no local settings cache to invalidate after a
// delegated write: every web-side reader (settings-runtime, lib/github/auth.js,
// lib/ax-code/proxy.js) reads settings.json straight from disk, and main's
// atomic rename makes the new contents visible before the write promise
// resolves.
export const SETTINGS_WRITE_TIMEOUT_MS = 10_000

export const createSettingsWriter = ({
  parentPort,
  localWrite,
  timeoutMs = SETTINGS_WRITE_TIMEOUT_MS,
  createRequestId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) => {
  if (!parentPort || typeof parentPort.postMessage !== "function" || typeof parentPort.on !== "function") {
    return { mode: "local", write: (settings) => localWrite(settings) }
  }

  const pending = new Map()

  const rejectAll = (error) => {
    for (const [id, entry] of pending) {
      pending.delete(id)
      clearTimer(entry.timer)
      entry.reject(error)
    }
  }

  parentPort.on("message", (event) => {
    const msg = event?.data
    if (!msg || msg.type !== "settings-write-result") return
    const entry = pending.get(msg.id)
    if (!entry) return
    pending.delete(msg.id)
    clearTimer(entry.timer)
    if (msg.ok) {
      entry.resolve()
    } else {
      entry.reject(
        new Error(
          typeof msg.error === "string" && msg.error ? msg.error : "Settings write failed in the desktop main process",
        ),
      )
    }
  })

  // The channel closing means the main process is gone. Fail pending writes
  // immediately instead of letting requests hang until the timeout.
  parentPort.on("close", () => {
    rejectAll(new Error("Settings write channel to the desktop main process closed"))
  })

  const write = (settings) =>
    new Promise((resolve, reject) => {
      const id = createRequestId()
      const timer = setTimer(() => {
        pending.delete(id)
        reject(new Error(`Settings write to the desktop main process timed out after ${timeoutMs} ms`))
      }, timeoutMs)
      timer.unref?.()
      pending.set(id, { resolve, reject, timer })
      try {
        parentPort.postMessage({ type: "settings-write", id, settings })
      } catch (error) {
        pending.delete(id)
        clearTimer(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })

  return { mode: "delegate", write }
}
