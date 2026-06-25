const HELP_DIALOG_TOP_PADDING_RATIO = 4
const HELP_DIALOG_CHROME_HEIGHT = 5
const HELP_DIALOG_BOTTOM_SAFE_MARGIN = 2

export function dialogHelpBodyHeight(input: { contentRows: number; terminalHeight: number }) {
  if (input.contentRows <= 0) return 1

  const terminalHeight = Math.max(1, Math.floor(input.terminalHeight))
  const topPadding = Math.floor(terminalHeight / HELP_DIALOG_TOP_PADDING_RATIO)
  const viewportRows = terminalHeight - topPadding - HELP_DIALOG_CHROME_HEIGHT - HELP_DIALOG_BOTTOM_SAFE_MARGIN

  return Math.max(1, Math.min(input.contentRows, viewportRows))
}
