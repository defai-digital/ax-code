type GoalArgumentDecision =
  | { action: "view" | "pause" | "resume" | "clear" }
  | { action: "error"; message: string }
  | { action: "revise"; correction: string }
  | {
      action: "create" | "replace"
      objective: string
      tokenBudget?: number
      timeBudgetSeconds?: number
      /**
       * Run the plan writer and require an assurance contract. Opt-in: without
       * it a goal starts immediately and completes under the basic gate (item 2,
       * option A).
       */
      assure?: true
    }

// Wall-clock budget units for --time-budget: bare numbers are seconds, with
// m/h suffixes for the units people actually think in for expensive runs
// (e.g. /goal --time-budget 30m <objective>). Adopted from the kimi-code
// goal-mode design (wallClockBudgetMs), stored in seconds.
const TIME_BUDGET_UNITS: Record<string, number> = { s: 1, m: 60, h: 3600 }

function parseTimeBudget(raw: string): number | undefined {
  const match = /^(\d+)([smh])?$/i.exec(raw)
  if (!match) return undefined
  const seconds = Number(match[1]) * (TIME_BUDGET_UNITS[(match[2] ?? "s").toLowerCase()] ?? 1)
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : undefined
}

const TOKEN_BUDGET_HINT = "a positive whole number of tokens (e.g. /goal --budget 500000 <objective>)"
const TIME_BUDGET_HINT = "a positive duration in seconds, minutes, or hours (e.g. /goal --time-budget 30m <objective>)"

