export const FOOTER_TIP_ROTATE_MS = 10_000

// Keep tips free of user-remappable keybinding names — they reference trigger
// characters (@, /) and generic actions so they stay correct under custom
// keybind configs. English only (repo disk-language rule).
export const FOOTER_TIPS: readonly string[] = [
  "Type @ to mention a file or folder",
  "Type / to browse available commands",
  "Paste an image or a file path to attach it",
  "Long pastes collapse into an expandable summary",
  "Open the command list to discover TUI features",
  "Switch models any time from the model dialog",
  "Rename or pin sessions from the sessions dialog",
  "Inspect token usage and context in the status dialog",
  "Fork a session to explore a different approach",
  "Toggle the sidebar for session navigation",
]

export type FooterTipRng = () => number

// Fisher–Yates shuffle once (order fixed for the component's lifetime), then
// plain round-robin. The rng is injectable so tests can pin the order.
export function createFooterTipCycle(count: number, rng: FooterTipRng = Math.random) {
  const order = Array.from({ length: count }, (_, index) => index)
  for (let index = order.length - 1; index > 0; index--) {
    const swap = Math.floor(rng() * (index + 1))
    const current = order[index]!
    order[index] = order[swap]!
    order[swap] = current
  }
  let cursor = 0
  return {
    next(): number {
      if (order.length === 0) return 0
      const value = order[cursor]!
      cursor = (cursor + 1) % order.length
      return value
    },
  }
}

export function footerTipWidth(tip: string) {
  return tip.length + 2
}
