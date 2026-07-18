/** Format a millisecond duration for debug UI. */
export const formatDuration = (durationMs: number): string => {
  const totalMilliseconds = Math.round(durationMs)
  if (totalMilliseconds < 1000) {
    return `${totalMilliseconds}ms`
  }

  // Round to whole seconds first so remainder never becomes "Nm 60s".
  const totalSeconds = Math.round(durationMs / 1000)
  if (totalSeconds < 60) {
    return `${(durationMs / 1000).toFixed(1)}s`
  }

  const minutes = Math.floor(totalSeconds / 60)
  const remainderSeconds = totalSeconds % 60
  return `${minutes}m ${remainderSeconds}s`
}
