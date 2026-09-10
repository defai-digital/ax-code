import { AX_ENGINE_ERROR } from "./constants"
import { AxEngineStartupError } from "./errors"

/** Own cancellation across lock waiting, startup and capability discovery. */
export async function resolveAxEngineSetup<T>(
  input: { modelID: string; signal: AbortSignal; timeoutMs?: number },
  load: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  input.signal.throwIfAborted()
  const timeoutMs = input.timeoutMs ?? 300_000
  const deadline = Date.now() + timeoutMs
  const timeout = new AxEngineStartupError({
    code: AX_ENGINE_ERROR.SetupTimeout,
    reason: "setup-timeout",
    message:
      `${AX_ENGINE_ERROR.SetupTimeout}: LLM setup timed out for ax-engine/${input.modelID} ` +
      `after ${timeoutMs / 1000} seconds. Pending setup was cancelled and was not retried automatically. ` +
      "Check the local runtime status and server log before retrying explicitly.",
  })
  const controller = new AbortController()
  const forwardAbort = () => controller.abort(input.signal.reason)
  const interrupted = Promise.withResolvers<never>()
  const onAbort = () => interrupted.reject(controller.signal.reason)
  controller.signal.addEventListener("abort", onAbort, { once: true })
  input.signal.addEventListener("abort", forwardAbort, { once: true })
  const timer = setTimeout(() => controller.abort(timeout), timeoutMs)
  try {
    const work = Promise.resolve().then(() => {
      controller.signal.throwIfAborted()
      return load(controller.signal)
    })
    // Observe late rejection even if the loader ignores cancellation. Its
    // signal still reaches cooperative lock, health and process cleanup paths.
    const result = await Promise.race([work, interrupted.promise])
    if (Date.now() >= deadline) controller.abort(timeout)
    controller.signal.throwIfAborted()
    return result
  } catch (error) {
    // A sibling setup failure (config/provider lookup) must also cancel an
    // unfinished getLanguage call, not leave it starting a model in background.
    controller.abort(error)
    throw error
  } finally {
    clearTimeout(timer)
    input.signal.removeEventListener("abort", forwardAbort)
    controller.signal.removeEventListener("abort", onAbort)
  }
}
