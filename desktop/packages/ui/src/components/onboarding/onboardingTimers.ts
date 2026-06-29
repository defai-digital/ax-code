export type OnboardingTimerId = number

export const clearOnboardingTimer = (timerId: OnboardingTimerId | null): null => {
  if (timerId !== null) {
    window.clearTimeout(timerId)
  }
  return null
}

export const replaceOnboardingTimer = (
  timerId: OnboardingTimerId | null,
  onReset: () => void,
  delayMs: number,
): OnboardingTimerId => {
  clearOnboardingTimer(timerId)
  return window.setTimeout(onReset, delayMs)
}
