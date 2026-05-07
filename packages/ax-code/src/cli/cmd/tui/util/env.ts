export interface ParseIntegerEnvInput {
  env: Record<string, string | undefined>
  name: string
  fallback: number
  min?: number
}

export function pickFirstEnvValue(input: {
  env: Record<string, string | undefined>
  names: readonly string[]
}): string | undefined {
  for (const name of input.names) {
    const value = input.env[name]
    if (value) return value
  }
  return undefined
}

export function parseIntegerEnv(input: ParseIntegerEnvInput): number {
  const value = input.env[input.name]
  if (!value) return input.fallback

  const parsed = Number(value)
  const min = input.min ?? Number.NEGATIVE_INFINITY
  return Number.isInteger(parsed) && parsed >= min ? parsed : input.fallback
}
