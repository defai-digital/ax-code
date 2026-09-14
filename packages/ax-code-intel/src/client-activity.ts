// Requests remain busy until the underlying RPC settles, even if an outer
// caller times out. Queue leases also protect selected clients from eviction.
export class ClientActivity {
  busy = 0
  lastUse = performance.now()
  touch() {
    this.lastUse = performance.now()
  }
  retain() {
    this.busy++
    this.touch()
    let released = false
    return () => {
      if (released) return
      released = true
      this.busy--
      this.touch()
    }
  }
  async run<T>(fn: () => Promise<T>): Promise<T> {
    const release = this.retain()
    try {
      return await fn()
    } finally {
      release()
    }
  }
  idle(now: number, idleMs: number) {
    return this.busy === 0 && now - this.lastUse >= idleMs
  }
}
