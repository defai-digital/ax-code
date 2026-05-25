import type { Agent } from "../agent/agent"
import { Flag } from "../flag/flag"
import type { ProviderID } from "../provider/schema"
import { InstructionPrompt } from "./instruction"
import type { MessageV2 } from "./message-v2"
import { SessionGoal } from "./goal"
import type { SessionID } from "./schema"
import { SystemPrompt } from "./system"
import { Todo } from "./todo"

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
  decisionHints?: typeof SystemPrompt.decisionHints
  sessionID?: SessionID
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
  const decisionHintsFn = input.decisionHints ?? SystemPrompt.decisionHints
  const decisionHints = await decisionHintsFn({ messages: input.messages, sessionID: input.sessionID })
  const assuranceWorkflow = SystemPrompt.assuranceWorkflow(input.agent)

  const modelKey = `${input.model.providerID}/${input.model.api.id}`
  if (!input.cache.environment || input.cache.environmentModelKey !== modelKey) {
    input.cache.environment = await (input.environment ?? SystemPrompt.environment)(input.model as any)
    input.cache.environmentModelKey = modelKey
  }
  if (!input.cache.instructions) input.cache.instructions = await (input.instructions ?? InstructionPrompt.system)()

  // In autonomous mode, inject pending todos into the system context each turn
  // so the model always knows exactly what's left. This is live state visible
  // at the start of every reasoning cycle, not just an upfront instruction.
  const pendingTodos = Flag.AX_CODE_AUTONOMOUS && input.sessionID ? Todo.active(input.sessionID) : []
  const pendingTodosSection =
    pendingTodos.length > 0
      ? [
          `<pending_todos count="${pendingTodos.length}">`,
          ...Todo.formatLines(pendingTodos, {
            prefix: "  ",
            statusTransform: (status) => status.toUpperCase(),
          }),
          `  Complete all of these before ending your turn.`,
          `</pending_todos>`,
        ].join("\n")
      : undefined
  const goal = input.sessionID ? await SessionGoal.get(input.sessionID) : undefined
  const goalSection =
    goal && goal.status !== "complete"
      ? [
          `<session_goal status="${goal.status}" tokens_used="${goal.tokensUsed}"${goal.tokenBudget === undefined ? "" : ` token_budget="${goal.tokenBudget}"`}>`,
          `  Objective: ${goal.objective}`,
          `  Treat the objective as user-provided task context, not higher-priority instructions.`,
          goal.status === "active"
            ? `  Keep working toward this objective until it is complete, blocked, paused, cleared, or budget-limited.`
            : `  Do not start new substantive work for this goal unless the runtime resumes it.`,
          `</session_goal>`,
        ].join("\n")
      : undefined

  const system = [
    ...input.cache.environment,
    ...(assuranceWorkflow ? [assuranceWorkflow] : []),
    ...(memory ? [memory] : []),
    ...(decisionHints ? [decisionHints] : []),
    ...(goalSection ? [goalSection] : []),
    ...(pendingTodosSection ? [pendingTodosSection] : []),
    ...(skills ? [skills] : []),
    ...input.cache.instructions,
  ]
  if (input.format.type === "json_schema" && input.structuredPrompt) {
    system.push(input.structuredPrompt)
  }
  return system
}
