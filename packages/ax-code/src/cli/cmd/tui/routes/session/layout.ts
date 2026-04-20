// Shared session layout math used by the main pane, header, sidebar, and prompt.
// Keep this isolated from component modules so width calculations stay testable
// and low-dependency.

export function computeSidebarWidth(terminalWidth: number): number {
  if (terminalWidth >= 200) return 52
  if (terminalWidth >= 160) return 46
  return 42
}

export function computeSessionMainPaneWidth(input: {
  terminalWidth: number
  sidebarVisible: boolean
  gutter?: number
}) {
  const gutter = input.gutter ?? 4
  return Math.max(
    0,
    input.terminalWidth - gutter - (input.sidebarVisible ? computeSidebarWidth(input.terminalWidth) : 0),
  )
}
