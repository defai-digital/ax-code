/**
 * Tolerant JSON serialization in two tiers.
 *
 * Tier 1 (fast path) is a plain `JSON.stringify` call with no replacer
 * function and no WeakSet bookkeeping, which keeps V8 on its optimized
 * JSON stringify path. This is safe to try first because the fallback
 * tier only transforms values that make the fast path throw (BigInt,
 * true cycles), so any payload the fast path accepts is serialized
 * byte-identically.
 *
 * Tier 2 runs only when the fast path throws (circular structure,
 * BigInt, or a throwing toJSON/getter). It converts BigInt values to
 * decimal strings and replaces only TRUE cycles, tracked through the
 * active ancestor chain (`this`-based): JSON.stringify revisits shared
 * DAG nodes legitimately, so a repeated sibling reference is serialized
 * in full and only a reference back to an object currently being
 * serialized becomes "[Circular]". (The earlier Rpc implementation used
 * a WeakSet of every visited object, which silently replaced ANY object
 * reached twice — including shared non-cyclic references — with
 * "[Circular]".)
 *
 * Returns "null" for `undefined`, matching `JSON.stringify` callers
 * that coerce a missing value to JSON null. Throws when both tiers fail
 * (e.g. a `toJSON` that throws) so callers can emit their own
 * serialization-error frame.
 */
export function stringifyTolerant(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "null"
  } catch {
    // Fall through to the tolerant replacer path below.
  }
  const ancestors: object[] = []
  return (
    JSON.stringify(value, function (this: unknown, _key, value) {
      if (typeof value === "bigint") return value.toString()
      if (typeof value === "object" && value !== null) {
        // JSON.stringify revisits shared DAG nodes legitimately. Keep only
        // the active ancestor chain so a repeated sibling reference is
        // serialized normally and only a true cycle is replaced.
        while (ancestors.length > 0 && ancestors.at(-1) !== this) ancestors.pop()
        if (ancestors.includes(value)) return "[Circular]"
        ancestors.push(value)
      }
      return value
    }) ?? "null"
  )
}
