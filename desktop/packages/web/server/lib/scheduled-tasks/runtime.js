import { createAxCodeClient } from "@ax-code/sdk/v2"
import { DateTime } from "luxon"
import parser from "cron-parser"
import { expandSnippets } from "../ax-code/snippets.js"
import { parseScheduledTaskTimeParts, resolveScheduledTaskTimes } from "./time.js"

const DEFAULT_GLOBAL_CONCURRENCY = 4
const DEFAULT_PROJECT_CONCURRENCY = 2
const DEFAULT_MAX_RUN_MS = 30 * 60 * 1000
const JITTER_MAX_MS = 2_000
const TASK_TITLE_MAX_LENGTH = 120
const TASK_DUE_SLACK_MS = 5_000
const MAX_TIMER_DELAY_MS = 2_147_483_647
const DEFAULT_QUEUE_POLL_INTERVAL_MS = 1_000
const TERMINAL_QUEUE_STATUSES = new Set(["completed", "failed", "cancelled"])

const buildTaskKey = (projectID, taskID) => `${projectID}:${taskID}`
const asNonEmptyString = (value) => {
  const normalized = typeof value === "string" ? value.trim() : ""
  return normalized.length > 0 ? normalized : null
}

const applyTimeToDate = (baseDateTime, time) => {
  const parsed = parseScheduledTaskTimeParts(time)
  if (!parsed) {
    return null
  }
  return baseDateTime.set({
    hour: parsed.hour,
    minute: parsed.minute,
    second: 0,
    millisecond: 0,
  })
}

const weekdayAsZeroBased = (dateTime) => {
  if (!dateTime || typeof dateTime.weekday !== "number") {
    return null
  }
  return dateTime.weekday % 7
}

const normalizeScheduleTimezone = (schedule) => asNonEmptyString(schedule?.timezone) || DateTime.local().zoneName

const safeErrorMessage = (error, maxLength = 2_000) => {
  const raw = error instanceof Error ? error.message || String(error) : String(error ?? "Unknown error")
  const trimmed = raw.trim()
  if (!trimmed) {
    return "Unknown error"
  }
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed
}

export const parseScheduledCommandPrompt = (prompt) => {
  if (typeof prompt !== "string") {
    return null
  }

  const trimmed = prompt.trim()
  if (!trimmed.startsWith("/")) {
    return null
  }

  const firstLine = trimmed.split(/\r?\n/, 1)[0] || ""
  const [head, ...tail] = firstLine.split(/\s+/)
  const commandName = (head || "").slice(1).trim()
  if (!commandName) {
    return null
  }

  return {
    command: commandName,
    arguments: tail.join(" ").trim(),
  }
}

