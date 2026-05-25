import z from "zod"

export function parsePromptPersistenceJsonLine(line: string): unknown | undefined {
  try {
    return JSON.parse(line)
  } catch {
    return undefined
  }
}

export function decodePromptPersistenceJsonLine<T>(line: string, schema: z.ZodType<T>): T | undefined {
  const parsed = parsePromptPersistenceJsonLine(line)
  const decoded = schema.safeParse(parsed)
  return decoded.success ? decoded.data : undefined
}
