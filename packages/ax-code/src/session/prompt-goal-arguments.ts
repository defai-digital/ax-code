type GoalArgumentDecision =
  | { action: "view" | "pause" | "resume" | "clear" }
  | {
      action: "create"
      objective: string
      tokenBudget?: number
    }

export function parseGoalArguments(raw: string): GoalArgumentDecision {
  const text = raw.trim()
  if (!text) return { action: "view" }
  const lower = text.toLowerCase()
  if (lower === "pause") return { action: "pause" }
  if (lower === "resume") return { action: "resume" }
  if (lower === "clear") return { action: "clear" }

  const budgetMatch = /^--(?:token-)?budget\s+(\d+)\s+([\s\S]+)$/.exec(text)
  if (budgetMatch) {
    return {
      action: "create",
      tokenBudget: Number(budgetMatch[1]),
      objective: budgetMatch[2].trim(),
    }
  }
  // --budget N without an objective is not a valid create — treat as view
  if (/^--(?:token-)?budget\s+\d+$/.test(text)) return { action: "view" }
  return { action: "create", objective: text }
}
