import type { Tool } from "ai"

export const GOAL_BUDGET_TOOL_REJECTION =
  "The goal budget is exhausted. Only completion of already verified work is allowed during the final wrap-up."

/** Terminal output and the existing completion gate are the only capabilities. */
export function goalBudgetTools(tools: Record<string, Tool>): Record<string, Tool> {
  const terminal: Record<string, Tool> = {}
  for (const name of ["update_goal", "StructuredOutput"]) {
    const item = tools[name]
    if (!item) continue
    if (item.type === "provider") throw new Error("Provider-defined tools cannot enter goal budget wrap-up")
    if (name === "StructuredOutput") {
      terminal[name] = item
      continue
    }
    terminal[name] = {
      ...item,
      onInputStart: undefined,
      onInputDelta: undefined,
      onInputAvailable: undefined,
      async execute(args, options) {
        if (!args || typeof args !== "object" || !("status" in args) || args.status !== "complete") {
          throw new Error(GOAL_BUDGET_TOOL_REJECTION)
        }
        if (!item.execute) throw new Error(GOAL_BUDGET_TOOL_REJECTION)
        return item.execute(args, options)
      },
    }
  }
  return terminal
}
