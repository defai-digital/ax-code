export function parseTuiJsonPayload(raw: string | undefined): unknown | undefined {
  if (!raw) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}
