/**
 * Shared overlay metrics for TUI dialogs.
 *
 * Select lists used to cap at `floor(terminalHeight / 2) - 6`, which left only
 * two option rows in a typical 16-line split pane. Overlay placement is now a
 * one-row top margin and a two-row bottom margin (the app's status rows) with
 * vertical centering: short confirms stay balanced, and
 * long lists (/connect, models, help) use the remaining height. The granted
 * body height is computed against the frame's real budget (overlay margin,
 * frame border+padding, picker chrome, bottom safe margin): a list that does
 * not fit must overflow into a visible scrollbar, never silently clip rows.
 */

/** Rows kept clear above the dialog (the navigation strip stays readable). */
export const DIALOG_OVERLAY_TOP_MARGIN = 1

/**
 * Rows kept clear below the dialog. Every full-screen route ends with a
 * status/footer row followed by one padding row; a dialog that reaches into
 * them hides the workspace/status line (the 80x24 model picker drew its
 * bottom border over it). Terminals too short to spare both fall back to one.
 */
export const DIALOG_OVERLAY_BOTTOM_MARGIN = 2
const DIALOG_OVERLAY_BOTTOM_MARGIN_MIN_TERMINAL_HEIGHT = 12

/**
 * Columns kept clear on each side of the dialog frame. Narrow terminals keep
 * one column per side so long translated option labels still fit (36-column
 * locale check).
 */
export const DIALOG_OVERLAY_SIDE_MARGIN = 2
const DIALOG_OVERLAY_NARROW_SIDE_MARGIN = 1
const DIALOG_OVERLAY_NARROW_TERMINAL_WIDTH = 60

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

/**
 * Spare rows subtracted from the body budget beyond the exact chrome. The
 * bottom overlay margin now reserves the app's status rows, so no extra slack
 * is needed: the computed chrome is exact (see DIALOG_SELECT_CHROME_HEIGHT).
 */
export const DIALOG_OVERLAY_BOTTOM_SAFE_MARGIN = 0

export function dialogOverlayBottomMargin(terminalHeight: number): number {
  return Math.floor(terminalHeight) >= DIALOG_OVERLAY_BOTTOM_MARGIN_MIN_TERMINAL_HEIGHT
    ? DIALOG_OVERLAY_BOTTOM_MARGIN
    : DIALOG_OVERLAY_TOP_MARGIN
}

export function dialogOverlayMaxHeight(terminalHeight: number): number {
  const height = Math.max(1, Math.floor(terminalHeight))
  return Math.max(1, height - DIALOG_OVERLAY_TOP_MARGIN - dialogOverlayBottomMargin(height))
}

/** Frame width: the preferred size, clamped so a side margin stays visible. */
export function dialogOverlayWidth(preferred: number, terminalWidth: number): number {
  const width = Math.max(1, Math.floor(terminalWidth))
  const margin =
    width < DIALOG_OVERLAY_NARROW_TERMINAL_WIDTH ? DIALOG_OVERLAY_NARROW_SIDE_MARGIN : DIALOG_OVERLAY_SIDE_MARGIN
  return Math.max(1, Math.min(preferred, width - margin * 2))
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
