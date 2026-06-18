export function parseContentLengthHeader(value: string | null | undefined): number | undefined {
  if (value == null) return undefined
  const normalized = value.trim()
  if (!/^\d+$/.test(normalized)) return undefined
  const bytes = Number(normalized)
  if (!Number.isSafeInteger(bytes)) return Number.MAX_SAFE_INTEGER
  return bytes
}
