import { toNumber, toTimestamp, toUsageWindow } from "../utils/index.js"

export const transformMinimaxWindows = (model) => {
  const intervalTotal = toNumber(model.current_interval_total_count)
  const intervalUsed = toNumber(model.current_interval_usage_count)
  const intervalStartAt = toTimestamp(model.start_time)
  const intervalResetAt = toTimestamp(model.end_time)
  const weeklyTotal = toNumber(model.current_weekly_total_count)
  const weeklyUsed = toNumber(model.current_weekly_usage_count)
  const weeklyStartAt = toTimestamp(model.weekly_start_time)
  const weeklyResetAt = toTimestamp(model.weekly_end_time)

  const intervalUsedPercent =
    intervalTotal > 0 && intervalUsed !== null ? Math.max(0, Math.min(100, (intervalUsed / intervalTotal) * 100)) : null
  const weeklyUsedPercent =
    weeklyTotal > 0 && weeklyUsed !== null ? Math.max(0, Math.min(100, (weeklyUsed / weeklyTotal) * 100)) : null
  const intervalWindowSeconds =
    intervalStartAt && intervalResetAt && intervalResetAt > intervalStartAt
      ? Math.floor((intervalResetAt - intervalStartAt) / 1000)
      : null
  const weeklyWindowSeconds =
    weeklyStartAt && weeklyResetAt && weeklyResetAt > weeklyStartAt
      ? Math.floor((weeklyResetAt - weeklyStartAt) / 1000)
      : null

  return {
    "5h": toUsageWindow({
      usedPercent: intervalUsedPercent,
      windowSeconds: intervalWindowSeconds,
      resetAt: intervalResetAt,
    }),
    weekly: toUsageWindow({
      usedPercent: weeklyUsedPercent,
      windowSeconds: weeklyWindowSeconds,
      resetAt: weeklyResetAt,
    }),
  }
}
