import type { ModelID, ProviderID } from "../provider/schema"
import { resolvePromptParts } from "./prompt-reference-parts"

export async function commandParts(input: {
  agent: { mode?: string; name: string }
  command: { subtask?: boolean; description?: string }
  name: string
  model: { providerID: ProviderID; modelID: ModelID }
  template: string
  parts?: any[]
}) {
  const base = await resolvePromptParts(input.template)
  const hasExtra = [...base, ...(input.parts ?? [])].some((item) => item.type !== "text")
  const subtask =
    !hasExtra &&
    ((input.agent.mode === "subagent" && input.command.subtask !== false) || input.command.subtask === true)
  if (!subtask) return { subtask, parts: [...base, ...(input.parts ?? [])] }

  return {
    subtask,
    parts: [
      {
        type: "subtask" as const,
        agent: input.agent.name,
        description: input.command.description ?? "",
        command: input.name,
        model: {
          providerID: input.model.providerID,
          modelID: input.model.modelID,
        },
        prompt: base.find((item) => item.type === "text")?.text ?? "",
      },
    ],
  }
}
