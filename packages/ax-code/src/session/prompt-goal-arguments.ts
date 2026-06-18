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

  // The flag is matched case-insensitively to stay consistent with the
  // pause/resume/clear keywords above (which compare against `lower`).
  const budgetMatch = /^--(?:token-)?budget(?:\s+|=)(\d+)(?:\s+([\s\S]+))?$/i.exec(text)
  if (budgetMatch) {
    const objective = budgetMatch[2]?.trim()
    if (!objective) return { action: "view" }
    return {
      action: "create",
      tokenBudget: Number(budgetMatch[1]),
      objective,
    }
  }
  // --budget N without an objective is not a valid create — treat as view
  if (/^--(?:token-)?budget(?:\s+|=)\d+$/i.test(text)) return { action: "view" }
  return { action: "create", objective: text }
}
