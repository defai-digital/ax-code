export const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null
}

export const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  return isRecord(value) && !Array.isArray(value)
}
