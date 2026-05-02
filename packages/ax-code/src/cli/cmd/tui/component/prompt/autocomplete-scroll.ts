export const AUTOCOMPLETE_OPTION_HEIGHT = 1

export function autocompleteOptionID(index: number) {
  return `autocomplete-option-${index}`
}

export function autocompleteSelectionScrollDelta(input: {
  selectedIndex: number
  viewportY: number
  viewportHeight: number
  targetY?: number
  scrollOffset?: number
}) {
  const relativeY =
    input.targetY === undefined
      ? input.selectedIndex * AUTOCOMPLETE_OPTION_HEIGHT - (input.scrollOffset ?? 0)
      : input.targetY - input.viewportY

  if (relativeY >= input.viewportHeight) {
    return relativeY - input.viewportHeight + AUTOCOMPLETE_OPTION_HEIGHT
  }

  if (relativeY < 0) {
    return relativeY
  }

  return 0
}

export function autocompletePopupPlacement(input: {
  desiredHeight: number
  anchorLocalY: number
  anchorGlobalY: number
  anchorHeight: number
  terminalHeight: number
}) {
  const desiredHeight = Math.max(1, input.desiredHeight)
  const anchorHeight = Math.max(1, input.anchorHeight)
  const availableAbove = Math.max(0, input.anchorGlobalY)
  const availableBelow = Math.max(0, input.terminalHeight - (input.anchorGlobalY + anchorHeight))
  const direction = availableAbove >= desiredHeight || availableAbove >= availableBelow ? "above" : "below"
  const available = direction === "above" ? availableAbove : availableBelow
  const height = Math.max(1, Math.min(desiredHeight, available || desiredHeight))
  const top = direction === "above" ? input.anchorLocalY - height : input.anchorLocalY + anchorHeight

  return { direction, height, top } as const
}
