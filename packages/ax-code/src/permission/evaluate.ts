import { Wildcard } from "@/util/wildcard"

type Rule = {
  permission: string
  pattern: string
  action: "allow" | "deny" | "ask"
}

/**
 * Permissions whose allow rules must name the permission and requested pattern
 * exactly. Computer use controls the real desktop, so a broad agent/default
 * rule such as `{ permission: "*", pattern: "*", action: "allow" }` must not
 * silently grant it. An explicit computer-wide config remains possible through
 * `{ permission: "computer", pattern: "*", action: "allow" }`.
 */
export const EXACT_GRANT_ONLY: ReadonlySet<string> = new Set(["computer"])

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
