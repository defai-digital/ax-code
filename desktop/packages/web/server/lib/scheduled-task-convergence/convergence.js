// S2.6 (SPEC-2026-08-29-desktop-process-model-collapse §2 D6): one-time,
// marker-gated migration of desktop scheduled tasks (project JSON
// `scheduledTasks` keys) into the ax-code runtime `/scheduled-task` store,
// plus the per-boot directory wake-up that starts each runtime instance's
// scheduler (the runtime only boots an instance — and therefore its
// scheduler loop, packages/ax-code/src/project/bootstrap.ts — on the first
// request carrying `?directory=<path>`).
//
// Migration contract (locked in the S2.6 plan):
// - Marker file next to the projects dir (scheduled-tasks-migrated.json)
//   records { migratedAt, attempts, skipped, warnings }. `migratedAt` present
//   means done; absent means retry next boot (up to maxAttempts, then every
//   remaining task is recorded as a skip and the marker is finalized).
// - Idempotency heuristic: before creating, the migration lists the runtime
//   tasks for the directory and skips titles that already exist. A previous
//   half-completed run therefore resumes without duplicates. The title match
//   can false-positive against a user-created task with the same name; that
//   is accepted and documented here rather than adding a core marker field.
// - Only confirmed tasks are removed from the project JSON (confirmed =
//   created now, or already present by title). The `scheduledTasks` key is
//   deleted from the JSON only when nothing remains for that project.
// - Permanent skips (unsupported cron syntax, slash-command prompts, fired
//   one-shots, oversized prompts) are recorded in the marker AND logged so
//   support can see exactly what was dropped.

import { transformDesktopScheduledTask } from "./transform.js"

const DEFAULT_MAX_ATTEMPTS = 5
const DEFAULT_WAKE_CONCURRENCY = 4
const DEFAULT_READY_TIMEOUT_MS = 60_000
const DEFAULT_READY_INTERVAL_MS = 500

