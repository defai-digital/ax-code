import { Wildcard } from "@/util/wildcard"

type Rule = {
  permission: string
  pattern: string
  action: "allow" | "deny" | "ask"
}

/** Relocated to AX Work. AX Code no longer has computer-use permissions. */
export const EXACT_GRANT_ONLY: ReadonlySet<string> = new Set()

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
