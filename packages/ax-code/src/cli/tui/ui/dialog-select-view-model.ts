import fuzzysort from "fuzzysort"
import { entries, flatMap, groupBy, pipe } from "remeda"
import { stringWidth } from "@/bun/node-compat"
import { truncateCells } from "./cell-text"
import { DIALOG_SELECT_CHROME_HEIGHT, dialogOverlayVisibleBodyHeight } from "./dialog-overlay"

export type DialogSelectViewOption<T = unknown> = {
  title: string
  value: T
  category?: string
  disabled?: boolean
}

export function dialogSelectFilteredOptions<T extends DialogSelectViewOption>(
  options: T[],
  query: string,
  skipFilter?: boolean,
): T[] {
  if (skipFilter) return options

  const needle = query.toLowerCase()
  if (!needle) return options

  return fuzzysort
    .go(needle, options, {
      keys: ["title", "category"],
      scoreFn: (result) => {
        const titleScore = result[0]?.score ?? 0
        const categoryScore = result[1]?.score
        return titleScore * 2 + (Number.isFinite(categoryScore) ? categoryScore : 0)
      },
    })
    .map((result) => result.obj)
}

export function dialogSelectGroupedOptions<T extends DialogSelectViewOption>(input: {
  options: T[]
  query: string
  flat?: boolean
  skipFilter?: boolean
}): [string, T[]][] {
  const filtered = dialogSelectFilteredOptions(input.options, input.query, input.skipFilter)
  if (input.flat && input.query.length > 0) return [["", filtered]]
  return pipe(
    filtered,
    groupBy((option) => option.category ?? ""),
    entries(),
  )
}

export function dialogSelectFlatOptions<T>(groups: [string, T[]][]): T[] {
  return pipe(
    groups,
    flatMap(([_, options]) => options),
  )
}

export function dialogSelectGroupStartIndex(groups: readonly [string, unknown[]][], groupIndex: number) {
  let start = 0
  const last = Math.min(Math.max(groupIndex, 0), groups.length)
  for (let i = 0; i < last; i++) start += groups[i][1].length
  return start
}

export function dialogSelectRows(groups: [string, unknown[]][]) {
  const headers = groups.reduce((acc, [category], index) => {
    if (!category) return acc
    return acc + (index > 0 ? 2 : 1)
  }, 0)
  return groups.reduce((acc, [_, options]) => acc + options.length, headers)
}

export function dialogSelectVisibleHeight(rows: number, terminalHeight: number) {
  return dialogOverlayVisibleBodyHeight({
    contentRows: rows,
    terminalHeight,
    chromeHeight: DIALOG_SELECT_CHROME_HEIGHT,
  })
}

export function dialogSelectMoveIndex(current: number, direction: number, count: number) {
  if (count <= 0) return current
  // Page-size jumps (|direction| > 1) clamp at the list edges; single steps
  // keep the wrap-around behavior.
  if (Math.abs(direction) > 1) return dialogSelectClampIndex(current + direction, count)
  let next = current + direction
  if (next < 0) next = count - 1
  if (next >= count) next = 0
  return next
}

export function dialogSelectClampIndex(current: number, count: number) {
  if (count <= 0) return 0
  if (current < 0) return 0
  if (current >= count) return count - 1
  return current
}

export function dialogSelectActionOption<T>(options: readonly T[], selectedIndex: number): T | undefined {
  if (options.length === 0) return undefined
  return options[dialogSelectClampIndex(selectedIndex, options.length)]
}

export function dialogSelectHasCurrentValue(value: unknown): boolean {
  return value !== undefined && value !== null
}

/** Horizontal chrome around the header row: frame borders (2) + header padding (4 + 4). */
const DIALOG_SELECT_HEADER_CHROME_WIDTH = 10
/** Horizontal chrome around the keybind footer row: frame borders (2) + padding (4 + 2). */
const DIALOG_SELECT_FOOTER_CHROME_WIDTH = 8
const DIALOG_SELECT_FOOTER_GAP = 2
/** A secondary description is only worth showing when this many cells remain for it. */
const DIALOG_SELECT_MIN_DESCRIPTION_WIDTH = 6

/** Cell budget for the dialog title, leaving one cell before the esc label. */
export function dialogSelectTitleWidth(frameWidth: number, escLabel: string) {
  return Math.max(0, frameWidth - DIALOG_SELECT_HEADER_CHROME_WIDTH - stringWidth(escLabel) - 1)
}

export type DialogSelectOptionLine = {
  title: string
  description?: string
  /** False when the footer column was dropped to keep the title readable. */
  showFooter: boolean
}

/**
 * Fit one option row into `slotWidth` cells (the title text slot plus, when
 * the footer is shown, the footer column and its one-cell gap). Secondary
 * content goes first: the footer column is dropped before the title is cut,
 * the inline description is shortened or dropped next, and only then is the
 * title truncated with an ellipsis at a cell boundary. A slot width of 0 means
 * "not measured yet" and leaves the row untouched.
 */
export function dialogSelectOptionLine(input: {
  slotWidth: number
  title: string
  description?: string
  /** Cell width of a plain-text footer; undefined for none or an unmeasurable element. */
  footerWidth?: number
}): DialogSelectOptionLine {
  const slot = Math.floor(input.slotWidth)
  const footerCost = input.footerWidth && input.footerWidth > 0 ? input.footerWidth + 1 : 0
  if (slot <= 0) return { title: input.title, description: input.description, showFooter: true }
  const titleWidth = stringWidth(input.title)
  const showFooter = footerCost === 0 || titleWidth <= slot - footerCost
  const available = Math.max(0, slot - (showFooter ? footerCost : 0))
  if (titleWidth > available) return { title: truncateCells(input.title, available), showFooter }
  if (!input.description) return { title: input.title, showFooter }
  const remaining = available - titleWidth - 1
  const descriptionWidth = stringWidth(input.description)
  if (remaining >= descriptionWidth) return { title: input.title, description: input.description, showFooter }
  if (remaining < DIALOG_SELECT_MIN_DESCRIPTION_WIDTH) return { title: input.title, showFooter }
  return { title: input.title, description: truncateCells(input.description, remaining), showFooter }
}

/**
 * Keybind hints in the dialog footer, kept as whole groups in their given
 * (priority) order: a hint that does not fit is dropped, never cut mid-token.
 */
export function dialogSelectFooterHints<T extends { width: number }>(hints: readonly T[], frameWidth: number): T[] {
  let budget = frameWidth - DIALOG_SELECT_FOOTER_CHROME_WIDTH
  const kept: T[] = []
  for (const hint of hints) {
    const cost = hint.width + (kept.length > 0 ? DIALOG_SELECT_FOOTER_GAP : 0)
    if (cost > budget) break
    budget -= cost
    kept.push(hint)
  }
  return kept
}
