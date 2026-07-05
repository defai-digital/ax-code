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
