/** Turn order, not message length, determines timeline spacing. */
export function timelineWindow(count: number, height: number, active: number) {
  const capacity = Math.max(0, Math.floor(height) - 2)
  if (count < 2 || capacity < 1) return []
  const size = Math.min(count, capacity)
  const start = Math.max(0, Math.min(count - size, active - Math.floor(size / 2)))
  return Array.from({ length: size }, (_, index) => ({
    index: start + index,
    row: size === 1 ? 1 : 1 + Math.round((index * (capacity - 1)) / (size - 1)),
  }))
}

export function timelinePosition(turns: readonly { y: number }[], top: number) {
  const active = Math.max(
    0,
    turns.findLastIndex((turn) => turn.y <= top),
  )
  const previous = turns.findLastIndex((turn) => turn.y < top)
  const next = turns.findIndex((turn) => turn.y > top)
  return { active, previous, next }
}
