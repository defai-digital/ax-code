const SCHEDULE_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

export const normalizeScheduledTaskTimes = (values: readonly unknown[]): string[] => {
  const valid: string[] = []

  for (const value of values) {
    if (typeof value !== "string" || !SCHEDULE_TIME_PATTERN.test(value)) {
      continue
    }
    valid.push(value.trim())
  }

  return Array.from(new Set(valid)).sort((a, b) => a.localeCompare(b))
}