export function parseGoalArguments(raw: string): GoalArgumentDecision {
  let text = raw.trim()
  if (!text) return { action: "view" }
  const lower = text.toLowerCase()
  if (lower === "pause") return { action: "pause" }
  if (lower === "resume") return { action: "resume" }
  if (lower === "clear") return { action: "clear" }
  if (lower === "revise")
    return {
      action: "error",
      message: "Use /goal revise <correction> to revise the frozen plan while retaining its history and budget.",
    }
  if (lower.startsWith("revise ")) return { action: "revise", correction: text.slice(7).trim() }
  // "replace" supersedes the current goal with a new one (any state). Like
  // "revise", the leading keyword is reserved: "/goal replace the parser"
  // supersedes with objective "the parser" rather than creating a goal whose
  // objective starts with the word "replace" — the same tradeoff revise makes.
  if (lower === "replace")
    return {
      action: "error",
      message: "Use /goal replace <objective> to supersede the current goal with a new one.",
    }
  let action: "create" | "replace" = "create"
  if (lower.startsWith("replace ")) {
    action = "replace"
    text = text.slice("replace ".length).trim()
  }
  // "status" is a common way to ask for the current goal; without this alias
  // it would silently CREATE a goal whose objective is the word "status".
  if (lower === "status") return { action: "view" }

  // Leading budget flags may combine in either order:
  // /goal --budget 500000 --time-budget 2h <objective>. Flags are matched
  // case-insensitively to stay consistent with the control keywords above.
  // Match ANY value token, then validate: a malformed value (negative,
  // decimal, non-numeric) must surface as an explicit error — previously it
  // fell through to goal creation with the raw "--budget -5 ..." text as
  // the objective, silently dropping the budget.
  let rest = text
  let tokenBudget: number | undefined
  let timeBudgetSeconds: number | undefined
  let assure: boolean | undefined
  let lastFlag: string | undefined
  let lastValue: string | undefined
  for (;;) {
    // `--budgeting is hard` is a plain objective: the flag word must be
    // followed by whitespace, `=`, or the end of the input.
    // Boolean flag, so it consumes no value: `/goal --assure <objective>`.
    const bare = /^(--assure)(?=[\s=]|$)/i.exec(rest)
    if (bare) {
      const after = rest.slice(bare[0].length)
      if (after.startsWith("=")) {
        return { action: "error", message: `${bare[1]} takes no value (e.g. /goal --assure <objective>).` }
      }
      assure = true
      rest = after.replace(/^\s+/, "")
      continue
    }
    const flag = /^(--token-budget|--time-budget|--budget)(?=[\s=]|$)/i.exec(rest)
    if (!flag) break
    const name = flag[1]!.toLowerCase()
    const isTime = name === "--time-budget"
    const hint = isTime ? TIME_BUDGET_HINT : TOKEN_BUDGET_HINT
    const after = rest.slice(flag[0].length)
    let value: string
    let consumed: number
    if (after.startsWith("=")) {
      // "=" must be followed immediately by the value: "--budget= fix the
      // bug" has an empty value and must error, not swallow "fix".
      value = /^\S*/.exec(after.slice(1))![0]
      consumed = flag[0].length + 1 + value.length
    } else if (/^\s/.test(after)) {
      const body = after.replace(/^\s+/, "")
      value = /^\S*/.exec(body)![0]
      consumed = flag[0].length + (after.length - body.length) + value.length
    } else {
      value = ""
      consumed = flag[0].length
    }
    // A budget flag whose value is missing or empty ("--budget", "--budget=")
    // must error explicitly instead of falling through to goal creation with
    // the raw flag text as the objective and NO budget applied.
    if (!value) {
      return { action: "error", message: `Invalid ${name} value: expected ${hint}.` }
    }
    if (isTime) {
      if (timeBudgetSeconds !== undefined)
        return { action: "error", message: "--time-budget was specified more than once." }
      const parsed = parseTimeBudget(value)
      if (parsed === undefined) {
        return { action: "error", message: `Invalid --time-budget value "${value}": expected ${TIME_BUDGET_HINT}.` }
      }
      timeBudgetSeconds = parsed
    } else {
      if (tokenBudget !== undefined) return { action: "error", message: "--budget was specified more than once." }
      if (!/^\d+$/.test(value)) {
        return { action: "error", message: `Invalid --budget value "${value}": expected ${TOKEN_BUDGET_HINT}.` }
      }
      tokenBudget = Number(value)
    }
    lastFlag = name
    lastValue = value
    rest = rest.slice(consumed).replace(/^\s+/, "")
  }

  // A flag after the objective is a flag, not objective text: leaving
  // "--assure" in the objective reads like a typo, turns assurance off while the
  // user believes it is on, and the goal planner then freezes an objective
  // carrying a stray flag. Only the trailing token is read this way, so an
  // objective that mentions the flag mid-sentence stays prose.
  const trailingAssure = /(?:^|\s)(--assure)(?:=(\S*))?\s*$/i.exec(rest)
  if (trailingAssure) {
    if (trailingAssure[2] !== undefined) {
      return { action: "error", message: `--assure takes no value (e.g. /goal --assure <objective>).` }
    }
    assure = true
    rest = rest.slice(0, trailingAssure.index).trim()
  }

  if (assure === true && !rest) {
    return {
      action: "error",
      message:
        `--assure requires a goal objective (e.g. /goal --assure <objective>). ` +
        `Assurance applies only to a new goal; run /goal with no arguments to view the current goal.`,
    }
  }
  if (tokenBudget !== undefined || timeBudgetSeconds !== undefined) {
    // --budget N without an objective is not a valid create. Error explicitly
    // instead of silently showing the goal view — the user's intent (set a
    // budget) cannot be honored, and budgets of existing goals are immutable.
    if (!rest) {
      return {
        action: "error",
        message:
          `${lastFlag} requires a goal objective (e.g. /goal ${lastFlag} ${lastValue} <objective>). ` +
          `A budget applies only to a new goal; run /goal with no arguments to view the current goal.`,
      }
    }
    return {
      action,
      ...(tokenBudget === undefined ? {} : { tokenBudget }),
      ...(timeBudgetSeconds === undefined ? {} : { timeBudgetSeconds }),
      ...(assure === true ? { assure } : {}),
      objective: rest,
    }
  }
  return { action, ...(assure === true ? { assure } : {}), objective: rest }
}
