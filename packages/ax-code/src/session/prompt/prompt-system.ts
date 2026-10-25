import type { Agent } from "../../agent/agent"
import { ScopedFlag } from "../../flag/scoped"
import { providerModelKey } from "../../provider/model-key"
import type { ProviderID } from "../../provider/schema"
import { InstructionPrompt } from "../instruction"
import { MCP } from "../../mcp"
import type { MessageV2 } from "../message-v2"
import { SystemPrompt } from "../system"

/** Approximate token cap on project memory for a compact (tool-less) turn. */
export const COMPACT_MEMORY_TOKENS = 1500

type SystemCache = {
  environment?: string[]
  environmentModelKey?: string
  instructions?: string[]
  skills?: string | undefined
  skillsAgentKey?: string
  skillsLastMsgID?: string
  skillsMsgCount?: number
  skillsFn?: Function
}

export async function systemPrompt(input: {
  agent: Agent.Info
  model: { providerID: ProviderID; api: { id: string }; limit?: { context?: number } }
  format: { type: string }
  cache: SystemCache
  messages?: MessageV2.WithParts[]
  skills?: typeof SystemPrompt.skills
  environment?: typeof SystemPrompt.environment
  environmentOverride?: string[]
  /**
   * Compact turn (tools omitted): the skill list only instructs the model to
   * call the `skill` tool, so it is dropped, and project memory keeps only its
   * most actionable entries. Required instructions are never trimmed.
   */
  compact?: boolean
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

  // A history that shrank while keeping its last message (compaction that
  // preserves the tail) would otherwise pass the last-ID check below and keep
  // recommendations derived from dropped file calls.
  if (!recompute && input.cache.skillsMsgCount !== undefined && messages.length < input.cache.skillsMsgCount) {
    recompute = true
  }

  if (!recompute && lastMsgID !== input.cache.skillsLastMsgID) {
    const sinceID = input.cache.skillsLastMsgID
    const sinceIdx = sinceID ? messages.findIndex((m) => m.info.id === sinceID) : -1
    // sinceID present but missing from current set means history was
    // truncated by compaction. Recompute from scratch to avoid stale
    // recommendations.
    if (sinceID && sinceIdx === -1) recompute = true
    else recompute = SystemPrompt.hasFileToolCall(messages.slice(sinceIdx + 1))
  }

  if (recompute && !input.compact) {
    input.cache.skills = await skillsFn(input.agent, input.messages)
    input.cache.skillsAgentKey = input.agent.name
    input.cache.skillsFn = skillsFn
  }
  if (!input.compact) {
    input.cache.skillsLastMsgID = lastMsgID
    input.cache.skillsMsgCount = messages.length
  }
  const skills = input.compact ? undefined : input.cache.skills

  // Project memory is intentionally not cached. The loader is a single
  // file read + JSON.parse + string concat (sub-millisecond on typical
  // memory.json), so the cache savings are negligible. Caching across
  // prompt loops would make a mid-session `ax-code memory remember`
  // invisible to the agent until session restart, breaking the
  // user-curated entry contract.
  const memoryFn = input.memory ?? SystemPrompt.memory
  const memory = await memoryFn(
    input.agent,
    input.messages,
    input.model,
    input.compact ? { maxTokens: COMPACT_MEMORY_TOKENS } : undefined,
  )
  const assuranceWorkflow = SystemPrompt.assuranceWorkflow(input.agent, input.model)

  // SystemPrompt.environment() also reads the live, runtime-mutable
  // autonomous flag (ScopedFlag.autonomous()), which can be toggled mid-session
  // via the autonomous route with no model change. The cache key must include
  // it too, or a mid-turn toggle keeps serving a stale <autonomous_workflow>
  // block (present when it should be gone, or vice versa) until the model
  // happens to change.
  const modelKey = providerModelKey({ providerID: input.model.providerID, modelID: input.model.api.id })
  // The WebMCP bridge block appears when a bridge connects mid-session
  // (sidebar chip), so its tier is part of the key too.
  const webmcpTier = input.environment ? undefined : await MCP.webmcpPromptTier().catch(() => undefined)
  // The environment block prints "Today's date: …" (local timezone,
  // toDateString) so a long-running run that crosses midnight would
  // otherwise keep serving yesterday's date until the model or the
  // autonomous flag changes. Include the local YYYY-MM-DD in the cache
  // key so a new day forces a refresh; toDateString / new Date use the
  // local timezone, matching the rendered string.
  const localDateKey = (() => {
    const now = new Date()
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, "0")
    const d = String(now.getDate()).padStart(2, "0")
    return `${y}-${m}-${d}`
  })()
  const environmentCacheKey = `${modelKey}:${ScopedFlag.autonomous() ? "autonomous" : "manual"}:${webmcpTier ?? "nobridge"}:${localDateKey}`
  if (
    input.environmentOverride === undefined &&
    (!input.cache.environment || input.cache.environmentModelKey !== environmentCacheKey)
  ) {
    input.cache.environment = await (input.environment ?? SystemPrompt.environment)(input.model as any)
    input.cache.environmentModelKey = environmentCacheKey
  }
  if (!input.cache.instructions) input.cache.instructions = await (input.instructions ?? InstructionPrompt.system)()

  // Preserve the longest reusable instruction prefix. Environment refreshes,
  // live memory edits and path-sensitive skill recommendations must follow
  // required rules, not invalidate them. These remain system content; do not
  // freeze their values or demote user-curated instructions to user messages.
  // Per-turn state (goals, todos, decision hints and intelligence nudges)
  // remains in request-only <turn_context> parts instead.
  // Empty blocks are dropped from the array sources too: some providers
  // reject an empty system message, and a loader alternating between "" and
  // nothing would otherwise flicker the cached prefix.
  const system = [
    ...(assuranceWorkflow ? [assuranceWorkflow] : []),
    ...input.cache.instructions.filter(Boolean),
    ...(input.format.type === "json_schema" && input.structuredPrompt ? [input.structuredPrompt] : []),
    ...(input.environmentOverride ?? input.cache.environment ?? []).filter(Boolean),
    ...(memory ? [memory] : []),
    ...(skills ? [skills] : []),
  ]
  return system
}
