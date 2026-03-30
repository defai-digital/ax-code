/**
 * Rule: missing-form-labels
 * Detects form inputs without associated labels (accessibility)
 */

import type { Rule, Violation } from "../types"

const INPUT_PATTERN = /<input\b[^>]*>/gi

export const missingFormLabels: Rule = {
  name: "missing-form-labels",
  description: "Form inputs must have associated labels for accessibility",
  defaultSeverity: "error",

  check(content: string, file: string): Violation[] {
    const violations: Violation[] = []
    const lines = content.split("\n")

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      INPUT_PATTERN.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = INPUT_PATTERN.exec(line)) !== null) {
        const tag = match[0]
        // Skip hidden inputs and buttons
        if (tag.includes('type="hidden"') || tag.includes('type="submit"') || tag.includes('type="button"')) continue

        const hasLabel = tag.includes("aria-label") || tag.includes("aria-labelledby") || tag.includes("id=")
        // Check if there's a <label> nearby (simple heuristic: within 2 lines before)
        const prevLines = lines.slice(Math.max(0, i - 2), i + 1).join("\n")
        const hasLabelElement = prevLines.includes("<label") || prevLines.includes("<Label")

        if (!hasLabel && !hasLabelElement) {
          violations.push({
            rule: "missing-form-labels",
            severity: "error",
            file,
            line: i + 1,
            column: match.index + 1,
            message: "<input> missing label — add aria-label, aria-labelledby, or a <label> element",
          })
        }
      }
    }

    return violations
  },
}
