export const AUTOCOMPLETE_OPTION_HEIGHT = 1

export function autocompleteOptionID(index: number) {
  return `autocomplete-option-${index}`
}

export function autocompleteSelectionScrollDelta(input: {
  selectedIndex: number
  scrollTop: number
  viewportHeight: number
  targetY?: number
}) {
  const itemY = input.targetY ?? input.selectedIndex * AUTOCOMPLETE_OPTION_HEIGHT
  const relativeY = itemY - input.scrollTop

  if (relativeY >= input.viewportHeight) {
    return relativeY - input.viewportHeight + AUTOCOMPLETE_OPTION_HEIGHT
  }

  if (relativeY < 0) {
    return relativeY
  }

  return 0
}
