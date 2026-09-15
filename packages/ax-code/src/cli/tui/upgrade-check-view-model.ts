export type TuiStartupUpgradeCheckState = {
  currentVersion?: string
  checkedAt?: number
}

export function shouldRunTuiStartupUpgradeCheck(input: {
  state: TuiStartupUpgradeCheckState | undefined
  currentVersion: string
  nowMs: number
  intervalMs: number
}) {
  if (input.intervalMs <= 0) return false
  if (input.state?.currentVersion !== input.currentVersion) return true

  const checkedAt = input.state.checkedAt
  if (typeof checkedAt !== "number" || !Number.isFinite(checkedAt)) return true
  if (checkedAt > input.nowMs) return true

  return input.nowMs - checkedAt >= input.intervalMs
}

export function nextTuiStartupUpgradeCheckState(input: {
  currentVersion: string
  nowMs: number
}): TuiStartupUpgradeCheckState {
  return {
    currentVersion: input.currentVersion,
    checkedAt: input.nowMs,
  }
}

export function formatTuiUpgradeCompleteMessage(version: string, warnings: readonly string[] = []) {
  const message = `Successfully updated to ax-code v${version}. Please restart the application.`
  if (!warnings.length) return message
  return `${message}\n\nWarnings:\n${warnings.map((warning) => `- ${warning}`).join("\n")}`
}