export const computeNextRunAt = (task, nowMs = Date.now()) => {
  if (!task?.enabled) {
    return null
  }

  const schedule = task.schedule
  if (!schedule || typeof schedule !== "object") {
    return null
  }

  const zone = normalizeScheduleTimezone(schedule)
  const now = DateTime.fromMillis(nowMs, { zone })
  if (!now.isValid) {
    return null
  }

  if (schedule.kind === "daily") {
    const times = resolveScheduledTaskTimes(schedule)
    if (times.length === 0) {
      return null
    }
    const minAllowed = now.plus({ milliseconds: TASK_DUE_SLACK_MS })

    for (const time of times) {
      const candidateToday = applyTimeToDate(now, time)
      if (!candidateToday || !candidateToday.isValid) {
        continue
      }
      if (candidateToday > minAllowed) {
        return candidateToday.toMillis()
      }
    }

    const tomorrow = now.plus({ days: 1 })
    const firstTomorrow = applyTimeToDate(tomorrow, times[0])
    return firstTomorrow?.isValid ? firstTomorrow.toMillis() : null
  }

  if (schedule.kind === "weekly") {
    if (!Array.isArray(schedule.weekdays) || schedule.weekdays.length === 0) {
      return null
    }
    const times = resolveScheduledTaskTimes(schedule)
    if (times.length === 0) {
      return null
    }
    const weekdaysSet = new Set(schedule.weekdays)
    const minAllowed = now.plus({ milliseconds: TASK_DUE_SLACK_MS })

    for (let dayOffset = 0; dayOffset <= 14; dayOffset += 1) {
      const dayCandidate = now.plus({ days: dayOffset })
      const zeroBasedWeekday = weekdayAsZeroBased(dayCandidate)
      if (zeroBasedWeekday === null || !weekdaysSet.has(zeroBasedWeekday)) {
        continue
      }
      for (const time of times) {
        const withTime = applyTimeToDate(dayCandidate, time)
        if (!withTime || !withTime.isValid) {
          continue
        }
        if (withTime > minAllowed) {
          return withTime.toMillis()
        }
      }
    }
    return null
  }

  if (schedule.kind === "once") {
    if (typeof schedule.date !== "string" || typeof schedule.time !== "string") {
      return null
    }

    const parsed = DateTime.fromFormat(`${schedule.date} ${schedule.time}`, "yyyy-LL-dd HH:mm", { zone })
    if (!parsed.isValid) {
      return null
    }

    const minAllowed = now.plus({ milliseconds: TASK_DUE_SLACK_MS })
    if (parsed <= minAllowed) {
      return null
    }

    return parsed.toMillis()
  }

  if (schedule.kind === "cron") {
    try {
      const iterator = parser.parseExpression(schedule.cron, {
        tz: zone,
        currentDate: new Date(nowMs),
      })
      return iterator.next().getTime()
    } catch {
      return null
    }
  }

  return null
}

export const formatScheduledSessionTitle = (task, nowMs = Date.now()) => {
  const timezone = normalizeScheduleTimezone(task?.schedule)
  const stamp = DateTime.fromMillis(nowMs, { zone: timezone }).toFormat("yyyy-LL-dd HH:mm")
  const taskName = asNonEmptyString(task?.name) || "Scheduled task"
  const suffix = ` ${stamp}`
  const maxTaskNameLength = Math.max(1, TASK_TITLE_MAX_LENGTH - suffix.length)
  const trimmedName = taskName.length > maxTaskNameLength ? taskName.slice(0, maxTaskNameLength) : taskName
  return `${trimmedName}${suffix}`
}

