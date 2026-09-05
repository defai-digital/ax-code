// Plugin transformations operate on detached plain data. Schemas, services,
// functions, and other class instances are opaque, read-only trusted references.
export namespace PluginData {
  type Container = Record<string, unknown> | unknown[]

  function container(value: unknown): value is Container {
    if (!value || typeof value !== "object") return false
    const prototype = Object.getPrototypeOf(value)
    return Array.isArray(value) || prototype === Object.prototype || prototype === null
  }

  function read(value: Container, key: string): unknown {
    return Object.hasOwn(value, key) ? (value as Record<string, unknown>)[key] : undefined
  }

  function set(value: Container, key: string, entry: unknown) {
    // Defining an own property avoids the legacy __proto__ setter.
    Object.defineProperty(value, key, { value: entry, enumerable: true, configurable: true, writable: true })
  }

  export function copy<T>(value: T): T {
    const seen = new Map<object, Container>()
    function clone(input: unknown): unknown {
      if (!container(input)) return input
      const cached = seen.get(input)
      if (cached) return cached
      const result: Container = Array.isArray(input)
        ? new Array(input.length)
        : Object.create(Object.getPrototypeOf(input))
      seen.set(input, result)
      for (const key of Object.keys(input)) set(result, key, clone(read(input, key)))
      return result
    }
    return clone(value) as T
  }

  export function commit<T>(target: T, draft: T): void {
    const seen = new Map<object, Container>()
    const claimed = new Set<Container>()
    function reconcile(current: unknown, source: unknown): unknown {
      if (!container(source)) return source
      const cached = seen.get(source)
      if (cached) return cached
      const result: Container =
        container(current) && !claimed.has(current) && Object.getPrototypeOf(current) === Object.getPrototypeOf(source)
          ? current
          : Array.isArray(source)
            ? []
            : Object.create(Object.getPrototypeOf(source))
      seen.set(source, result)
      claimed.add(result)
      for (const key of Object.keys(result)) {
        if (!Object.hasOwn(source, key)) Reflect.deleteProperty(result, key)
      }
      if (Array.isArray(result) && Array.isArray(source)) result.length = source.length
      for (const key of Object.keys(source)) set(result, key, reconcile(read(result, key), read(source, key)))
      return result
    }
    // Reconciliation copies every plain-data node, including plugin-created
    // values, while preserving existing caller-held arrays and message objects.
    reconcile(target, draft)
  }
}
