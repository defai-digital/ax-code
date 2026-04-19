export type AutocompleteVisibility = false | "@" | "/"

export type AutocompleteLayout = {
  top: number
  left: number
  width: number
  height: number
}

export function resolveAutocompleteLayout(input: {
  visible: AutocompleteVisibility
  anchorX: number
  anchorY: number
  anchorWidth: number
  optionCount: number
  maxHeight?: number
}) {
  if (!input.visible) return

  const maxHeight = input.maxHeight ?? 10
  const optionCount = Math.max(1, input.optionCount)
  const spaceAbove = Math.max(1, input.anchorY)
  const height = Math.min(maxHeight, optionCount, spaceAbove)

  return {
    top: Math.max(0, spaceAbove - height),
    left: input.anchorX,
    width: input.anchorWidth,
    height,
  } satisfies AutocompleteLayout
}
