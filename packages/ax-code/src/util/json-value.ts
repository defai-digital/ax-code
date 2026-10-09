import { toErrorMessage } from "./error-message"

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
    throw new SyntaxError(toErrorMessage(error))
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

// Extract a JSON value from raw model text: accept the bare text, a fenced
// ```json block, or the outermost {...} span. Returns undefined when nothing
// parses.
export function parseJsonFromText(text: string): unknown {
  const candidates: string[] = [text.trim()]
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) candidates.push(fenced[1].trim())
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1))
  for (const candidate of candidates) {
    const parsed = parseJsonResult(candidate)
    if (parsed.ok) return parsed.value
  }
  return undefined
}
