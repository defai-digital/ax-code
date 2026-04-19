export async function waitForAbortOrTimeout(signal: AbortSignal, ms: number): Promise<void> {
  if (signal.aborted) return

  await new Promise<void>((resolve) => {
    const onAbort = () => {
      clearTimeout(timer)
      resolve()
    }

    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, ms)

    signal.addEventListener("abort", onAbort, { once: true })
  })
}
