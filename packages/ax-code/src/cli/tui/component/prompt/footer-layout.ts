import { stringWidth } from "@/bun/node-compat"

const INLINE_STATUS_RESERVE = 36
const GROUP_GAP = 2

export type PromptFooterLayout = {
  stacked: boolean
  showVariants: boolean
  showShellHint: boolean
  showClearHint: boolean
}

export function footerHintWidth(key: string, label: string) {
  return stringWidth(key) + 1 + stringWidth(label)
}

/**
 * Measured widths of the footer content that is always shown. When present,
 * the hint budget comes from these real widths instead of the fixed inline
 * status reserve, so caller chips (Home's mode/WebMCP chips via `footerRight`)
 * and the context gauge are accounted for and the hints drop as whole groups
 * instead of being clipped mid-token at the right edge.
 */
export type PromptFooterMeasured = {
  /** Idle left-side text ("Finished", pending-submit status), 0 when empty. */
  leftWidth: number
  /** Context gauge box, including its right padding; 0 when hidden. */
  gaugeWidth: number
  /** Caller-supplied `footerRight` content; 0 when absent. */
  extraWidth: number
}

export function promptFooterLayout(input: {
  contentWidth: number
  toggleWidth: number
  mode: "normal" | "shell"
  variantsWidth: number
  shellWidth: number
  clearWidth: number
  busy?: boolean
  measured?: PromptFooterMeasured
}) {
  if (input.measured) return measuredFooterLayout({ ...input, measured: input.measured })
  const inlineBudget = Math.max(0, input.contentWidth - INLINE_STATUS_RESERVE)
  const firstHintWidth = input.mode === "shell" ? input.shellWidth : input.clearWidth
  // A busy row contains variable-length tool, token, and retry text. Give it
  // its own row instead of estimating that content with a fixed reserve.
  const stacked =
    !!input.busy || inlineBudget < input.toggleWidth + (firstHintWidth > 0 ? GROUP_GAP + firstHintWidth : 0)

  let remaining = Math.max(
    0,
    (stacked ? input.contentWidth : inlineBudget) - input.toggleWidth - (firstHintWidth > 0 ? GROUP_GAP : 0),
  )

  if (input.mode === "shell") {
    return {
      stacked,
      showVariants: false,
      showShellHint: remaining >= input.shellWidth,
      showClearHint: false,
    } satisfies PromptFooterLayout
  }

  const showClearHint = remaining >= input.clearWidth
  if (showClearHint) remaining -= input.clearWidth

  let showVariants = false

  if (input.variantsWidth > 0 && remaining >= (showClearHint ? GROUP_GAP : 0) + input.variantsWidth) {
    showVariants = true
  }

  return {
    stacked,
    showVariants,
    showShellHint: false,
    showClearHint,
  } satisfies PromptFooterLayout
}

function measuredFooterLayout(input: {
  contentWidth: number
  mode: "normal" | "shell"
  variantsWidth: number
  shellWidth: number
  clearWidth: number
  busy?: boolean
  measured: PromptFooterMeasured
}): PromptFooterLayout {
  const { leftWidth, gaugeWidth, extraWidth } = input.measured
  // A busy row carries variable-length tool, token, and retry text: it gets
  // its own row, and the gauge stacks above the hint row.
  const stacked = !!input.busy
  const rowBudget = stacked ? input.contentWidth : input.contentWidth - leftWidth - (leftWidth > 0 ? 1 : 0)
  // Inline, the gauge box and the hint box sit one cell apart; inside the hint
  // box, caller content and each hint are GROUP_GAP apart.
  const base = stacked ? extraWidth : gaugeWidth + extraWidth + (gaugeWidth > 0 && extraWidth > 0 ? 1 : 0)
  const leadingGap = extraWidth > 0 ? GROUP_GAP : !stacked && gaugeWidth > 0 ? 1 : 0
  let remaining = rowBudget - base

  if (input.mode === "shell") {
    return {
      stacked,
      showVariants: false,
      showShellHint: input.shellWidth > 0 && remaining >= leadingGap + input.shellWidth,
      showClearHint: false,
    }
  }

  const showClearHint = input.clearWidth > 0 && remaining >= leadingGap + input.clearWidth
  if (showClearHint) remaining -= leadingGap + input.clearWidth
  const variantsGap = showClearHint ? GROUP_GAP : leadingGap
  const showVariants = input.variantsWidth > 0 && remaining >= variantsGap + input.variantsWidth
  return { stacked, showVariants, showShellHint: false, showClearHint }
}
