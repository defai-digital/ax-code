import { Wildcard } from "@/util/wildcard"

type Rule = {
  permission: string
  pattern: string
  action: "allow" | "deny" | "ask"
}

/** Allow rules must name the permission and pattern exactly (ADR-052). Deny may still wildcard. */
export const EXACT_GRANT_ONLY: ReadonlySet<string> = new Set([
  "computer_capture",
  "computer_input",
  "computer_commit",
])

export function evaluate(permission: string, pattern: string, ...rulesets: Rule[][]): Rule {
  const rules = rulesets.flat()
  const match = rules.findLast((rule) => matches(permission, pattern, rule))
  return match ?? { action: "ask", permission, pattern: "*" }
}

function matches(permission: string, pattern: string, rule: Rule) {
  if (EXACT_GRANT_ONLY.has(permission)) {
    if (rule.action === "deny") {
      return Wildcard.match(permission, rule.permission) && Wildcard.match(pattern, rule.pattern)
    }
    return rule.permission === permission && rule.pattern === pattern
  }
  return Wildcard.match(permission, rule.permission) && Wildcard.match(pattern, rule.pattern)
}
