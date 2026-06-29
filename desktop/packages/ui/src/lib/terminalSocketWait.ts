export type ReadyStateSocket = {
  readyState: number
}

const WS_READY_STATE_OPEN = 1

export const waitForOpenSocket = <T extends ReadyStateSocket>(
  openPromise: Promise<T | null> | null,
  waitMs: number,
): Promise<T | null> => {
  if (!openPromise) {
    return Promise.resolve(null)
  }

  return new Promise<T | null>((resolve) => {
    let settled = false
    const timeoutHandle = setTimeout(() => {
      if (settled) {
        return
      }
      settled = true
      resolve(null)
    }, Math.max(0, waitMs))

    const settle = (socket: T | null) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeoutHandle)
      resolve(socket?.readyState === WS_READY_STATE_OPEN ? socket : null)
    }

    openPromise.then(settle, () => settle(null))
  })
}
