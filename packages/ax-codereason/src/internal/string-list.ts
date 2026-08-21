export function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string")
}

export function uniqueItems<T>(values: Iterable<T>): T[] {
  return Array.from(new Set(values))
}

export function uniqueStrings(values: Iterable<string>): string[] {
  return uniqueItems(values)
}

export function uniqueSortedStrings(values: Iterable<string>): string[] {
  return uniqueStrings(values).sort()
}
