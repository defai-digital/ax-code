/**
 * Shared overlay metrics for TUI dialogs.
 *
 * Select lists used to cap at `floor(terminalHeight / 2) - 6`, which left only
 * two option rows in a typical 16-line split pane. Overlay placement is now a
 * one-row margin with vertical centering: short confirms stay balanced, and
 * long lists (/connect, models, help) use the remaining height.
 */

export const DIALOG_OVERLAY_VERTICAL_MARGIN = 1

/** Title, search field, borders, padding, and gaps around the DialogSelect list. */
export const DIALOG_SELECT_CHROME_HEIGHT = 8

/** Title, borders, padding, and gap around the help body. */
export const DIALOG_HELP_CHROME_HEIGHT = 5

export const DIALOG_OVERLAY_BOTTOM_SAFE_MARGIN = 2

export function dialogOverlayMaxHeight(terminalHeight: number): number {
  const height = Math.max(1, Math.floor(terminalHeight))
  return Math.max(1, height - DIALOG_OVERLAY_VERTICAL_MARGIN * 2)
}

export function dialogOverlayVisibleBodyHeight(input: {
  contentRows: number
  terminalHeight: number
  chromeHeight: number
  emptyRows?: number
}): number {
  if (input.contentRows <= 0) return input.emptyRows ?? 0
  const available =
    dialogOverlayMaxHeight(input.terminalHeight) - input.chromeHeight - DIALOG_OVERLAY_BOTTOM_SAFE_MARGIN
  return Math.max(1, Math.min(input.contentRows, available))
}
