import { NamedError } from "@ax-code/util/error"
import type { PluginHookContext, PluginLifecycle } from "@ax-code/plugin"
import z from "zod"
import { setMaxListeners } from "node:events"

export namespace PluginLifetime {
  export const CALLBACK_TIMEOUT_MS = 15_000
  export const CLEANUP_TIMEOUT_MS = 1_000
  export const Failure = NamedError.create(
    "PluginLifetimeError",
    z.object({ reason: z.enum(["disposed", "timeout"]), message: z.string() }),
  )

  export function disposed() {
    return new Failure({ reason: "disposed", message: "Plugin instance or lifetime has been disposed" })
  }

  export type Handle = PluginLifecycle & {
    run<T>(callback: (context: PluginHookContext) => T | Promise<T>): Promise<T>
    dispose(): Promise<void>
  }

  export async function wait<T>(signal: AbortSignal, pending: Promise<T>): Promise<T> {
    let cancel!: () => void
    try {
      const cancelled = new Promise<never>((_, reject) => {
        cancel = () => reject(disposed())
        signal.addEventListener("abort", cancel, { once: true })
        if (signal.aborted) cancel()
      })
      // Observe the loading promise even when cancellation wins. Config and
      // package installation keep their own budgets; callers can stop waiting.
      return await Promise.race([cancelled, pending])
    } finally {
      signal.removeEventListener("abort", cancel)
    }
  }

  export function create(parent: AbortSignal, onCleanupFailure: () => void): Handle {
    const controller = new AbortController()
    // Parallel tool-definition callbacks share this owned lifetime. Each run
    // removes its listener on settlement; concurrent callbacks have no fixed cap.
    setMaxListeners(0, controller.signal)
    const cleanups = new Set<() => void | Promise<void>>()
    let closing = false
    let disposal: Promise<void> | undefined

    async function cleanup(callback: () => void | Promise<void>) {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          Promise.resolve().then(callback),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("Plugin cleanup timed out")), CLEANUP_TIMEOUT_MS)
          }),
        ])
      } catch {
        // Never include arbitrary plugin exception text or callback data in logs.
        onCleanupFailure()
      } finally {
        clearTimeout(timer)
      }
    }

    function dispose(): Promise<void> {
      if (closing) return disposal ?? Promise.resolve()
      closing = true
      parent.removeEventListener("abort", abort)
      controller.abort(disposed())
      const pending = [...cleanups].reverse()
      cleanups.clear()
      disposal = Promise.all(pending.map(cleanup)).then(() => undefined)
      return disposal
    }

    function abort() {
      void dispose()
    }
    parent.addEventListener("abort", abort, { once: true })
    if (parent.aborted) abort()

    return {
      signal: controller.signal,
      onDispose(callback) {
        // Each registration is independent, even when the same function is reused.
        const registered = () => callback()
        if (closing) {
          void cleanup(registered)
        } else {
          cleanups.add(registered)
        }
        return () => {
          cleanups.delete(registered)
        }
      },
      dispose,
      run(callback) {
        if (controller.signal.aborted) return Promise.reject(disposed())
        const invocation = new AbortController()
        return new Promise((resolve, reject) => {
          let settled = false
          const finish = () => {
            if (settled) return false
            settled = true
            clearTimeout(timer)
            controller.signal.removeEventListener("abort", cancel)
            return true
          }
          const cancel = () => {
            if (!finish()) return
            const error = disposed()
            invocation.abort(error)
            reject(error)
          }
          const timer = setTimeout(() => {
            if (!finish()) return
            const error = new Failure({ reason: "timeout", message: "Plugin callback exceeded its 15000ms deadline" })
            invocation.abort(error)
            reject(error)
            void dispose()
          }, CALLBACK_TIMEOUT_MS)
          controller.signal.addEventListener("abort", cancel, { once: true })
          // The rejection handler remains attached after cancellation/timeout.
          // No late callback result is published by this boundary.
          Promise.resolve()
            .then(() => {
              invocation.signal.throwIfAborted()
              return callback({ signal: invocation.signal })
            })
            .then(
              (value) => {
                if (finish()) resolve(value)
              },
              (error) => {
                if (finish()) reject(error)
              },
            )
        })
      },
    }
  }
}
