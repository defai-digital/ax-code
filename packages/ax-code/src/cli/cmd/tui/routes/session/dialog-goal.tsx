import { createMemo } from "solid-js"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import type { DialogContext } from "@tui/ui/dialog"
import type { SessionGoal } from "@/session/goal"

function goalSummary(goal: SessionGoal.PublicInfo | null | undefined) {
  if (!goal) return "No goal is set for this session."
  const budget = goal.tokenBudget === undefined ? "" : ` · ${goal.tokensUsed}/${goal.tokenBudget} tokens`
  return `${goal.status}: ${goal.objective}${budget}`
}

export function DialogGoal(props: { goal?: SessionGoal.PublicInfo | null; setPrompt: (value: string) => void }) {
  const options = createMemo((): DialogSelectOption<string>[] => {
    const goal = props.goal
    const items: DialogSelectOption<string>[] = [
      {
        title: goalSummary(goal),
        value: "goal.current",
        category: "Current",
      },
      {
        title: goal ? "View goal details" : "Check goal status",
        value: "goal.view",
        category: "Actions",
        onSelect: command(props.setPrompt, "/goal"),
      },
      {
        title: goal ? "Start a new goal after clearing this one" : "Start a new goal",
        value: "goal.start",
        category: "Actions",
        onSelect: command(props.setPrompt, "/goal "),
      },
    ]

    if (goal?.status === "active") {
      items.push({
        title: "Pause current goal",
        value: "goal.pause",
        category: "Actions",
        onSelect: command(props.setPrompt, "/goal pause"),
      })
    }

    // Resuming sets the goal back to active, which the server refuses when the
    // token budget is exhausted. Only offer Resume when it can actually succeed,
    // otherwise the action throws a budget error. (A budget-exhausted goal can
    // still be cleared or replaced with a new goal below.)
    const budgetExhausted = goal?.tokenBudget !== undefined && (goal?.remainingTokens ?? 0) <= 0
    if ((goal?.status === "paused" || goal?.status === "blocked") && !budgetExhausted) {
      items.push({
        title: "Resume current goal",
        value: "goal.resume",
        category: "Actions",
        onSelect: command(props.setPrompt, "/goal resume"),
      })
    }

    if (goal) {
      items.push({
        title: "Clear current goal",
        value: "goal.clear",
        category: "Actions",
        onSelect: command(props.setPrompt, "/goal clear"),
      })
    }

    return items
  })

  return <DialogSelect title="Session Goal" options={options()} skipFilter />
}

function command(setPrompt: (value: string) => void, value: string) {
  return (dialog: DialogContext) => {
    setPrompt(value)
    dialog.clear()
  }
}
