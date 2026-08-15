import type { Agent } from "../agent/agent"
import { providerModelKey } from "../provider/model-key"
import type { ProviderID } from "../provider/schema"
import { InstructionPrompt } from "./instruction"
import type { MessageV2 } from "./message-v2"
import { SystemPrompt } from "./system"

type SystemCache = {
  environment?: string[]
  environmentModelKey?: string
  instructions?: string[]
  skills?: string | undefined
  skillsAgentKey?: string
  skillsLastMsgID?: string
  skillsFn?: Function
}

export async function systemPrompt(input: {
  agent: Agent.Info
  model: { providerID: ProviderID; api: { id: string } }
  format: { type: string }
  cache: SystemCache
  messages?: MessageV2.WithParts[]
  skills?: typeof SystemPrompt.skills
  environment?: typeof SystemPrompt.environment
  instructions?: typeof InstructionPrompt.system
  memory?: typeof SystemPrompt.memory
  structuredPrompt?: string
}) {
  // Skills caching:
  //   The skills section only changes when (a) the agent changes, (b) the
  //   skillsFn changes, or (c) a new file-tool call enters the conversation
  //   (which can change recommended-skill matches). Keying on raw msgCount
  //   would invalidate every loop step, forcing a re-walk of the entire
  //   message history through extractFilePaths + Skill.matchByPaths on each
  //   step, which adds measurable per-step latency on long sessions. Track
  //   the last processed message ID instead, and only recompute when a
  //   newly-added message actually contains a file-tool call.
  const skillsFn = input.skills ?? SystemPrompt.skills
  const messages = input.messages ?? []
  const lastMsgID = messages[messages.length - 1]?.info.id

  let recompute =
    input.cache.skills === undefined ||
    input.cache.skillsAgentKey !== input.agent.name ||
    input.cache.skillsFn !== skillsFn

  if (!recompute && lastMsgID !== input.cache.skillsLastMsgID) {
    const sinceID = input.cache.skillsLastMsgID
    const sinceIdx = sinceID ? messages.findIndex((m) => m.info.id === sinceID) : -1
    // sinceID present but missing from current set means history was
    // truncated by compaction. Recompute from scratch to avoid stale
    // recommendations.
    if (sinceID && sinceIdx === -1) recompute = true
    else recompute = SystemPrompt.hasFileToolCall(messages.slice(sinceIdx + 1))
  }

  if (recompute) {
    input.cache.skills = await skillsFn(input.agent, input.messages)
    input.cache.skillsAgentKey = input.agent.name
    input.cache.skillsFn = skillsFn
  }
  input.cache.skillsLastMsgID = lastMsgID
  const skills = input.cache.skills

  // Project memory is intentionally not cached. The loader is a single
  // file read + JSON.parse + string concat (sub-millisecond on typical
  // memory.json), so the cache savings are negligible. Caching across
  // prompt loops would make a mid-session `ax-code memory remember`
  // invisible to the agent until session restart, breaking the
  // user-curated entry contract.
  const memoryFn = input.memory ?? SystemPrompt.memory
  const memory = await memoryFn(input.agent, input.messages)
  const assuranceWorkflow = SystemPrompt.assuranceWorkflow(input.agent, input.model)

  const modelKey = providerModelKey({ providerID: input.model.providerID, modelID: input.model.api.id })
  if (!input.cache.environment || input.cache.environmentModelKey !== modelKey) {
    input.cache.environment = await (input.environment ?? SystemPrompt.environment)(input.model as any)
    input.cache.environmentModelKey = modelKey
  }
  if (!input.cache.instructions) input.cache.instructions = await (input.instructions ?? InstructionPrompt.system)()

  // Cache-stability invariant: everything in this array must be stable within
  // a session. The provider-side prompt cache keys on the system/history
  // prefix, so per-turn dynamic state (session goal, pending todos, decision
  // hints, intelligence nudge) deliberately does NOT live here — it is
  // rendered as a synthetic <turn_context> part on the last user message by
  // prompt-turn-context.ts / prompt-reminders.ts instead.
  const system = [
    ...input.cache.environment,
    ...(assuranceWorkflow ? [assuranceWorkflow] : []),
    ...(memory ? [memory] : []),
    ...(skills ? [skills] : []),
    ...input.cache.instructions,
  ]
  if (input.format.type === "json_schema" && input.structuredPrompt) {
    system.push(input.structuredPrompt)
  }
  return system
}