export const createScheduledTasksRuntime = (deps) => {
  const {
    projectConfigRuntime,
    listProjects,
    buildAxCodeUrl,
    getAxCodeAuthHeaders,
    waitForAxCodeReady,
    emitTaskRunEvent,
    logger = console,
    maxGlobalConcurrency = DEFAULT_GLOBAL_CONCURRENCY,
    maxProjectConcurrency = DEFAULT_PROJECT_CONCURRENCY,
    maxRunDurationMs = DEFAULT_MAX_RUN_MS,
    createClient = createAxCodeClient,
    fetchImpl = fetch,
    queuePollIntervalMs = DEFAULT_QUEUE_POLL_INTERVAL_MS,
    wait = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
  } = deps

  let started = false
  const tasksByProject = new Map()
  const projectPathByID = new Map()
  const timersByTaskKey = new Map()
  const queuedTaskKeys = new Set()
  const runningTaskKeys = new Set()
  const runningCountByProject = new Map()
  let runningGlobalCount = 0
  const queue = []

  const clearTimerForKey = (taskKey) => {
    const timer = timersByTaskKey.get(taskKey)
    if (timer) {
      clearTimeout(timer)
      timersByTaskKey.delete(taskKey)
    }
  }

  const clearProjectTimers = (projectID) => {
    const tasks = tasksByProject.get(projectID)
    if (!tasks) {
      return
    }
    for (const task of tasks.values()) {
      clearTimerForKey(buildTaskKey(projectID, task.id))
      queuedTaskKeys.delete(buildTaskKey(projectID, task.id))
    }
  }

  const setProjectTasks = (projectID, tasks) => {
    clearProjectTimers(projectID)
    const taskMap = new Map()
    for (const task of tasks) {
      taskMap.set(task.id, task)
    }
    tasksByProject.set(projectID, taskMap)
  }

  const scheduleTask = (projectID, taskID, nextRunAt) => {
    const taskKey = buildTaskKey(projectID, taskID)
    clearTimerForKey(taskKey)

    if (!started) {
      return
    }

    if (!Number.isFinite(nextRunAt) || nextRunAt <= 0) {
      return
    }

    const delayBase = Math.max(0, Math.round(nextRunAt - Date.now()))
    const jitter = Math.floor(Math.random() * (JITTER_MAX_MS + 1))
    const delay = delayBase + jitter
    const boundedDelay = Math.min(delay, MAX_TIMER_DELAY_MS)

    const timer = setTimeout(async () => {
      if (delay > MAX_TIMER_DELAY_MS) {
        scheduleTask(projectID, taskID, nextRunAt)
        return
      }

      clearTimerForKey(taskKey)
      const taskMap = tasksByProject.get(projectID)
      const task = taskMap?.get(taskID)
      if (!task || !task.enabled) {
        return
      }
      queueTaskRun(projectID, taskID, "scheduled")
      pumpQueue()
    }, boundedDelay)

    timersByTaskKey.set(taskKey, timer)
  }

  const updateInMemoryTask = (projectID, nextTask) => {
    if (!nextTask) {
      return
    }
    const taskMap = tasksByProject.get(projectID)
    if (!taskMap) {
      return
    }
    taskMap.set(nextTask.id, nextTask)
  }

  const syncTaskSchedule = async (projectID, task) => {
    if (!task) {
      return
    }
    const now = Date.now()
    const activeQueueItemID = asNonEmptyString(task.state?.activeQueueItemId)
    if (activeQueueItemID) {
      queueTaskRun(projectID, task.id, task.state?.activeRunReason === "manual" ? "manual" : "scheduled")
      return
    }

    let latestTask = task
    if (task.state?.lastStatus === "running") {
      // Older Desktop versions had no durable queue handle. They cannot be
      // reconciled safely, so surface the interruption instead of submitting
      // a duplicate run.
      const interrupted = await projectConfigRuntime.updateScheduledTaskState(projectID, task.id, {
        lastStatus: "error",
        lastError: "Scheduled task was interrupted before a durable queue handle was recorded.",
        activeQueueItemId: undefined,
        activeRunReason: undefined,
        updatedAt: now,
      })
      if (interrupted.task) {
        latestTask = interrupted.task
        updateInMemoryTask(projectID, interrupted.task)
      }
    }

    const persistedNextRunAt = latestTask.state?.nextRunAt
    const missedOccurrence = latestTask.enabled && Number.isFinite(persistedNextRunAt) && persistedNextRunAt <= now
    if (missedOccurrence && latestTask.catchUpPolicy !== "skip") {
      queueTaskRun(projectID, latestTask.id, "scheduled")
      return
    }

    const nextRunAt = computeNextRunAt(latestTask, now)
    const statePatch = {
      nextRunAt: Number.isFinite(nextRunAt) ? nextRunAt : undefined,
      updatedAt: now,
    }
    const result = await projectConfigRuntime.updateScheduledTaskState(projectID, latestTask.id, statePatch)
    if (result.task) {
      updateInMemoryTask(projectID, result.task)
      if (result.task.enabled && Number.isFinite(result.task.state?.nextRunAt)) {
        scheduleTask(projectID, result.task.id, result.task.state.nextRunAt)
      }
    }
  }

  const ensureProjectPath = async (projectID) => {
    if (projectPathByID.has(projectID)) {
      return projectPathByID.get(projectID) || null
    }

    try {
      const projects = await listProjects()
      const project = projects.find((item) => item?.id === projectID && item?.path)
      if (project?.path) {
        projectPathByID.set(projectID, project.path)
        return project.path
      }
    } catch {}

    return null
  }

  const syncProject = async (projectID) => {
    await ensureProjectPath(projectID)

    const tasks = await projectConfigRuntime.listScheduledTasks(projectID)
    setProjectTasks(projectID, tasks)

    for (const task of tasks) {
      await syncTaskSchedule(projectID, task)
    }
    if (started) {
      pumpQueue()
    }

    return tasks
  }

  const syncAllProjects = async () => {
    const projects = await listProjects()
    const activeProjectIDs = new Set()
    projectPathByID.clear()
    for (const project of projects) {
      if (!project?.id || !project?.path) {
        continue
      }
      activeProjectIDs.add(project.id)
      projectPathByID.set(project.id, project.path)
    }

    for (const existingProjectID of Array.from(tasksByProject.keys())) {
      if (!activeProjectIDs.has(existingProjectID)) {
        clearProjectTimers(existingProjectID)
        tasksByProject.delete(existingProjectID)
      }
    }

    for (const projectID of activeProjectIDs) {
      await syncProject(projectID)
    }
  }

  const queueTaskRun = (projectID, taskID, reason) => {
    const taskKey = buildTaskKey(projectID, taskID)
    if (queuedTaskKeys.has(taskKey) || runningTaskKeys.has(taskKey)) {
      return
    }
    queuedTaskKeys.add(taskKey)
    queue.push({ projectID, taskID, reason })
  }

  const canRunTask = (projectID) => {
    if (runningGlobalCount >= maxGlobalConcurrency) {
      return false
    }
    const projectRunning = runningCountByProject.get(projectID) || 0
    return projectRunning < maxProjectConcurrency
  }

  const buildPromptAsyncPayload = (task, projectPath) => ({
    model: {
      providerID: task.execution.providerID,
      modelID: task.execution.modelID,
    },
    ...(task.execution.agent ? { agent: task.execution.agent } : {}),
    ...(task.execution.variant ? { variant: task.execution.variant } : {}),
    parts: [
      {
        type: "text",
        text: expandSnippets(task.execution.prompt, projectPath),
      },
    ],
  })

  const parseQueueItemResponse = async (response, operation) => {
    if (!response.ok) {
      const body = await response.text().catch(() => "")
      throw new Error(`${operation} failed (${response.status})${body ? `: ${body}` : ""}`)
    }
    const item = await response.json().catch(() => null)
    if (!item || typeof item.id !== "string" || typeof item.status !== "string") {
      throw new Error(`${operation} returned no durable queue item`)
    }
    return item
  }

  const requestAsyncExecution = async ({ baseUrl, authHeaders, sessionID, projectPath, task, kind, body }) => {
    const requestUrl = new URL(`${baseUrl}/session/${encodeURIComponent(sessionID)}/${kind}_async`)
    requestUrl.searchParams.set("directory", projectPath)
    requestUrl.searchParams.set("executionTimeoutMs", String(maxRunDurationMs))
    requestUrl.searchParams.set("sourceTaskID", `desktop:${task.id}`)
    requestUrl.searchParams.set("resumeOnRestart", "true")
    const response = await fetchImpl(requestUrl.toString(), {
      method: "POST",
      headers: {
        ...authHeaders,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
    })
    return parseQueueItemResponse(response, `${kind}_async`)
  }

  const runPromptAsync = ({ baseUrl, authHeaders, sessionID, projectPath, task }) => {
    return requestAsyncExecution({
      baseUrl,
      authHeaders,
      sessionID,
      projectPath,
      task,
      kind: "prompt",
      body: buildPromptAsyncPayload(task, projectPath),
    })
  }

  const readQueueItem = async ({ baseUrl, authHeaders, projectPath, queueItemID }) => {
    const queueUrl = new URL(`${baseUrl}/task-queue/${encodeURIComponent(queueItemID)}`)
    queueUrl.searchParams.set("directory", projectPath)
    const response = await fetchImpl(queueUrl.toString(), {
      method: "GET",
      headers: {
        ...authHeaders,
        accept: "application/json",
      },
    })
    return parseQueueItemResponse(response, "task queue poll")
  }

  const waitForQueueTerminal = async ({ baseUrl, authHeaders, projectPath, queueItem }) => {
    let current = queueItem
    while (!TERMINAL_QUEUE_STATUSES.has(current.status)) {
      await wait(queuePollIntervalMs)
      current = await readQueueItem({
        baseUrl,
        authHeaders,
        projectPath,
        queueItemID: current.id,
      })
    }
    if (current.status !== "completed") {
      throw new Error(current.error || `task queue item ended with status ${current.status}`)
    }
    return current
  }

  const runScheduledCommandIfApplicable = async ({ client, baseUrl, authHeaders, projectPath, sessionID, task }) => {
    const parsed = parseScheduledCommandPrompt(task?.execution?.prompt)
    if (!parsed) {
      return null
    }

    let commands = []
    try {
      const response = await client.command.list({ directory: projectPath })
      commands = Array.isArray(response?.data) ? response.data : []
    } catch {
      return null
    }

    const hasMatchingCommand = commands.some((command) => command?.name === parsed.command)
    if (!hasMatchingCommand) {
      return null
    }

    return requestAsyncExecution({
      baseUrl,
      authHeaders,
      sessionID,
      projectPath,
      task,
      kind: "command",
      body: {
        command: parsed.command,
        arguments: parsed.arguments,
        ...(task.execution.agent ? { agent: task.execution.agent } : {}),
        model: `${task.execution.providerID}/${task.execution.modelID}`,
        ...(task.execution.variant ? { variant: task.execution.variant } : {}),
      },
    })
  }

  const runTaskWithWatchdog = async (projectID, task, reason) => {
    const startedAt = Date.now()
    const projectPath = projectPathByID.get(projectID)
    if (!projectPath) {
      throw new Error("project path is unavailable")
    }

    if (typeof waitForAxCodeReady === "function") {
      await waitForAxCodeReady(10_000, 250)
    }

    const baseUrl = buildAxCodeUrl("/", "").replace(/\/$/, "")
    const authHeaders = getAxCodeAuthHeaders()
    const client = createClient({
      baseUrl,
      headers: authHeaders,
    })

    let sessionID = asNonEmptyString(task.state?.lastSessionId)
    let queueItem
    const activeQueueItemID = asNonEmptyString(task.state?.activeQueueItemId)
    if (activeQueueItemID) {
      queueItem = await readQueueItem({
        baseUrl,
        authHeaders,
        projectPath,
        queueItemID: activeQueueItemID,
      })
      sessionID = asNonEmptyString(queueItem.sessionID) || sessionID
    } else {
      const title = formatScheduledSessionTitle(task, startedAt)
      const sessionResponse = await client.session.create({
        directory: projectPath,
        title,
      })
      sessionID = sessionResponse?.data?.id
      if (!sessionID) {
        throw new Error("failed to create session")
      }

      queueItem = await runScheduledCommandIfApplicable({
        client,
        baseUrl,
        authHeaders,
        projectPath,
        sessionID,
        task,
      })
      if (!queueItem) {
        queueItem = await runPromptAsync({
          baseUrl,
          authHeaders,
          sessionID,
          projectPath,
          task,
        })
      }
      sessionID = asNonEmptyString(queueItem.sessionID) || sessionID

      // The core queue item is the recovery handle. Persist it as soon as the
      // 202 response arrives, but keep tracking it even if Desktop state
      // persistence temporarily fails.
      await projectConfigRuntime
        .updateScheduledTaskState(projectID, task.id, {
          lastStatus: "running",
          lastSessionId: sessionID,
          activeQueueItemId: queueItem.id,
          activeRunReason: reason,
          updatedAt: Date.now(),
        })
        .then((result) => {
          if (result.task) {
            updateInMemoryTask(projectID, result.task)
          }
        })
        .catch((error) => {
          logger.warn?.("[ScheduledTasks] failed to persist active queue handle", {
            projectID,
            taskID: task.id,
            queueItemID: queueItem.id,
            error: safeErrorMessage(error),
          })
        })
    }

    try {
      emitTaskRunEvent?.({
        projectID,
        taskID: task.id,
        ranAt: startedAt,
        status: "running",
        sessionID,
      })
    } catch {}

    await waitForQueueTerminal({
      baseUrl,
      authHeaders,
      projectPath,
      queueItem,
    })

    const finishedAt = Date.now()
    return {
      sessionID,
      durationMs: Math.max(0, finishedAt - startedAt),
      reason,
      startedAt,
      finishedAt,
    }
  }

  const runTask = async (projectID, taskID, reason) => {
    const taskMap = tasksByProject.get(projectID)
    const task = taskMap?.get(taskID)
    const recoveringAcceptedRun = Boolean(asNonEmptyString(task?.state?.activeQueueItemId))
    if (!task || (!task.enabled && !recoveringAcceptedRun)) {
      return { ok: false, skipped: true }
    }

    const taskKey = buildTaskKey(projectID, taskID)
    if (runningTaskKeys.has(taskKey)) {
      return { ok: false, running: true }
    }

    runningTaskKeys.add(taskKey)
    runningGlobalCount += 1
    runningCountByProject.set(projectID, (runningCountByProject.get(projectID) || 0) + 1)

    try {
      const runStartedAt = Date.now()
      await projectConfigRuntime
        .updateScheduledTaskState(projectID, taskID, {
          lastRunAt: runStartedAt,
          lastStatus: "running",
          lastError: undefined,
          updatedAt: runStartedAt,
        })
        .then((result) => {
          if (result.task) {
            updateInMemoryTask(projectID, result.task)
          }
        })

      let status = "success"
      let sessionID
      let durationMs = 0
      let errorMessage

      try {
        const runPromise = runTaskWithWatchdog(projectID, task, reason)
        let timedOut = false
        let timeoutID
        const timeoutPromise = new Promise((_, reject) => {
          timeoutID = setTimeout(() => {
            timedOut = true
            reject(new Error("scheduled task run timed out"))
          }, maxRunDurationMs)
        })

        // When the timeout wins the race below, runPromise stays pending and its
        // fetch/SDK calls can still reject afterwards. With no handler attached
        // that surfaces as an unhandled rejection (can crash the process), so log
        // and swallow it. Guard on timedOut so a normal rejection (already
        // surfaced by the race) isn't double-logged.
        runPromise.catch((err) => {
          if (timedOut) {
            logger.warn?.("[ScheduledTasks] run rejected after timeout", {
              projectID,
              taskID,
              error: err?.message ?? String(err),
            })
          }
        })

        const result = await Promise.race([runPromise, timeoutPromise]).finally(() => {
          if (timeoutID) {
            clearTimeout(timeoutID)
          }
        })
        sessionID = result.sessionID
        durationMs = result.durationMs
        status = "success"
        logger.info?.("[ScheduledTasks] run completed", { projectID, taskID, status, reason, sessionID, durationMs })
      } catch (error) {
        status = "error"
        errorMessage = safeErrorMessage(error)
        logger.warn?.("[ScheduledTasks] run failed", {
          projectID,
          taskID,
          reason,
          status,
          error: errorMessage,
        })
      }

      const finishedAt = Date.now()
      if (!durationMs) {
        durationMs = Math.max(0, finishedAt - runStartedAt)
      }
      let latestTask = tasksByProject.get(projectID)?.get(taskID) || task
      const shouldConsumeOneTimeTask = latestTask?.schedule?.kind === "once" && reason === "scheduled"
      if (shouldConsumeOneTimeTask && latestTask?.enabled) {
        try {
          const consumed = await projectConfigRuntime.upsertScheduledTask(projectID, {
            ...latestTask,
            enabled: false,
          })
          latestTask = consumed.task || latestTask
          updateInMemoryTask(projectID, latestTask)
        } catch (consumeError) {
          logger.warn?.("[ScheduledTasks] failed to consume one-time task", {
            projectID,
            taskID,
            error: safeErrorMessage(consumeError),
          })
        }
      }

      const nextRunAt = computeNextRunAt(latestTask, finishedAt)

      const statePatch = {
        lastStatus: status,
        lastDurationMs: durationMs,
        lastError: status === "error" ? errorMessage : undefined,
        lastSessionId: sessionID,
        activeQueueItemId: undefined,
        activeRunReason: undefined,
        nextRunAt: Number.isFinite(nextRunAt) ? nextRunAt : undefined,
        updatedAt: finishedAt,
      }

      const stateResult = await projectConfigRuntime.updateScheduledTaskState(projectID, taskID, statePatch)
      if (stateResult.task) {
        updateInMemoryTask(projectID, stateResult.task)
        if (stateResult.task.enabled && Number.isFinite(stateResult.task.state?.nextRunAt)) {
          scheduleTask(projectID, taskID, stateResult.task.state.nextRunAt)
        }
      }

      try {
        emitTaskRunEvent?.({
          projectID,
          taskID,
          ranAt: finishedAt,
          status,
          ...(sessionID ? { sessionID } : {}),
        })
      } catch {}

      return {
        ok: status === "success",
        status,
        sessionID,
        task: stateResult.task || null,
        error: errorMessage,
      }
    } finally {
      runningTaskKeys.delete(taskKey)
      runningGlobalCount = Math.max(0, runningGlobalCount - 1)
      const nextProjectCount = Math.max(0, (runningCountByProject.get(projectID) || 1) - 1)
      if (nextProjectCount === 0) {
        runningCountByProject.delete(projectID)
      } else {
        runningCountByProject.set(projectID, nextProjectCount)
      }
    }
  }

  const pumpQueue = () => {
    if (!started) {
      return
    }

    let consumed = false
    for (let index = 0; index < queue.length; index += 1) {
      const item = queue[index]
      if (!canRunTask(item.projectID)) {
        continue
      }

      queue.splice(index, 1)
      index -= 1

      const taskKey = buildTaskKey(item.projectID, item.taskID)
      queuedTaskKeys.delete(taskKey)
      consumed = true

      void runTask(item.projectID, item.taskID, item.reason).finally(() => {
        pumpQueue()
      })
    }

    if (!consumed && queue.length > 0) {
      return
    }
  }

  const runNow = async (projectID, taskID) => {
    const taskKey = buildTaskKey(projectID, taskID)
    if (runningTaskKeys.has(taskKey)) {
      return {
        ok: false,
        running: true,
        error: "task is already running",
      }
    }
    if (queuedTaskKeys.has(taskKey)) {
      return {
        ok: false,
        queued: true,
        error: "task is already queued",
      }
    }

    // Re-pump the queue on completion so tasks that queued while this manual run
    // held the last concurrency slot get drained, mirroring the scheduled path's
    // runTask(...).finally(pumpQueue). Without this a manual run that saturates
    // the limit leaves queued tasks stuck until an unrelated timer fires.
    return runTask(projectID, taskID, "manual").finally(() => {
      pumpQueue()
    })
  }

  const start = async () => {
    if (started) {
      return
    }
    started = true
    await syncAllProjects()
    pumpQueue()
  }

  const stop = () => {
    if (!started) {
      return
    }
    started = false
    for (const timer of timersByTaskKey.values()) {
      clearTimeout(timer)
    }
    timersByTaskKey.clear()
    queuedTaskKeys.clear()
    queue.length = 0
  }

  const getStatus = () => {
    let enabledCount = 0
    for (const taskMap of tasksByProject.values()) {
      for (const task of taskMap.values()) {
        if (task?.enabled) {
          enabledCount += 1
        }
      }
    }

    const runningCount = runningTaskKeys.size
    return {
      hasEnabledScheduledTasks: enabledCount > 0,
      hasRunningScheduledTasks: runningCount > 0,
      enabledScheduledTasksCount: enabledCount,
      runningScheduledTasksCount: runningCount,
    }
  }

  return {
    start,
    stop,
    syncAllProjects,
    syncProject,
    runNow,
    getStatus,
  }
}
