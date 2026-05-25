export function parseJsonPayload(raw: string | undefined): unknown | undefined {
  const text = raw?.trim()
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
