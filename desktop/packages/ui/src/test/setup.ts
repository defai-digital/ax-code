// Node >= 22 defines an experimental global `localStorage` accessor that
// returns `undefined` unless --localstorage-file is passed. That accessor
// shadows jsdom's Storage in the test environment, so zustand's persist
// middleware (and anything else touching localStorage) crashes with
// "Cannot read properties of undefined (reading 'setItem')". Install an
// in-memory Storage whenever the global is missing or unusable.
class MemoryStorage implements Storage {
  private data = new Map<string, string>()

  get length(): number {
    return this.data.size
  }

  clear(): void {
    this.data.clear()
  }

  getItem(key: string): string | null {
    return this.data.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.data.delete(key)
  }

  setItem(key: string, value: string): void {
    this.data.set(key, String(value))
  }
}

function localStorageIsBroken(): boolean {
  try {
    const storage = globalThis.localStorage
    if (!storage) {
      return true
    }
    const probe = "__ax_code_storage_probe__"
    storage.setItem(probe, "1")
    storage.removeItem(probe)
    return false
  } catch {
    return true
  }
}

if (localStorageIsBroken()) {
  Object.defineProperty(globalThis, "localStorage", {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  })
}
