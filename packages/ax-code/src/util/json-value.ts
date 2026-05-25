export type JsonParseResult =
  | {
      ok: true
      value: unknown
    }
  | {
      ok: false
      error: unknown
    }

export function parseJsonResult(text: string): JsonParseResult {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (error) {
    return { ok: false, error }
  }
}

export function parseJsonStrict(text: string): unknown {
  const parsed = parseJsonResult(text)
  if (!parsed.ok) {
    const { error } = parsed
    if (error instanceof Error) throw error
    throw new SyntaxError(String(error))
  }
  return parsed.value
}

export function parseJsonPayload(raw: string | undefined): unknown | undefined {
  const text = raw?.trim()
  if (!text) return undefined
  const parsed = parseJsonResult(text)
  if (!parsed.ok) {
    return undefined
  }
  return parsed.value
}