const asNonEmptyString = (value) => {
  if (typeof value !== "string") {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

const safeParseJsonObject = (raw) => {
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

export const createScheduledTaskConvergence = (deps) => {
  const {
    fsPromises,
    path,
    projectsDirPath,
    markerPath,
    projectConfigRuntime,
    listProjects,
    buildAxCodeUrl,
    getAxCodeAuthHeaders,
    waitForAxCodeReady,
    expandSnippets,
    logger = console,
    fetchImpl = fetch,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    wakeConcurrency = DEFAULT_WAKE_CONCURRENCY,
    readyTimeoutMs = DEFAULT_READY_TIMEOUT_MS,
    readyIntervalMs = DEFAULT_READY_INTERVAL_MS,
  } = deps

  // --- runtime HTTP helpers ---------------------------------------------
  const runtimeRequest = async ({ method, route, directory, body }) => {
    const base = buildAxCodeUrl("/", "").replace(/\/+$/, "")
    const url = new URL(`${base}${route}`)
    url.searchParams.set("directory", directory)
    const response = await fetchImpl(url.toString(), {
      method,
      headers: {
        ...getAxCodeAuthHeaders(),
        accept: "application/json",
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    if (!response.ok) {
      const text = await response.text().catch(() => "")
      const error = new Error(`runtime ${method} ${route} failed (${response.status})${text ? `: ${text}` : ""}`)
      error.status = response.status
      throw error
    }
    const parsed = await response.json().catch(() => null)
    return parsed
  }

  const listRuntimeTasks = async (directory) => {
    const result = await runtimeRequest({ method: "GET", route: "/scheduled-task", directory })
    return Array.isArray(result) ? result : []
  }

  const createRuntimeTask = async (directory, payload) => {
    return runtimeRequest({ method: "POST", route: "/scheduled-task", directory, body: payload })
  }

  const pauseRuntimeTask = async (directory, taskID) => {
    return runtimeRequest({
      method: "POST",
      route: `/scheduled-task/${encodeURIComponent(taskID)}/pause`,
      directory,
    })
  }

  // --- marker ------------------------------------------------------------
  const readMarker = async () => {
    try {
      const raw = await fsPromises.readFile(markerPath, "utf8")
      return safeParseJsonObject(raw)
    } catch {
      return null
    }
  }

  const writeMarker = async (record) => {
    const temporaryPath = `${markerPath}.tmp-${process.pid}-${Date.now()}`
    await fsPromises.mkdir(path.dirname(markerPath), { recursive: true })
    await fsPromises.writeFile(temporaryPath, JSON.stringify(record, null, 2), "utf8")
    await fsPromises.rename(temporaryPath, markerPath)
  }

  // --- project enumeration ------------------------------------------------
  const listProjectConfigFiles = async () => {
    let entries
    try {
      entries = await fsPromises.readdir(projectsDirPath)
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ENOENT") {
        return []
      }
      throw error
    }
    return entries.filter((entry) => entry.endsWith(".json")).sort()
  }

  const readProjectConfigFile = async (fileName) => {
    try {
      const raw = await fsPromises.readFile(path.join(projectsDirPath, fileName), "utf8")
      return safeParseJsonObject(raw)
    } catch {
      return null
    }
  }

  const isRetryableRuntimeError = (error) => {
    // 400 = the runtime rejected the payload (it will never accept it);
    // 409 = project task cap reached or a run-state conflict. Both are
    // recorded as permanent skips instead of burning boot retries.
    const status = typeof error?.status === "number" ? error.status : 0
    return !(status === 400 || status === 409)
  }

  // Migrate a single desktop task. Returns "migrated" | { retry: reason } | { skip: reason }.
  const migrateTask = async ({ projectID, projectPath, task, existingByTitle, now }) => {
    const taskLabel = asNonEmptyString(task?.name) || asNonEmptyString(task?.id) || "unnamed"
    const result = transformDesktopScheduledTask(task, {
      now,
      expandPrompt: (prompt) => expandSnippets(prompt, projectPath),
    })
    const warnings = result.warnings.map((warning) => ({ project: projectID, task: taskLabel, warning }))
    if (result.status !== "ready") {
      return { outcome: "skipped", reason: result.reason, taskLabel, warnings }
    }

    for (const payload of result.payloads) {
      const existing = existingByTitle.get(payload.title)
      if (existing) {
        // Idempotency: already created by a previous (half-completed) run.
        // A disabled desktop task must still end up paused — a previous run
        // may have created the task but crashed before the pause call.
        if (result.pause && existing.status === "active" && typeof existing.id === "string") {
          try {
            await pauseRuntimeTask(projectPath, existing.id)
            existing.status = "paused"
          } catch (error) {
            if (isRetryableRuntimeError(error)) {
              return { outcome: "retry", reason: error.message, taskLabel, warnings }
            }
            warnings.push({
              project: projectID,
              task: taskLabel,
              warning: `created earlier but pause failed permanently: ${error.message}`,
            })
          }
        }
        continue
      }
      let created
      try {
        created = await createRuntimeTask(projectPath, payload)
      } catch (error) {
        if (isRetryableRuntimeError(error)) {
          return { outcome: "retry", reason: error.message, taskLabel, warnings }
        }
        return { outcome: "skipped", reason: error.message, taskLabel, warnings }
      }
      const createdID = typeof created?.id === "string" ? created.id : null
      existingByTitle.set(payload.title, { id: createdID, status: "active" })
      if (result.pause) {
        if (createdID) {
          try {
            await pauseRuntimeTask(projectPath, createdID)
            existingByTitle.set(payload.title, { id: createdID, status: "paused" })
          } catch (error) {
            // The task was already created (and is tracked in existingByTitle),
            // so a retry would hit the idempotent "existing" branch above
            // rather than creating a duplicate.
            if (isRetryableRuntimeError(error)) {
              return { outcome: "retry", reason: error.message, taskLabel, warnings }
            }
            warnings.push({
              project: projectID,
              task: taskLabel,
              warning: `created but pause failed permanently: ${error.message}`,
            })
          }
        } else {
          warnings.push({
            project: projectID,
            task: taskLabel,
            warning: "created without a readable id; pause was skipped and the task is active",
          })
        }
      }
    }
    return { outcome: "migrated", taskLabel, warnings }
  }

  const migrate = async () => {
    const marker = await readMarker()
    if (marker && typeof marker.migratedAt === "number") {
      return { migrated: false, reason: "marker-present" }
    }
    const attempts = (typeof marker?.attempts === "number" ? marker.attempts : 0) + 1
    const skipped = Array.isArray(marker?.skipped) ? marker.skipped.slice() : []
    const warnings = Array.isArray(marker?.warnings) ? marker.warnings.slice() : []
    const now = Date.now()

    const files = await listProjectConfigFiles()
    let settingsProjects = []
    try {
      settingsProjects = await listProjects()
    } catch {
      settingsProjects = []
    }
    const settingsPathByID = new Map()
    for (const project of settingsProjects) {
      const id = asNonEmptyString(project?.id)
      const projectPath = asNonEmptyString(project?.path)
      if (id && projectPath) {
        settingsPathByID.set(id, projectPath)
      }
    }

    // Per-file remaining tasks, kept for the attempts-exhausted cleanup.
    const remainingByFile = new Map()
    let retryableRemaining = 0

    for (const fileName of files) {
      const projectID = fileName.slice(0, -".json".length)
      const config = await readProjectConfigFile(fileName)
      if (!config) {
        warnings.push({ project: projectID, task: null, warning: "project config JSON is unreadable; skipped" })
        continue
      }
      const tasks = Array.isArray(config.scheduledTasks) ? config.scheduledTasks : []
      if (tasks.length === 0) {
        continue
      }
      const projectPath =
        asNonEmptyString(config.projectPath) || asNonEmptyString(config.path) || settingsPathByID.get(projectID) || null
      if (!projectPath) {
        for (const task of tasks) {
          skipped.push({
            project: projectID,
            task: asNonEmptyString(task?.name) || asNonEmptyString(task?.id) || "unnamed",
            reason: "project path is unavailable",
          })
        }
        await projectConfigRuntime.replaceScheduledTasks(projectID, [])
        continue
      }

      let existingByTitle
      try {
        const existing = await listRuntimeTasks(projectPath)
        existingByTitle = new Map()
        for (const task of existing) {
          if (typeof task?.title === "string") {
            existingByTitle.set(task.title, task)
          }
        }
      } catch (error) {
        // Runtime unreachable mid-migration: leave the file untouched so the
        // whole project retries next boot.
        retryableRemaining += tasks.length
        remainingByFile.set(projectID, tasks)
        logger.warn("[ScheduledTaskMigration] runtime task list failed; project left for next boot", {
          project: projectID,
          error: error?.message || String(error),
        })
        continue
      }

      const remaining = []
      for (const task of tasks) {
        const outcome = await migrateTask({ projectID, projectPath, task, existingByTitle, now })
        warnings.push(...outcome.warnings)
        if (outcome.outcome === "retry") {
          remaining.push(task)
          continue
        }
        if (outcome.outcome === "skipped") {
          skipped.push({ project: projectID, task: outcome.taskLabel, reason: outcome.reason })
          logger.warn("[ScheduledTaskMigration] task skipped", {
            project: projectID,
            task: outcome.taskLabel,
            reason: outcome.reason,
          })
        }
      }
      retryableRemaining += remaining.length
      remainingByFile.set(projectID, remaining)
      await projectConfigRuntime.replaceScheduledTasks(projectID, remaining)
    }

    if (retryableRemaining === 0) {
      await writeMarker({ migratedAt: Date.now(), attempts, skipped, warnings })
      return { migrated: true, attempts, skippedCount: skipped.length }
    }

    if (attempts >= maxAttempts) {
      for (const [projectID, remaining] of remainingByFile) {
        if (remaining.length === 0) {
          continue
        }
        for (const task of remaining) {
          skipped.push({
            project: projectID,
            task: asNonEmptyString(task?.name) || asNonEmptyString(task?.id) || "unnamed",
            reason: `migration attempts exhausted (${maxAttempts})`,
          })
        }
        await projectConfigRuntime.replaceScheduledTasks(projectID, [])
      }
      await writeMarker({ migratedAt: Date.now(), attempts, skipped, warnings })
      return { migrated: true, attempts, exhausted: true, skippedCount: skipped.length }
    }

    // Progress marker: no migratedAt, so the next boot retries the tasks that
    // remain in the project JSONs.
    await writeMarker({ attempts, lastAttemptAt: Date.now(), skipped, warnings })
    return { migrated: false, reason: "retry-pending", attempts, retryableRemaining }
  }

  // Wake each registered project directory's runtime instance so its
  // scheduler loop starts even before the user opens that project. A plain
  // GET /scheduled-task?directory=<path> is enough — the runtime bootstraps
  // the instance (and starts the scheduler) on the first scoped request.
  const wakeUp = async () => {
    let projects = []
    try {
      projects = await listProjects()
    } catch (error) {
      logger.warn("[ScheduledTaskMigration] project list unavailable for scheduler wake-up", {
        error: error?.message || String(error),
      })
      return
    }
    const directories = []
    const seen = new Set()
    for (const project of projects) {
      const projectPath = asNonEmptyString(project?.path)
      if (projectPath && !seen.has(projectPath)) {
        seen.add(projectPath)
        directories.push(projectPath)
      }
    }

    let index = 0
    const worker = async () => {
      while (index < directories.length) {
        const directory = directories[index]
        index += 1
        try {
          await listRuntimeTasks(directory)
        } catch (error) {
          // Non-fatal: the scheduler also starts when the user opens the
          // project, and wake-up is retried on the next boot.
          logger.warn("[ScheduledTaskMigration] scheduler wake-up failed for directory", {
            directory,
            error: error?.message || String(error),
          })
        }
      }
    }
    const workers = []
    for (let i = 0; i < Math.min(wakeConcurrency, directories.length); i += 1) {
      workers.push(worker())
    }
    await Promise.all(workers)
  }

  const start = async () => {
    try {
      await waitForAxCodeReady(readyTimeoutMs, readyIntervalMs)
    } catch (error) {
      // Non-fatal and deliberately not counted as a migration attempt: the
      // marker is untouched, so the next boot retries everything.
      logger.warn("[ScheduledTaskMigration] runtime not ready; migration and wake-up deferred to next boot", {
        error: error?.message || String(error),
      })
      return
    }

    try {
      const result = await migrate()
      if (result.migrated) {
        logger.info("[ScheduledTaskMigration] desktop scheduled tasks migration finished", {
          attempts: result.attempts,
          skippedCount: result.skippedCount,
          exhausted: result.exhausted === true,
        })
      }
    } catch (error) {
      logger.warn("[ScheduledTaskMigration] migration pass failed; will retry on next boot", {
        error: error?.message || String(error),
      })
    }

    await wakeUp()
  }

  return {
    start,
    migrate,
    wakeUp,
  }
}
