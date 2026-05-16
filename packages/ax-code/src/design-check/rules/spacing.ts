/**
 * Rule: no-raw-spacing
 * Detects raw px values not using spacing tokens
 */

import type { Rule, Violation } from "../types"

const PX_PATTERN = /:\s*(\d+)px/g
const ALLOWED_PX = new Set(["0", "1", "2"]) // 0px, 1px, 2px are fine (borders)

export const noRawSpacing: Rule = {
  name: "no-raw-spacing",
  description: "Use spacing tokens instead of raw px values",
  defaultSeverity: "warn",

  check(content: string, file: string): Violation[] {
    const violations: Violation[] = []
    const lines = content.split("\n")

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line.trim().startsWith("//") || line.trim().startsWith("*")) continue

      PX_PATTERN.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = PX_PATTERN.exec(line)) !== null) {
        if (ALLOWED_PX.has(match[1])) continue
        violations.push({
          rule: "no-raw-spacing",
          severity: "warn",
          file,
          line: i + 1,
          column: match.index + 1,
          message: `Raw spacing "${match[1]}px" — use a spacing token instead`,
        })
      }
    }

    return violations
  },
}
