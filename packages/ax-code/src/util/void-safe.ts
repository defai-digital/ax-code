import { Log } from "./log"

const log = Log.create({ service: "void-safe" })

/**
 * Fire-and-forget an async task without leaving unhandled rejections
 * (BP-08). Prefer this over bare `void asyncFn()` when the caller does
 * not need the result.
 */
export function voidSafe(task: () => Promise<unknown>, label = "async task"): void {
  try {
    void Promise.resolve()
      .then(() => task())
      .catch((error) => {
        log.warn("voidSafe task rejected", { label, error })
      })
  } catch (error) {
    log.warn("voidSafe task threw synchronously", { label, error })
  }
}
