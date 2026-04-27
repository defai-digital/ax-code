const INLINE_STATUS_RESERVE = 36
const GROUP_GAP = 1
const HINT_GAP = 2

export type PromptFooterLayout = {
  stacked: boolean
  showVariants: boolean
  showAgents: boolean
  showShellHint: boolean
}

export function footerHintWidth(key: string, label: string) {
  return key.length + 1 + label.length
}

export function promptFooterLayout(input: {
  contentWidth: number
  toggleWidth: number
  mode: "normal" | "shell"
  agentsWidth: number
  variantsWidth: number
  shellWidth: number
}) {
  const inlineBudget = Math.max(0, input.contentWidth - INLINE_STATUS_RESERVE)
  const firstHintWidth = input.mode === "shell" ? input.shellWidth : input.agentsWidth || input.variantsWidth
  const stacked = inlineBudget < input.toggleWidth + (firstHintWidth > 0 ? GROUP_GAP + firstHintWidth : 0)

  let remaining = Math.max(
    0,
    (stacked ? input.contentWidth : inlineBudget) - input.toggleWidth - (firstHintWidth > 0 ? GROUP_GAP : 0),
  )

  if (input.mode === "shell") {
    return {
      stacked,
      showVariants: false,
      showAgents: false,
      showShellHint: remaining >= input.shellWidth,
    } satisfies PromptFooterLayout
  }

  let showAgents = false
  let showVariants = false

  if (remaining >= input.agentsWidth) {
    showAgents = true
    remaining -= input.agentsWidth + HINT_GAP
  }
  if (input.variantsWidth > 0 && remaining >= input.variantsWidth) {
    showVariants = true
  }

  return {
    stacked,
    showVariants,
    showAgents,
    showShellHint: false,
  } satisfies PromptFooterLayout
}
