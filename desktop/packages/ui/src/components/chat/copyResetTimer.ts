export type CopyResetTimerId = number

export const clearCopyResetTimer = (timerId: CopyResetTimerId | null): null => {
  if (timerId !== null) {
    window.clearTimeout(timerId)
  }
  return null
}

export const replaceCopyResetTimer = (
  timerId: CopyResetTimerId | null,
  onReset: () => void,
  delayMs = 2_000,
): CopyResetTimerId => {
  clearCopyResetTimer(timerId)
  return window.setTimeout(onReset, delayMs)
}
