export function resolveCurrentAgent<
  T extends { name: string; displayName?: string; model?: unknown } = {
    name: string
    displayName?: string
    model?: unknown
  },
>(
  agents: T[],
  current: string,
): T {
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
