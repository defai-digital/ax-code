const INLINE_STATUS_RESERVE = 36
const GROUP_GAP = 1

export type PromptFooterLayout = {
  stacked: boolean
  showVariants: boolean
  showShellHint: boolean
  showClearHint: boolean
}

export function footerHintWidth(key: string, label: string) {
  return key.length + 1 + label.length
}

export function promptFooterLayout(input: {
  contentWidth: number
  toggleWidth: number
  mode: "normal" | "shell"
  variantsWidth: number
  shellWidth: number
  clearWidth: number
}) {
  const inlineBudget = Math.max(0, input.contentWidth - INLINE_STATUS_RESERVE)
  const firstHintWidth = input.mode === "shell" ? input.shellWidth : input.clearWidth
  const stacked = inlineBudget < input.toggleWidth + (firstHintWidth > 0 ? GROUP_GAP + firstHintWidth : 0)

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
