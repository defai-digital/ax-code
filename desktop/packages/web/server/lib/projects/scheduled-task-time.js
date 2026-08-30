const SCHEDULED_TASK_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

export const normalizeScheduledTaskTime = (value) => {
  const time = typeof value === "string" ? value.trim() : ""
  return SCHEDULED_TASK_TIME_PATTERN.test(time) ? time : null
}

export const uniqueSortedScheduledTaskTimes = (times) => Array.from(new Set(times)).sort((a, b) => a.localeCompare(b))

export const normalizeScheduledTaskTimes = (values) => {
  const times = []
  if (!Array.isArray(values)) {
    return times
  }

  for (const value of values) {
    const time = normalizeScheduledTaskTime(value)
    if (time) {
      times.push(time)
    }
  }

  return uniqueSortedScheduledTaskTimes(times)
}

export const resolveScheduledTaskTimes = (schedule, options = {}) => {
  const { existingSchedule, rejectInvalidTimes = false } = options
  const times = []

  if (Array.isArray(schedule?.times)) {
    for (const value of schedule.times) {
      const time = normalizeScheduledTaskTime(value)
      if (!time) {
        if (rejectInvalidTimes) {
          throw new Error("schedule.times must contain HH:mm values")
        }
        continue
      }
      times.push(time)
    }
  }

  const legacySingleTime = normalizeScheduledTaskTime(schedule?.time)
  if (legacySingleTime) {
    times.push(legacySingleTime)
  }

  if (times.length === 0 && Array.isArray(existingSchedule?.times)) {
    times.push(...normalizeScheduledTaskTimes(existingSchedule.times))
  }

  return uniqueSortedScheduledTaskTimes(times)
}

export const parseScheduledTaskTimeParts = (value) => {
  const time = normalizeScheduledTaskTime(value)
  if (!time) {
    return null
  }
  const match = SCHEDULED_TASK_TIME_PATTERN.exec(time)
  if (!match) {
    return null
  }
  return {
    hour: Number(match[1]),
    minute: Number(match[2]),
  }
}
