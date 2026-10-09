/** Cancellation and deadline controls for one headless request. */
export type HeadlessRequestOptions = {
  /** Cancels the local wait; a dispatched mutation may still execute in the backend. */
  signal?: AbortSignal
  /** Maximum request duration in milliseconds, including response-body reads. Zero disables the deadline. */
  timeoutMs?: number
}

/** A non-success runtime response, preserving its status and structured body on HTTP and IPC. */
export class HeadlessRequestError extends Error {
  readonly status: number
  readonly body: unknown
  readonly method: string
  readonly path: string

  constructor(input: { status: number; body: unknown; method: string; path: string }) {
    const detail = typeof input.body === "string" ? input.body : JSON.stringify(input.body)
    super(`Headless runtime request failed (${input.status}): ${detail ?? ""}`)
    this.name = "HeadlessRequestError"
    this.status = input.status
    this.body = input.body
    this.method = input.method
    this.path = input.path
  }
}

/** Run a request with a disposable deadline and abort listener, including non-cooperative transports. */
export async function runHeadlessRequest<T>(
  options: HeadlessRequestOptions,
  action: (signal: AbortSignal | undefined) => Promise<T>,
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 0
  if (!Number.isInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 2_147_483_647) {
    throw new RangeError("Headless request timeoutMs must be an integer between 0 and 2147483647")
  }
  options.signal?.throwIfAborted()
  if (!options.signal && timeoutMs === 0) return action(undefined)

  const controller = new AbortController()
  const onCallerAbort = () => controller.abort(options.signal?.reason)
  options.signal?.addEventListener("abort", onCallerAbort, { once: true })
  let timer: ReturnType<typeof setTimeout> | undefined
  if (timeoutMs > 0) {
    timer = setTimeout(() => {
      controller.abort(new DOMException(`Headless request timed out after ${timeoutMs}ms`, "TimeoutError"))
    }, timeoutMs)
  }
  let onAbort: () => void = () => {}
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(controller.signal.reason)
    controller.signal.addEventListener("abort", onAbort, { once: true })
  })
  try {
    return await Promise.race([
      aborted,
      Promise.resolve().then(() => {
        controller.signal.throwIfAborted()
        return action(controller.signal)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    options.signal?.removeEventListener("abort", onCallerAbort)
    controller.signal.removeEventListener("abort", onAbort)
  }
}
