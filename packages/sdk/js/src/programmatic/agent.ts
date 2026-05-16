import type { Agent, AgentOptions } from "./types.js"

type Mod = {
  createAgent(options: AgentOptions): Promise<Agent>
}

const load = Function('return import("ax-code/sdk/programmatic")') as () => Promise<Mod>

export async function createAgent(options: AgentOptions): Promise<Agent> {
  const mod = await load()
  return mod.createAgent(options)
}
