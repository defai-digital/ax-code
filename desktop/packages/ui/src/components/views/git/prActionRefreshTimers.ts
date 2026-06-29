export type PrActionRefreshTimerId = number

export const clearPrActionRefreshTimers = (timers: readonly PrActionRefreshTimerId[]): void => {
  timers.forEach((timerId) => {
    window.clearTimeout(timerId)
  })
}

export const replacePrActionRefreshTimers = (
  timers: readonly PrActionRefreshTimerId[],
  delaysMs: readonly number[],
  refresh: () => void,
): PrActionRefreshTimerId[] => {
  clearPrActionRefreshTimers(timers)
  return delaysMs.map((delayMs) => window.setTimeout(refresh, delayMs))
}
