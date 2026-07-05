export function compareStringFields<T extends Record<K, string>, K extends string>(
  left: T,
  right: T,
  fields: readonly K[],
) {
  for (const field of fields) {
    const result = left[field].localeCompare(right[field])
    if (result !== 0) return result
  }
  return 0
}
