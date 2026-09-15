/** Turn order, not message length, determines timeline spacing. */
export function timelineWindow(count: number, height: number, active: number) {
  const capacity = Math.max(0, Math.floor(height) - 2)
  if (count < 2 || capacity < 1) return []
  const size = Math.min(count, capacity)
  const start = Math.max(0, Math.min(count - size, active - Math.floor(size / 2)))
  return Array.from({ length: size }, (_, index) => ({
    index: start + index,
    row: Math.floor((Math.floor(height) - size - 2) / 2) + 1 + index,
  }))
}

export function timelinePosition(turns: readonly { y: number }[], top: number, atBottom = false) {
  const active = Math.max(
    0,
    turns.findLastIndex((turn) => turn.y <= top),
  )
  const previous = turns.findLastIndex((turn) => turn.y < top)
  const next = atBottom ? -1 : turns.findIndex((turn) => turn.y > top)
  return { active, previous, next }
}
