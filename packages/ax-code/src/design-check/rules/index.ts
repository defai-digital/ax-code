/**
 * Rule Registry
 */

import type { Rule } from "../types"
import { noHardcodedColors } from "./colors"
import { noRawSpacing } from "./spacing"
import { noInlineStyles } from "./inline-styles"
import { missingAltText } from "./alt-text"
import { missingFormLabels } from "./form-labels"

export const ALL_RULES: Rule[] = [
  noHardcodedColors,
  noRawSpacing,
  noInlineStyles,
  missingAltText,
  missingFormLabels,
]

export function getRuleByName(name: string): Rule | undefined {
  return ALL_RULES.find((r) => r.name === name)
}
