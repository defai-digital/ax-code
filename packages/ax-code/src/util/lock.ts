export namespace Lock {
  // Default ceiling on how long any waiter will block before giving up.
  // Matches FileLock's 10s default — keeps waiters from hanging forever
  // if a holder skips its `using`-driven dispose (uncaught throw before
  // the scope exits, etc.). Callers that legitimately need to wait
  // longer can pass `timeoutMs` explicitly.
  const DEFAULT_TIMEOUT_MS = 10_000

  type Waiter = {
    settled: boolean
    fire: () => void
  }

  const locks = new Map<
    string,
    {
      readers: number
      writer: boolean
      waitingReaders: Waiter[]
      waitingWriters: Waiter[]
    }
  >()

  function get(key: string) {
    if (!locks.has(key)) {
      locks.set(key, {
        readers: 0,
        writer: false,
        waitingReaders: [],
        waitingWriters: [],
      })
    }
    return locks.get(key)!
  }

  function dropWaiter(queue: Waiter[], waiter: Waiter) {
    const idx = queue.indexOf(waiter)
    if (idx >= 0) queue.splice(idx, 1)
  }

  function maybeDelete(lock: ReturnType<typeof get>, key: string) {
    if (lock.readers === 0 && !lock.writer && lock.waitingReaders.length === 0 && lock.waitingWriters.length === 0) {
      locks.delete(key)
    }
  }

  function process(key: string) {
    const lock = locks.get(key)
    if (!lock || lock.writer || lock.readers > 0) return

    // Prioritize writers to prevent starvation. Skip past timed-out
    // waiters that haven't been removed yet (their settled flag stops
    // them from being woken twice).
    while (lock.waitingWriters.length > 0) {
      const next = lock.waitingWriters.shift()!
      if (next.settled) continue
      next.settled = true
      next.fire()
      return
    }

    // Wake up all waiting readers, again skipping timed-out ones.
    while (lock.waitingReaders.length > 0) {
      const next = lock.waitingReaders.shift()!
      if (next.settled) continue
      next.settled = true
      next.fire()
    }

    maybeDelete(lock, key)
  }

  function timeoutMessage(kind: "read" | "write", key: string, ms: number) {
    return `Lock.${kind}: timed out after ${ms}ms waiting for ${JSON.stringify(key)}`
  }

  export async function read(key: string, opts?: { timeoutMs?: number }): Promise<Disposable> {
    const lock = get(key)
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS

    return new Promise((resolve, reject) => {
      if (!lock.writer && lock.waitingWriters.length === 0) {
        lock.readers++
        resolve({
          [Symbol.dispose]: () => {
            lock.readers--
            process(key)
          },
        })
        return
      }

      const waiter: Waiter = {
        settled: false,
        fire: () => {
          clearTimeout(timer)
          lock.readers++
          resolve({
            [Symbol.dispose]: () => {
              lock.readers--
              process(key)
            },
          })
        },
      }
      const timer = setTimeout(() => {
        if (waiter.settled) return
        waiter.settled = true
        dropWaiter(lock.waitingReaders, waiter)
        maybeDelete(lock, key)
        reject(new Error(timeoutMessage("read", key, timeoutMs)))
      }, timeoutMs)
      // unref so a stuck waiter cannot keep the process alive past
      // intended shutdown — we still reject with a clear error if the
      // event loop is otherwise idle and the timer fires.
      if (typeof timer === "object" && "unref" in timer) timer.unref()
      lock.waitingReaders.push(waiter)
    })
  }

  export async function write(key: string, opts?: { timeoutMs?: number }): Promise<Disposable> {
    const lock = get(key)
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS

    return new Promise((resolve, reject) => {
      if (!lock.writer && lock.readers === 0) {
        lock.writer = true
        resolve({
          [Symbol.dispose]: () => {
            lock.writer = false
            process(key)
          },
        })
        return
      }

      const waiter: Waiter = {
        settled: false,
        fire: () => {
          clearTimeout(timer)
          lock.writer = true
          resolve({
            [Symbol.dispose]: () => {
              lock.writer = false
              process(key)
            },
          })
        },
      }
      const timer = setTimeout(() => {
        if (waiter.settled) return
        waiter.settled = true
        dropWaiter(lock.waitingWriters, waiter)
        maybeDelete(lock, key)
        reject(new Error(timeoutMessage("write", key, timeoutMs)))
      }, timeoutMs)
      if (typeof timer === "object" && "unref" in timer) timer.unref()
      lock.waitingWriters.push(waiter)
    })
  }
}
