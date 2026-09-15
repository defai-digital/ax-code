import { parseTuiJsonPayload } from "../../util/json"
import z from "zod"

export function parsePromptPersistenceJsonLine(line: string): unknown | undefined {
  return parseTuiJsonPayload(line)
}

export function decodePromptPersistenceJsonValue<T>(value: unknown, schema: z.ZodType<T>): T | undefined {
  const decoded = schema.safeParse(value)
  return decoded.success ? decoded.data : undefined
}

export function decodePromptPersistenceJsonLine<T>(line: string, schema: z.ZodType<T>): T | undefined {
  return decodePromptPersistenceJsonValue(parsePromptPersistenceJsonLine(line), schema)
}
