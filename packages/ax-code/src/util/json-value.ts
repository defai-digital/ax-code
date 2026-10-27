import { parseJsonResult } from "@ax-code/util/json-value"

// Consolidated into @ax-code/util so core, intel and reason share one
// implementation. This shim keeps the `@/util/json-value` import path stable.
export * from "@ax-code/util/json-value"

// Extract a JSON value from raw model text: accept the bare text, a fenced
// ```json block, or the outermost {...} span. Returns undefined when nothing
// parses. This stays in core — it is a model-output policy, not a shared parse.
export function parseJsonFromText(text: string): unknown {
  const candidates: string[] = [text.trim()]
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) candidates.push(fenced[1].trim())
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1))
  // The outermost span fails when prose after the object mentions a brace;
  // also try the span that closes the first object.
  const balanced = start >= 0 ? balancedObjectEnd(text, start) : -1
  if (balanced > start && balanced !== end) candidates.push(text.slice(start, balanced + 1))
  for (const candidate of candidates) {
    const parsed = parseJsonResult(candidate)
    if (parsed.ok) return parsed.value
  }
  return undefined
}

// Index of the "}" that closes the object opened at `start`, skipping braces
// inside JSON strings; -1 when it never closes.
function balancedObjectEnd(text: string, start: number): number {
  let depth = 0
  let inString = false
  for (let index = start; index < text.length; index++) {
    const char = text[index]
    if (inString) {
      if (char === "\\") index++
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === "{") depth++
    else if (char === "}" && --depth === 0) return index
  }
  return -1
}
