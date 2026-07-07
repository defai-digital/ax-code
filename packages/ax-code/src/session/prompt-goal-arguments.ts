type GoalArgumentDecision =
  | { action: "view" | "pause" | "resume" | "clear" }
  | { action: "error"; message: string }
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
  // Match ANY value token, then validate: a malformed value (negative,
  // decimal, non-numeric) must surface as an explicit error — previously it
  // fell through to goal creation with the raw "--budget -5 ..." text as
  // the objective, silently dropping the budget.
  const budgetMatch = /^--(?:token-)?budget(?:\s+|=)(\S+)(?:\s+([\s\S]+))?$/i.exec(text)
  if (budgetMatch) {
    const value = budgetMatch[1] ?? ""
    if (!/^\d+$/.test(value)) {
      return {
        action: "error",
        message: `Invalid --budget value "${value}": expected a positive whole number of tokens (e.g. /goal --budget 500000 <objective>).`,
      }
    }
    const objective = budgetMatch[2]?.trim()
    // --budget N without an objective is not a valid create — treat as view
    if (!objective) return { action: "view" }
    return {
      action: "create",
      tokenBudget: Number(value),
      objective,
    }
  }
  return { action: "create", objective: text }
}
