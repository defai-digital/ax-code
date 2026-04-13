import * as fuzzysort from "fuzzysort"
import { entries, filter, flatMap, groupBy, pipe } from "remeda"

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
  const enabled = pipe(
    options,
    filter((option) => option.disabled !== true),
  )
  if (skipFilter) return enabled

  const needle = query.toLowerCase()
  if (!needle) return enabled

  return fuzzysort
    .go(needle, enabled, {
      keys: ["title", "category"],
      scoreFn: (result) => result[0].score * 2 + result[1].score,
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

export function dialogSelectRows(groups: [string, unknown[]][]) {
  const headers = groups.reduce((acc, [category], index) => {
    if (!category) return acc
    return acc + (index > 0 ? 2 : 1)
  }, 0)
  return groups.reduce((acc, [_, options]) => acc + options.length, headers)
}

export function dialogSelectVisibleHeight(rows: number, terminalHeight: number) {
  return Math.min(rows, Math.floor(terminalHeight / 2) - 6)
}

export function dialogSelectMoveIndex(current: number, direction: number, count: number) {
  if (count <= 0) return current
  let next = current + direction
  if (next < 0) next = count - 1
  if (next >= count) next = 0
  return next
}
