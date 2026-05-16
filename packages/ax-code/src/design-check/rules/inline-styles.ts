/**
 * Rule: no-inline-styles
 * Detects inline style attributes in JSX/HTML
 */

import type { Rule, Violation } from "../types"

const STYLE_ATTR_PATTERN = /style\s*=\s*\{/g
const HTML_STYLE_PATTERN = /style\s*=\s*"/g

export const noInlineStyles: Rule = {
  name: "no-inline-styles",
  description: "Avoid inline styles — use CSS classes or design tokens",
  defaultSeverity: "warn",

  check(content: string, file: string): Violation[] {
    const violations: Violation[] = []
    const lines = content.split("\n")

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line.trim().startsWith("//") || line.trim().startsWith("*")) continue

      STYLE_ATTR_PATTERN.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = STYLE_ATTR_PATTERN.exec(line)) !== null) {
        violations.push({
          rule: "no-inline-styles",
          severity: "warn",
          file,
          line: i + 1,
          column: match.index + 1,
          message: "Inline style attribute — use CSS classes instead",
        })
      }

      HTML_STYLE_PATTERN.lastIndex = 0
      while ((match = HTML_STYLE_PATTERN.exec(line)) !== null) {
        violations.push({
          rule: "no-inline-styles",
          severity: "warn",
          file,
          line: i + 1,
          column: match.index + 1,
          message: "Inline style attribute — use CSS classes instead",
        })
      }
    }

    return violations
  },
}
