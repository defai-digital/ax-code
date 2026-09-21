export type ContextMenuAvailability = { copy: boolean; paste: boolean }

/**
 * Both items always render once the menu opens, with unavailable actions
 * disabled; availability is snapshotted at open time so rows never flip
 * while the pointer is moving. The menu does not open at all when neither
 * action applies.
 */
export function contextMenuAvailability(input: {
  hasSelection: boolean
  hasEditor: boolean
}): ContextMenuAvailability | null {
  if (!input.hasSelection && !input.hasEditor) return null
  return { copy: input.hasSelection, paste: input.hasEditor }
}

/** Clamp the menu so it never leaves the terminal frame. */
export function contextMenuPlacement(input: {
  x: number
  y: number
  width: number
  height: number
  termWidth: number
  termHeight: number
}) {
  const left = Math.max(0, Math.min(input.x, input.termWidth - input.width))
  const top = Math.max(0, Math.min(input.y, input.termHeight - input.height))
  return { left, top }
}
