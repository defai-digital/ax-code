/**
 * Rule: missing-alt-text
 * Detects images without alt attributes (accessibility)
 */

import type { Rule, Violation } from "../types"

const IMG_PATTERN = /<img\b[^>]*>/gi

export const missingAltText: Rule = {
  name: "missing-alt-text",
  description: "Images must have alt attributes for accessibility",
  defaultSeverity: "error",

  check(content: string, file: string): Violation[] {
    const violations: Violation[] = []
    const lines = content.split("\n")

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      IMG_PATTERN.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = IMG_PATTERN.exec(line)) !== null) {
        const tag = match[0]
        if (!tag.includes("alt=") && !tag.includes("alt =")) {
          violations.push({
            rule: "missing-alt-text",
            severity: "error",
            file,
            line: i + 1,
            column: match.index + 1,
            message: '<img> missing alt attribute — add alt="" for decorative or alt="description" for informative images',
          })
        }
      }
    }

    return violations
  },
}
