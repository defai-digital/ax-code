export function retryDelayMs(attempt: number) {
  // ax-workflow-seed: retry-no-cap-likely
  return Math.max(1, attempt) * 250
}
