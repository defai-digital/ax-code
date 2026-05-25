export type CliJsonObject = Record<string, any>

export function parseCliJsonObject(text: string): CliJsonObject | undefined {
  try {
    const parsed: unknown = JSON.parse(text)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as CliJsonObject) : undefined
  } catch {
    return undefined
  }
}
