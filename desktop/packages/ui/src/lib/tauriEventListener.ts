import type { TauriEventApi } from "@/lib/tauriGlobal"

type TauriEventHandler = Parameters<NonNullable<TauriEventApi["listen"]>>[1]
type TauriUnlisten = () => void | Promise<void>
type TauriListen = (event: string, handler: TauriEventHandler) => Promise<TauriUnlisten>

const disposeUnlisten = (unlisten: TauriUnlisten) => {
  try {
    const result = unlisten()
    if (result instanceof Promise) {
      void result.catch(() => {
        // Event listener cleanup is best-effort.
      })
    }
  } catch {
    // Event listener cleanup is best-effort.
  }
}

export const listenToTauriEvent = (
  listen: TauriListen,
  event: string,
  handler: TauriEventHandler,
): (() => void) => {
  let disposed = false
  let unlisten: TauriUnlisten | null = null

  try {
    listen(event, handler)
      .then((fn) => {
        if (disposed) {
          disposeUnlisten(fn)
          return
        }
        unlisten = fn
      })
      .catch(() => {
        // The Tauri-compatible event bridge is optional in web/runtime tests.
      })
  } catch {
    // The Tauri-compatible event bridge is optional in web/runtime tests.
  }

  return () => {
    disposed = true
    const fn = unlisten
    unlisten = null
    if (fn) {
      disposeUnlisten(fn)
    }
  }
}
