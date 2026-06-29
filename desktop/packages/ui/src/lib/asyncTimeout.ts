export const withTimeout = <T>(
  operation: Promise<T>,
  timeoutMs: number,
  onTimeout: () => T | Promise<T>,
): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const timeoutHandle = setTimeout(() => {
      if (settled) {
        return
      }
      settled = true
      Promise.resolve()
        .then(onTimeout)
        .then(resolve, reject)
    }, Math.max(0, timeoutMs))

    operation.then(
      (value) => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timeoutHandle)
        resolve(value)
      },
      (error: unknown) => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timeoutHandle)
        reject(error)
      },
    )
  })
}
