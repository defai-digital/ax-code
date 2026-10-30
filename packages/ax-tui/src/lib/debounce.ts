interface PendingDebounce {
  timer: ReturnType<typeof setTimeout>
  reject: (error: Error) => void
}

type ScopeId = string | number
const scopes = new Map<ScopeId, Map<ScopeId, PendingDebounce>>()

function cancellation(): Error {
  const error = new Error("Debounced operation cancelled")
  error.name = "AbortError"
  return error
}

function clearTimer(scopeId: ScopeId, id: ScopeId): void {
  const scope = scopes.get(scopeId)
  const pending = scope?.get(id)
  if (!pending) return
  clearTimeout(pending.timer)
  scope!.delete(id)
  if (scope!.size === 0) scopes.delete(scopeId)
  pending.reject(cancellation())
}

/** Debounces asynchronous work within a named scope. Cancelled calls reject with AbortError. */
export class DebounceController {
  constructor(private scopeId: ScopeId) {}

  /** Replacing a pending call cancels its promise; each promise always settles. */
  debounce<R>(id: ScopeId, ms: number, fn: () => Promise<R>): Promise<R> {
    if (!Number.isFinite(ms) || ms < 0 || ms > 2_147_483_647) {
      return Promise.reject(new RangeError("Debounce delay must be between 0 and 2147483647 milliseconds"))
    }
    this.clearDebounce(id)
    let scope = scopes.get(this.scopeId)
    if (!scope) scopes.set(this.scopeId, (scope = new Map()))
    const activeScope = scope
    return new Promise<R>((resolve, reject) => {
      const timer = setTimeout(() => {
        // Release the entry before running user code, which may schedule again.
        activeScope.delete(id)
        if (activeScope.size === 0) scopes.delete(this.scopeId)
        try {
          resolve(fn())
        } catch (error) {
          reject(error)
        }
      }, ms)
      activeScope.set(id, { timer, reject })
    })
  }

  clearDebounce(id: ScopeId): void {
    clearTimer(this.scopeId, id)
  }
  clear(): void {
    clearDebounceScope(this.scopeId)
  }
}

export function createDebounce(scopeId: ScopeId): DebounceController {
  return new DebounceController(scopeId)
}

export function clearDebounceScope(scopeId: ScopeId): void {
  const scope = scopes.get(scopeId)
  if (!scope) return
  for (const id of scope.keys()) clearTimer(scopeId, id)
}

export function clearAllDebounces(): void {
  for (const scopeId of scopes.keys()) clearDebounceScope(scopeId)
}
