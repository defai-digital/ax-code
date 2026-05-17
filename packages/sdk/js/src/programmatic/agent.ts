import type { Agent, AgentOptions } from "./types.js"

type Mod = {
  createAgent(options: AgentOptions): Promise<Agent>
}

const load = Function('return import("ax-code/sdk/programmatic")') as () => Promise<Mod>

function isMissingRuntimeError(error: unknown) {
  if (!error || typeof error !== "object") return false
  const value = error as { code?: unknown; message?: unknown }
  if (value.code !== "ERR_MODULE_NOT_FOUND" && value.code !== "MODULE_NOT_FOUND") return false
  return typeof value.message === "string" && value.message.includes("ax-code")
}

export async function createAgent(options: AgentOptions): Promise<Agent> {
  let mod: Mod
  try {
    mod = await load()
  } catch (error) {
    if (isMissingRuntimeError(error)) {
      throw new Error(
        "The @ax-code/sdk programmatic agent requires the ax-code runtime package to be installed and resolvable. Install a compatible ax-code runtime alongside @ax-code/sdk, or use @ax-code/sdk/http with ax-code serve.",
        { cause: error },
      )
    }
    throw error
  }
  return mod.createAgent(options)
}
