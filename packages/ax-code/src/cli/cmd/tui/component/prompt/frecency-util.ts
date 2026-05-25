export type FrecencyEntry = {
  path: string
  frequency: number
  lastOpen: number
}

function isFrecencyEntry(input: unknown): input is FrecencyEntry {
  return (
    typeof input === "object" &&
    input !== null &&
    !Array.isArray(input) &&
    "path" in input &&
    "frequency" in input &&
    "lastOpen" in input &&
    typeof input.path === "string" &&
    input.path.length > 0 &&
    typeof input.frequency === "number" &&
    Number.isFinite(input.frequency) &&
    input.frequency >= 0 &&
    typeof input.lastOpen === "number" &&
    Number.isFinite(input.lastOpen) &&
    input.lastOpen >= 0
  )
}

export function parseFrecencyLine(line: string): FrecencyEntry | undefined {
  try {
    const parsed = JSON.parse(line)
    if (!isFrecencyEntry(parsed)) return undefined
    return {
      path: parsed.path,
      frequency: parsed.frequency,
      lastOpen: parsed.lastOpen,
    }
  } catch {
    return undefined
  }
}
