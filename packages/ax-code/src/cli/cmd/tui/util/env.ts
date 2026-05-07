export interface ParseIntegerEnvInput {
  env: Record<string, string | undefined>
  name: string
  fallback: number
  min?: number
}

export function parseIntegerEnv(input: ParseIntegerEnvInput): number {
  const value = input.env[input.name]
  if (!value) return input.fallback

  const parsed = Number(value)
  const min = input.min ?? Number.NEGATIVE_INFINITY
  return Number.isInteger(parsed) && parsed >= min ? parsed : input.fallback
}
