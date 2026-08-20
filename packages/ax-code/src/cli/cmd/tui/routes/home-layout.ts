// Home bottom status bar layout math (directory · MCP/status · version).
// The mode chips used to be a segment here; they now live in the prompt
// footer (see ModeChips / Prompt `footerRight`).
// Keep this isolated from component modules so width calculations stay testable
// and low-dependency, mirroring prompt/footer-layout.ts.

const STATUS_BAR_PADDING = 4
const STATUS_BAR_GAP = 2

export type HomeStatusBarLayout = {
  stacked: boolean
}

/** Width of the MCP status group ("● N MCP" + gap + "/status"). */
export function homeStatusBarMcpWidth(connectedCount: number) {
  return 2 + String(connectedCount).length + 4 + 1 + "/status".length
}

/**
 * Stack the bar vertically when the segments no longer fit on one line.
 * Zero-width segments are hidden, so they contribute neither width nor gap.
 */
export function homeStatusBarLayout(input: { terminalWidth: number; segmentWidths: number[] }): HomeStatusBarLayout {
  const visible = input.segmentWidths.filter((width) => width > 0)
  const required =
    STATUS_BAR_PADDING +
    visible.reduce((sum, width) => sum + width, 0) +
    STATUS_BAR_GAP * Math.max(0, visible.length - 1)
  return { stacked: required > input.terminalWidth }
}
