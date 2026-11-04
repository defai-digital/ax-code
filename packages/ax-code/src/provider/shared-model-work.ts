/** Cancel a subscriber's wait without cancelling shared registry/SDK work. */
export function waitForSharedModelWork<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort)
      reject(signal.reason)
    }
    work.then(
      (value) => {
        signal.removeEventListener("abort", onAbort)
        if (signal.aborted) reject(signal.reason)
        else resolve(value)
      },
      (error) => {
        signal.removeEventListener("abort", onAbort)
        reject(error)
      },
    )
    signal.addEventListener("abort", onAbort, { once: true })
    if (signal.aborted) onAbort()
  })
}
