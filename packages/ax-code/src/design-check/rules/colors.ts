/**
 * Rule: no-hardcoded-colors
 * Detects hex, rgb, hsl, and named colors not using design tokens
 */

import type { Rule, Violation } from "../types"

const HEX_PATTERN = /#(?:[0-9a-fA-F]{3,4}){1,2}\b/g
const RGB_PATTERN = /rgba?\s*\([^)]+\)/g
const HSL_PATTERN = /hsla?\s*\([^)]+\)/g

// Common CSS named colors to flag
const NAMED_COLORS = new Set([
  "red",
  "blue",
  "green",
  "yellow",
  "orange",
  "purple",
  "pink",
  "black",
  "white",
  "gray",
  "grey",
  "cyan",
  "magenta",
  "lime",
  "navy",
  "teal",
  "maroon",
  "olive",
])

export const noHardcodedColors: Rule = {
  name: "no-hardcoded-colors",
  description: "Use design tokens instead of hardcoded color values",
  defaultSeverity: "error",

  check(content: string, file: string): Violation[] {
    const violations: Violation[] = []
    const lines = content.split("\n")

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      // Skip comments
      if (line.trim().startsWith("//") || line.trim().startsWith("*") || line.trim().startsWith("/*")) continue

      // Check hex colors
      let match: RegExpExecArray | null
      HEX_PATTERN.lastIndex = 0
      while ((match = HEX_PATTERN.exec(line)) !== null) {
        violations.push({
          rule: "no-hardcoded-colors",
          severity: "error",
          file,
          line: i + 1,
          column: match.index + 1,
          message: `Hardcoded color "${match[0]}" — use a design token instead`,
        })
      }

      // Check rgb/rgba
      RGB_PATTERN.lastIndex = 0
      while ((match = RGB_PATTERN.exec(line)) !== null) {
        violations.push({
          rule: "no-hardcoded-colors",
          severity: "error",
          file,
          line: i + 1,
          column: match.index + 1,
          message: `Hardcoded color "${match[0]}" — use a design token instead`,
        })
      }

      // Check hsl/hsla
      HSL_PATTERN.lastIndex = 0
      while ((match = HSL_PATTERN.exec(line)) !== null) {
        violations.push({
          rule: "no-hardcoded-colors",
          severity: "error",
          file,
          line: i + 1,
          column: match.index + 1,
          message: `Hardcoded color "${match[0]}" — use a design token instead`,
        })
      }
    }

    return violations
  },
}
