import { Agent } from "../agent/agent"
import { Config } from "../config/config"
import { ScopedFlag } from "../flag/scoped"
import type { MessageV2 } from "./message-v2"
import {
  autonomyBudgetDiagnostics,
  formatAutonomyBudgetReport,
  resolveAutonomyBudget,
} from "./autonomy-budget"
import { createStoppedAssistantTextResponse } from "./prompt-assistant-response"
import { commandModel } from "./prompt-command-selection"
import type { CommandInput } from "./prompt-input"
import { createUserMessage } from "./prompt-user-message"

// /limits doctor — print the resolved autonomy budget stack for this session
// (ADR-051 follow-up). Does not start a model turn.

async function limitsControlMessage(input: CommandInput, text: string): Promise<MessageV2.WithParts> {
  const model = await commandModel({ model: input.model, sessionID: input.sessionID })
  const user = await createUserMessage({
    sessionID: input.sessionID,
    messageID: input.messageID,
    agent: input.agent,
    model,
    agentRouting: "preserve",
    noReply: true,
    parts: [
      {
        type: "text",
        text: `/limits ${input.arguments}`.trim(),
      },
    ],
  })
  return createStoppedAssistantTextResponse({
    sessionID: input.sessionID,
    parent: user.info,
    text,
    tokenTotal: 0,
  })
}

export async function executeLimitsCommand(input: CommandInput): Promise<MessageV2.WithParts> {
  const args = (input.arguments ?? "").trim().toLowerCase()
  if (args === "help" || args === "-h" || args === "--help") {
    return limitsControlMessage(
      input,
      [
        "Usage: /limits",
        "",
        "Prints the resolved autonomous budget for this session: model-turn ceilings,",
        "tool-call / blast-radius caps, burst rate limit, tool-only stall breaker,",
        "active agent step override, and config sources.",
        "",
        "Configure via ax-code.json:",
        '  autonomy.profile: "quick" | "standard" | "long" | "goal" | "custom"',
        "  autonomy.budget.model_turns.per_segment / total",
        "  autonomy.budget.continuations",
        "  autonomy.budget.tool_calls.per_segment | rate | per_tool",
        "  autonomy.budget.changes.files_total | lines_total | blocked_paths",
        "  autonomy.stall.tool_only_turns | tool_only_nudge | tool_only_final_nudge",
        "  session.max_steps | max_continuations | max_total_steps (legacy aliases)",
        "  experimental.autonomous_caps.* (legacy blast-radius aliases)",
        "  agent.<name>.steps",
      ].join("\n"),
    )
  }

  const cfg = await Config.get()
  const budget = resolveAutonomyBudget(cfg)
  const agentName = input.agent
  let agentSteps: number | undefined
  if (agentName) {
    const agent = await Agent.get(agentName).catch(() => undefined)
    agentSteps = agent?.steps
  }

  const report = formatAutonomyBudgetReport({
    budget,
    agentName,
    agentSteps,
    autonomous: ScopedFlag.autonomous(),
  })
  const warnings = autonomyBudgetDiagnostics({ budget, agentSteps })
  const text =
    warnings.length === 0
      ? report
      : `${report}\n\nWarnings\n${warnings.map((w) => `  ! ${w}`).join("\n")}`

  return limitsControlMessage(input, text)
}
