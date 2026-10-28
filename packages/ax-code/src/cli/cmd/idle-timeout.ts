/**
 * yargs turns a typo such as `10min` into NaN, which the idle timer would read
 * as "disabled" — the same as an explicit 0. Reject it as a usage error so a
 * hung run cannot lose its timeout to a mistyped flag.
 */
export function parseIdleTimeoutMs(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`--idle-timeout-ms must be a non-negative number of milliseconds (0 disables it)`)
  }
  return value
}
