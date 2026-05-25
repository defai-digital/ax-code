export function resolveCurrentAgent<
  T extends { name: string; displayName?: string; model?: unknown } = {
    name: string
    displayName?: string
    model?: unknown
  },
>(agents: T[], current: string): T {
  const match = agents.find((x) => x.name === current)
  if (match) return match
  const first = agents[0]
  if (first) return first
  return {
    name: current,
    displayName: "Agent",
    model: undefined,
  } as T
}

export function normalizeModelVariantStore(input: unknown): Record<string, string | undefined> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {}
  return Object.fromEntries(
    Object.entries(input).filter(
      (entry): entry is [string, string | undefined] => entry[1] === undefined || typeof entry[1] === "string",
    ),
  )
}
