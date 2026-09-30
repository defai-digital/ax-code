import { Wildcard } from "@/util/wildcard"

type Rule = {
  permission: string
  pattern: string
  action: "allow" | "deny" | "ask"
}

/**
 * Permissions whose allow rules must name the permission and requested pattern
 * exactly. Computer use controls the real desktop and scheduling persists
 * future agent execution, so a broad agent/default wildcard must not silently
 * grant either. Explicit permission-specific config remains possible.
 */
export const EXACT_GRANT_ONLY: ReadonlySet<string> = new Set(["computer", "schedule"])

export function evaluate(permission: string, pattern: string, ...rulesets: Rule[][]): Rule {
  const rules = rulesets.flat()
  const match = rules.findLast((rule) => matches(permission, pattern, rule))
  return match ?? { action: "ask", permission, pattern: "*" }
}

function matches(permission: string, pattern: string, rule: Rule) {
  if (EXACT_GRANT_ONLY.has(permission)) {
    if (rule.action !== "allow") {
      return Wildcard.match(permission, rule.permission) && Wildcard.match(pattern, rule.pattern)
    }
    if (rule.permission !== permission) return false
    if (rule.pattern === "*") return true
    return rule.pattern === pattern
  }
  return Wildcard.match(permission, rule.permission) && Wildcard.match(pattern, rule.pattern)
}
