import path from "path"
import fs from "fs/promises"
import { Agent } from "../agent/agent"
import { Flag } from "../flag/flag"
import { Filesystem } from "../util/filesystem"
import { Session } from "."
import { MessageV2 } from "./message-v2"
import PROMPT_PLAN from "../session/prompt/plan.txt"
import BUILD_SWITCH from "../session/prompt/build-switch.txt"
import { autonomousDecisionLedgerReminder } from "./prompt-autonomous-ledger"
import { syntheticTextPart } from "./prompt-message-builders"

type InsertRemindersInput = {
  messages: MessageV2.WithParts[]
  agent: Agent.Info
  session: Session.Info
}

const PLAN_MODE_REMINDER = (input: { plan: string; exists: boolean }) => `<system-reminder>
Plan mode is active. The user indicated that they do not want you to execute yet -- you MUST NOT make any edits (with the exception of the plan file mentioned below), run any non-readonly tools (including changing configs or making commits), or otherwise make any changes to the system. This supersedes any other instructions you have received.

## Plan File Info:
${input.exists ? `A plan file already exists at ${input.plan}. You can read it and make incremental edits using the edit tool.` : `No plan file exists yet. You should create your plan at ${input.plan} using the write tool.`}
You should build your plan incrementally by writing to or editing this file. NOTE that this is the only file you are allowed to edit - other than this you are only allowed to take READ-ONLY actions.

## Plan Workflow

### Phase 1: Initial Understanding
Goal: Gain a comprehensive understanding of the user's request by reading through code and asking them questions. Critical: In this phase you should only use the explore subagent type.

1. Focus on understanding the user's request and the code associated with their request

2. **Launch up to 3 explore agents IN PARALLEL** (single message, multiple tool calls) to efficiently explore the codebase.
   - Use 1 agent when the task is isolated to known files, the user provided specific file paths, or you're making a small targeted change.
   - Use multiple agents when: the scope is uncertain, multiple areas of the codebase are involved, or you need to understand existing patterns before planning.
   - Quality over quantity - 3 agents maximum, but you should try to use the minimum number of agents necessary (usually just 1)
   - If using multiple agents: Provide each agent with a specific search focus or area to explore. Example: One agent searches for existing implementations, another explores related components, a third investigates testing patterns

3. After exploring the code, use the question tool to clarify ambiguities in the user request up front.

### Phase 2: Design
Goal: Design an implementation approach.

Launch general agent(s) to design the implementation based on the user's intent and your exploration results from Phase 1.

You can launch up to 1 agent(s) in parallel.

**Guidelines:**
- **Default**: Launch at least 1 Plan agent for most tasks - it helps validate your understanding and consider alternatives
- **Skip agents**: Only for truly trivial tasks (typo fixes, single-line changes, simple renames)

Examples of when to use multiple agents:
- The task touches multiple parts of the codebase
- It's a large refactor or architectural change
- There are many edge cases to consider
- You'd benefit from exploring different approaches

Example perspectives by task type:
- New feature: simplicity vs performance vs maintainability
- Bug fix: root cause vs workaround vs prevention
- Refactoring: minimal change vs clean architecture

In the agent prompt:
- Provide comprehensive background context from Phase 1 exploration including filenames and code path traces
- Describe requirements and constraints
- Request a detailed implementation plan

### Phase 3: Review
Goal: Review the plan(s) from Phase 2 and ensure alignment with the user's intentions.
1. Read the critical files identified by agents to deepen your understanding
2. Ensure that the plans align with the user's original request
3. Use question tool to clarify any remaining questions with the user

### Phase 4: Final Plan
Goal: Write your final plan to the plan file (the only file you can edit).
- Include only your recommended approach, not all alternatives
- Ensure that the plan file is concise enough to scan quickly, but detailed enough to execute effectively
- Include the paths of critical files to be modified
- Include a verification section describing how to test the changes end-to-end (run the code, use MCP tools, run tests)

### Phase 5: Call plan_exit tool
At the very end of your turn, once you have asked the user questions and are happy with your final plan file - you should always call plan_exit to indicate to the user that you are done planning.
This is critical - your turn should only end with either asking the user a question or calling plan_exit. Do not stop unless it's for these 2 reasons.

**Important:** Use question tool to clarify requirements/approach, use plan_exit to request plan approval. Do NOT use question tool to ask "Is this plan okay?" - that's what plan_exit does.

NOTE: At any point in time through this workflow you should feel free to ask the user questions or clarifications. Don't make large assumptions about user intent. The goal is to present a well researched plan to the user, and tie any loose ends before implementation begins.
</system-reminder>`

export async function insertReminders(input: InsertRemindersInput) {
  const userMsg = input.messages.findLast((msg) => msg.info.role === "user")
  if (!userMsg) return input.messages
  // Shallow-copy to avoid mutating cached message parts
  const userMessage = { ...userMsg, parts: [...userMsg.parts] }
  const messages = input.messages.map((m) => (m === userMsg ? userMessage : m))
  const appendSyntheticReminder = (text: string) => {
    userMessage.parts.push(
      syntheticTextPart({
        messageID: userMessage.info.id,
        sessionID: userMessage.info.sessionID,
        text,
      }),
    )
  }
  const autonomousDecisionLedger = Flag.AX_CODE_AUTONOMOUS
    ? autonomousDecisionLedgerReminder(input.messages)
    : undefined
  if (autonomousDecisionLedger) {
    appendSyntheticReminder(autonomousDecisionLedger)
  }

  if (!Flag.AX_CODE_EXPERIMENTAL_PLAN_MODE) {
    if (
      input.agent.name === "plan" &&
      !userMessage.parts.some((p) => p.type === "text" && p.synthetic && p.text === PROMPT_PLAN)
    ) {
      appendSyntheticReminder(PROMPT_PLAN)
    }
    const wasPlan = input.messages.some((msg) => msg.info.role === "assistant" && msg.info.agent === "plan")
    if (
      wasPlan &&
      input.agent.name === "build" &&
      !userMessage.parts.some((p) => p.type === "text" && p.synthetic && p.text === BUILD_SWITCH)
    ) {
      appendSyntheticReminder(BUILD_SWITCH)
    }
    return messages
  }

  const assistantMessage = input.messages.findLast((msg) => msg.info.role === "assistant")

  if (input.agent.name !== "plan" && assistantMessage?.info.agent === "plan") {
    const plan = Session.plan(input.session)
    const exists = await Filesystem.exists(plan)
    if (exists) {
      const part = await Session.updatePart(
        syntheticTextPart({
          messageID: userMessage.info.id,
          sessionID: userMessage.info.sessionID,
          text:
            BUILD_SWITCH + "\n\n" + `A plan file exists at ${plan}. You should execute on the plan defined within it`,
        }),
      )
      userMessage.parts.push(part)
    }
    return messages
  }

  if (input.agent.name === "plan" && assistantMessage?.info.agent !== "plan") {
    const plan = Session.plan(input.session)
    const exists = await Filesystem.exists(plan)
    if (!exists) await fs.mkdir(path.dirname(plan), { recursive: true })
    const part = await Session.updatePart(
      syntheticTextPart({
        messageID: userMessage.info.id,
        sessionID: userMessage.info.sessionID,
        text: PLAN_MODE_REMINDER({ plan, exists }),
      }),
    )
    userMessage.parts.push(part)
    return messages
  }
  return messages
}
