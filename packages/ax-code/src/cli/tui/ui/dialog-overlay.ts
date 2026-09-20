/**
 * Shared overlay metrics for TUI dialogs.
 *
 * Select lists used to cap at `floor(terminalHeight / 2) - 6`, which left only
 * two option rows in a typical 16-line split pane. Overlay placement is now a
 * one-row margin with vertical centering: short confirms stay balanced, and
 * long lists (/connect, models, help) use the remaining height. The granted
 * body height is computed against the frame's real budget (overlay margin,
 * frame border+padding, picker chrome, bottom safe margin): a list that does
 * not fit must overflow into a visible scrollbar, never silently clip rows.
 */

export const DIALOG_OVERLAY_VERTICAL_MARGIN = 1

/** Title, search field, borders, padding, and gaps around the DialogSelect list. */
export const DIALOG_SELECT_CHROME_HEIGHT = 8

/** Title, borders, padding, and gap around the help body. */
export const DIALOG_HELP_CHROME_HEIGHT = 5

/**
 * Rows consumed by the Dialog frame itself (paddingTop 1 + top/bottom
 * borders). The frame's maxHeight is a border-box constraint, so a body that
 * only subtracts its own chrome can exceed the frame's content area: Yoga then
 * shrinks the scrollbox below the height the picker computed, the picker's
 * overflow memo still reports "fits", and the bottom rows are clipped with NO
 * scrollbar — users cannot tell more options exist. Subtracting the frame
 * chrome keeps the computed body height inside the space the frame grants.
 */
export const DIALOG_FRAME_CHROME_HEIGHT = 3

export const DIALOG_OVERLAY_BOTTOM_SAFE_MARGIN = 1

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
    dialogOverlayMaxHeight(input.terminalHeight) -
    DIALOG_FRAME_CHROME_HEIGHT -
    input.chromeHeight -
    DIALOG_OVERLAY_BOTTOM_SAFE_MARGIN
  return Math.max(1, Math.min(input.contentRows, available))
}
