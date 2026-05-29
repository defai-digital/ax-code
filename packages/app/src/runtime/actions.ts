import type { AppQueueItem, AppRollbackPoint, AppScheduledTask, AppTerminal, AppWorktree } from "../projection/types"
import type { AxCodeAppRuntimeConfig } from "./config"
import {
  createLiveHeadlessClient,
  normalizeLiveQueueItem,
  normalizeScheduledTask,
  normalizeTerminal,
  normalizeWorktree,
} from "./live"

export type QueueDraftMode = "prompt" | "command" | "shell"

type DraftRuntimeModel =
  | string
  | {
      providerID: string
      modelID: string
    }

export type QueueDraftClient = {
  createSession?(input?: { title?: string }): Promise<{ id: string }>
  sendPrompt?(
    sessionID: string,
    body: { parts: Array<{ type: string; text: string }>; agent?: string; model?: DraftRuntimeModel },
    options?: { mode?: "sync" | "async" },
  ): Promise<unknown>
  sendCommand?(
    sessionID: string,
    body: { command: string; arguments: string; agent?: string; model?: string },
    options?: { mode?: "sync" | "async" },
  ): Promise<unknown>
  sendShell?(
    sessionID: string,
    body: { command: string; agent?: string; model?: DraftRuntimeModel },
    options?: { mode?: "sync" | "async" },
  ): Promise<unknown>
  taskQueue?: {
    enqueue?(input: {
      sessionID?: string
      kind: QueueDraftMode | "review"
      title: string
      agent?: string
      model?: unknown
      sourceMessageID?: string
      sourceTaskID?: string
      payload?: Record<string, unknown>
      priority?: number
    }): Promise<unknown>
    pause?(id: string): Promise<unknown>
    resume?(id: string): Promise<unknown>
    cancel?(id: string): Promise<unknown>
    retry?(id: string): Promise<unknown>
    sendNow?(id: string): Promise<unknown>
    reorder?(id: string, position: number): Promise<unknown>
  }
  replyPermission?(body: { requestID: string; reply?: "once" | "always" | "reject" }): Promise<unknown>
  replyQuestion?(body: { requestID: string; answers: unknown }): Promise<unknown>
  abort?(sessionID: string): Promise<unknown>
}

export type QueueItemCommand = "send-now" | "pause" | "resume" | "cancel" | "retry" | "move-up" | "move-down"
export type WorktreeCommand = "create" | "reset" | "remove"
export type TerminalCommand = "create" | "remove"
export type ScheduledTaskCommand = "run-now" | "pause" | "resume" | "remove"
export type ReviewCommand = "revert" | "unrevert"

export type RunDraftResult = {
  accepted: true
  sessionID: string
}

export type WorktreeActionClient = {
  worktree?: {
    create?(input?: { name?: string; startCommand?: string }): Promise<unknown>
    reset?(input: { directory: string }): Promise<unknown>
    remove?(input: { directory: string }): Promise<unknown>
  }
}

export type ToolPaneClient = {
  pty?: {
    create?(input: { command?: string; title?: string; cwd?: string }): Promise<unknown>
    remove?(id: string): Promise<unknown>
  }
  file?: {
    read?(path: string): Promise<unknown>
  }
}

export type ScheduledTaskActionClient = {
  scheduledTask?: {
    create?(input: {
      title: string
      prompt: string
      schedule: { type: "daily"; time: string }
      agent?: string
      model?: unknown
    }): Promise<unknown>
    runNow?(id: string): Promise<unknown>
    pause?(id: string): Promise<unknown>
    resume?(id: string): Promise<unknown>
    remove?(id: string): Promise<unknown>
  }
}

export type ReviewActionClient = {
  review?: {
    revert?(input: { sessionID: string; messageID: string; partID?: string }): Promise<unknown>
    unrevert?(sessionID: string): Promise<unknown>
    compare?(input: { sessionID: string; otherSessionID: string; deep?: boolean }): Promise<unknown>
  }
  taskQueue?: QueueDraftClient["taskQueue"]
}

export type DesktopBridgeClient = {
  invoke(name: "path.reveal", payload: { path: string }): Promise<unknown>
  invoke(
    name: "notification.show",
    payload: { title: string; body?: string; source?: "scheduled-task"; silent?: boolean },
  ): Promise<unknown>
}

export type FileActionClient = {
  desktopBridge?: DesktopBridgeClient
}

export type ScheduledNotificationClient = {
  desktopBridge?: DesktopBridgeClient
}

export type FilePreviewResult = {
  path: string
  type: "text" | "binary" | "error"
  content: string
  mimeType?: string
}

export type AppReviewComparison = {
  session1: AppReviewComparisonSession
  session2: AppReviewComparisonSession
  winner: "A" | "B" | "tie"
  confidence?: number
  recommendation?: string
  reasons: string[]
  differences: string[]
}

export type AppReviewComparisonSession = {
  id: string
  title: string
  riskScore?: number
  decisionScore?: number
  headline?: string
}

let localSequence = 0

export async function queueDraftTask(input: {
  config: AxCodeAppRuntimeConfig
  mode: QueueDraftMode
  text: string
  sessionID?: string
  targetDirectory?: string
  metadata?: Record<string, unknown>
  agent?: string
  model?: unknown
  sourceMessageID?: string
  sourceTaskID?: string
  client?: QueueDraftClient
}): Promise<AppQueueItem> {
  const text = input.text.trim()
  if (!text) throw new Error("Draft is empty")

  const title = draftTitle(text)
  const payload = {
    source: "app.composer",
    mode: input.mode,
    text,
    ...(input.metadata ?? {}),
  }

  if (input.config.mode === "live") {
    const client =
      input.client ?? createLiveHeadlessClient(runtimeConfigForDirectory(input.config, input.targetDirectory))
    const item = await client.taskQueue?.enqueue?.({
      sessionID: input.sessionID,
      kind: input.mode,
      title,
      agent: input.agent,
      model: input.model,
      ...(input.sourceMessageID ? { sourceMessageID: input.sourceMessageID } : {}),
      ...(input.sourceTaskID ? { sourceTaskID: input.sourceTaskID } : {}),
      payload,
    })
    const normalized = normalizeLiveQueueItem(item)
    if (!normalized) throw new Error("Backend returned an invalid task queue item")
    return normalized
  }

  localSequence++
  return {
    id: `tsk_fixture_${localSequence}`,
    project: "fixture",
    directory: input.targetDirectory,
    sessionID: input.sessionID,
    title,
    kind: input.mode,
    status: "queued",
    priority: 0,
    agent: input.agent,
    model: input.model,
    payload,
    sourceMessageID: input.sourceMessageID,
    sourceTaskID: input.sourceTaskID,
    createdAt: Date.now(),
  }
}

export async function queueMultiRunTask(input: {
  config: AxCodeAppRuntimeConfig
  text: string
  count: number
  worktreeNamePrefix?: string
  agent?: string
  model?: unknown
  client?: QueueDraftClient & WorktreeActionClient
}): Promise<{ worktrees: AppWorktree[]; queue: AppQueueItem[] }> {
  const text = input.text.trim()
  if (!text) throw new Error("Draft is empty")
  const requestedCount = Number.isFinite(input.count) ? Math.floor(input.count) : 1
  const count = Math.max(1, Math.min(requestedCount, 6))
  const multiRunID = nextMultiRunID()
  const worktrees: AppWorktree[] = []
  const queue: AppQueueItem[] = []

  for (let index = 0; index < count; index++) {
    const name = multiRunWorktreeName(input.worktreeNamePrefix, index)
    const worktree = await runWorktreeCommand({
      config: input.config,
      command: "create",
      name,
      client: input.client,
    })
    if (!("name" in worktree)) continue
    worktrees.push(worktree)
    const sessionID = await createMultiRunSession({
      config: input.config,
      client: input.client,
      worktree,
      text,
      index,
      count,
    })
    const item = await queueDraftTask({
      config: input.config,
      mode: "prompt",
      text,
      sessionID,
      targetDirectory: worktree.directory,
      metadata: {
        multiRunID,
        multiRunIndex: index + 1,
        multiRunCount: count,
        worktree: worktree.name,
      },
      agent: input.agent,
      model: input.model,
      client: input.client,
    })
    queue.push(item)
  }

  return { worktrees, queue }
}

export async function runDraftTask(input: {
  config: AxCodeAppRuntimeConfig
  mode: QueueDraftMode
  text: string
  sessionID?: string
  agent?: string
  model?: unknown
  client?: QueueDraftClient
}): Promise<RunDraftResult> {
  const text = input.text.trim()
  if (!text) throw new Error("Draft is empty")

  if (input.config.mode === "fixture") {
    localSequence++
    return {
      accepted: true,
      sessionID: input.sessionID ?? `ses_fixture_run_${localSequence}`,
    }
  }

  const client = input.client ?? createLiveHeadlessClient(input.config)
  const sessionID = input.sessionID ?? (await createDraftSession(client, text)).id
  const model = normalizeDraftModel(input.model)
  if (input.mode === "prompt") {
    if (!client.sendPrompt) throw new Error("Live client does not support prompt execution")
    await client.sendPrompt(
      sessionID,
      { parts: [{ type: "text", text }], agent: input.agent, model },
      { mode: "async" },
    )
  } else if (input.mode === "command") {
    if (!client.sendCommand) throw new Error("Live client does not support command execution")
    await client.sendCommand(
      sessionID,
      { command: text, arguments: "", agent: input.agent, model: typeof model === "string" ? model : undefined },
      { mode: "async" },
    )
  } else {
    if (!client.sendShell) throw new Error("Live client does not support shell execution")
    await client.sendShell(sessionID, { command: text, agent: input.agent ?? "build", model }, { mode: "async" })
  }

  return { accepted: true, sessionID }
}

export async function replyPermissionRequest(input: {
  config: AxCodeAppRuntimeConfig
  requestID: string
  reply: "once" | "always" | "reject"
  client?: QueueDraftClient
}) {
  if (input.config.mode === "fixture") return { accepted: true }
  const client = input.client ?? createLiveHeadlessClient(input.config)
  if (!client.replyPermission) throw new Error("Live client does not support permission replies")
  await client.replyPermission({ requestID: input.requestID, reply: input.reply })
  return { accepted: true }
}

export async function replyQuestionRequest(input: {
  config: AxCodeAppRuntimeConfig
  requestID: string
  answers: unknown
  client?: QueueDraftClient
}) {
  if (input.config.mode === "fixture") return { accepted: true }
  const client = input.client ?? createLiveHeadlessClient(input.config)
  if (!client.replyQuestion) throw new Error("Live client does not support question replies")
  await client.replyQuestion({ requestID: input.requestID, answers: input.answers })
  return { accepted: true }
}

export async function runQueueItemCommand(input: {
  config: AxCodeAppRuntimeConfig
  command: QueueItemCommand
  item: AppQueueItem
  queue?: AppQueueItem[]
  client?: QueueDraftClient
}): Promise<AppQueueItem> {
  if (input.config.mode === "fixture") return fixtureQueueCommand(input.item, input.command, input.queue)

  const client = input.client ?? createLiveHeadlessClient(input.config)
  const api = client.taskQueue
  if (!api) throw new Error("Live client does not support task queue commands")
  if (input.command === "move-up" || input.command === "move-down") {
    const position = reorderPosition(input.item, input.command, input.queue)
    const reordered = await api.reorder?.(input.item.id, position)
    const normalized = normalizeLiveQueueItem(reordered)
    if (!normalized) throw new Error("Backend returned an invalid task queue item")
    return normalized
  }
  const result =
    input.command === "send-now"
      ? await api.sendNow?.(input.item.id)
      : input.command === "pause"
        ? await api.pause?.(input.item.id)
        : input.command === "resume"
          ? await api.resume?.(input.item.id)
          : input.command === "cancel"
            ? await api.cancel?.(input.item.id)
            : await api.retry?.(input.item.id)
  const normalized = normalizeLiveQueueItem(result)
  if (!normalized) throw new Error("Backend returned an invalid task queue item")
  return normalized
}

export async function abortSessionTask(input: {
  config: AxCodeAppRuntimeConfig
  sessionID: string
  client?: QueueDraftClient
}) {
  if (input.config.mode === "fixture") return { accepted: true }
  const client = input.client ?? createLiveHeadlessClient(input.config)
  if (!client.abort) throw new Error("Live client does not support session abort")
  await client.abort(input.sessionID)
  return { accepted: true }
}

export async function runWorktreeCommand(input: {
  config: AxCodeAppRuntimeConfig
  command: WorktreeCommand
  directory?: string
  name?: string
  client?: WorktreeActionClient
}): Promise<AppWorktree | { removed: true; directory: string } | { reset: true; directory: string }> {
  if (input.config.mode === "fixture") {
    if (input.command === "create") {
      localSequence++
      const name = input.name?.trim() || `wt-fixture-${localSequence}`
      return { directory: `/workspace/.ax-code/worktrees/${name}`, name }
    }
    if (!input.directory) throw new Error("Worktree directory is required")
    return input.command === "remove"
      ? { removed: true, directory: input.directory }
      : { reset: true, directory: input.directory }
  }

  const client = input.client ?? createLiveWorktreeActionClient(input.config)
  if (!client.worktree) throw new Error("Live client does not support worktree actions")
  if (input.command === "create") {
    const created = await client.worktree.create?.({ name: input.name?.trim() || undefined })
    const normalized = normalizeWorktree(created)
    if (!normalized) throw new Error("Backend returned an invalid worktree")
    return normalized
  }
  if (!input.directory) throw new Error("Worktree directory is required")
  if (input.command === "remove") {
    await client.worktree.remove?.({ directory: input.directory })
    return { removed: true, directory: input.directory }
  }
  await client.worktree.reset?.({ directory: input.directory })
  return { reset: true, directory: input.directory }
}

export async function runTerminalCommand(input: {
  config: AxCodeAppRuntimeConfig
  command: TerminalCommand
  terminalID?: string
  shellCommand?: string
  title?: string
  cwd?: string
  client?: ToolPaneClient
}): Promise<AppTerminal | { removed: true; id: string }> {
  if (input.config.mode === "fixture") {
    if (input.command === "create") {
      localSequence++
      const command = input.shellCommand?.trim() || "zsh"
      return {
        id: `pty_fixture_${localSequence}`,
        title: input.title?.trim() || command,
        command,
        cwd: input.cwd ?? "",
        status: "running",
      }
    }
    if (!input.terminalID) throw new Error("Terminal id is required")
    return { removed: true, id: input.terminalID }
  }

  const client = input.client ?? createLiveToolPaneClient(input.config)
  if (!client.pty) throw new Error("Live client does not support terminal actions")
  if (input.command === "create") {
    const command = input.shellCommand?.trim() || "zsh"
    const created = await client.pty.create?.({ command, title: input.title?.trim() || command, cwd: input.cwd })
    const normalized = normalizeTerminal(created)
    if (!normalized) throw new Error("Backend returned an invalid terminal")
    return normalized
  }
  if (!input.terminalID) throw new Error("Terminal id is required")
  await client.pty.remove?.(input.terminalID)
  return { removed: true, id: input.terminalID }
}

export async function readFilePreview(input: {
  config: AxCodeAppRuntimeConfig
  path: string
  client?: ToolPaneClient
}): Promise<FilePreviewResult> {
  const filePath = input.path.trim()
  if (!filePath) throw new Error("File path is required")
  if (input.config.mode === "fixture") {
    return {
      path: filePath,
      type: "text",
      content: `Fixture preview for ${filePath}`,
      mimeType: "text/plain",
    }
  }

  const client = input.client ?? createLiveToolPaneClient(input.config)
  if (!client.file) throw new Error("Live client does not support file preview")
  const raw = await client.file.read?.(filePath)
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  const type = record["type"] === "binary" ? "binary" : "text"
  return {
    path: filePath,
    type,
    content: typeof record["content"] === "string" ? record["content"] : "",
    mimeType: typeof record["mimeType"] === "string" ? record["mimeType"] : undefined,
  }
}

export async function revealFilePath(input: {
  config: AxCodeAppRuntimeConfig
  path: string
  client?: FileActionClient
}): Promise<{ revealed: true; path: string }> {
  const filePath = input.path.trim()
  if (!filePath) throw new Error("File path is required")
  if (input.config.mode === "fixture") return { revealed: true, path: filePath }

  const bridge = input.client?.desktopBridge ?? globalThis.window?.axCodeDesktop
  if (!bridge) throw new Error("Desktop bridge is not available for file actions")
  await bridge.invoke("path.reveal", { path: filePath })
  return { revealed: true, path: filePath }
}

export async function notifyScheduledTaskQueued(input: {
  config: AxCodeAppRuntimeConfig
  task: AppScheduledTask
  queueItem?: AppQueueItem
  client?: ScheduledNotificationClient
}): Promise<{ notified: boolean; title: string; body: string }> {
  const title = "Scheduled automation queued"
  const body = scheduledNotificationBody(input.task, input.queueItem)
  if (input.config.mode === "fixture") return { notified: false, title, body }

  const bridge = input.client?.desktopBridge ?? globalThis.window?.axCodeDesktop
  if (!bridge) return { notified: false, title, body }
  await bridge.invoke("notification.show", {
    title,
    body,
    source: "scheduled-task",
  })
  return { notified: true, title, body }
}

export async function runScheduledTaskCommand(input: {
  config: AxCodeAppRuntimeConfig
  command: ScheduledTaskCommand
  task: AppScheduledTask
  client?: ScheduledTaskActionClient
}): Promise<{ task?: AppScheduledTask; queueItem?: AppQueueItem; removed?: true }> {
  if (input.config.mode === "fixture") return fixtureScheduledTaskCommand(input.task, input.command)

  const client = input.client ?? createLiveScheduledTaskActionClient(input.config)
  const api = client.scheduledTask
  if (!api) throw new Error("Live client does not support scheduled task commands")
  if (input.command === "remove") {
    await api.remove?.(input.task.id)
    return { removed: true }
  }
  const result =
    input.command === "run-now"
      ? await api.runNow?.(input.task.id)
      : input.command === "pause"
        ? await api.pause?.(input.task.id)
        : await api.resume?.(input.task.id)
  if (input.command === "run-now") {
    const record = result && typeof result === "object" ? (result as Record<string, unknown>) : {}
    const task = normalizeScheduledTask(record["task"])
    const queueItem = normalizeLiveQueueItem(record["queueItem"])
    if (!task || !queueItem) throw new Error("Backend returned an invalid scheduled task run result")
    return { task, queueItem }
  }
  const task = normalizeScheduledTask(result)
  if (!task) throw new Error("Backend returned an invalid scheduled task")
  return { task }
}

export async function createScheduledTask(input: {
  config: AxCodeAppRuntimeConfig
  title: string
  prompt: string
  time: string
  agent?: string
  model?: unknown
  client?: ScheduledTaskActionClient
}): Promise<AppScheduledTask> {
  const title = input.title.trim()
  const prompt = input.prompt.trim()
  const time = input.time.trim()
  if (!title) throw new Error("Scheduled task title is required")
  if (!prompt) throw new Error("Scheduled task prompt is required")
  if (!/^\d{2}:\d{2}$/.test(time)) throw new Error("Scheduled task time must use HH:MM")

  if (input.config.mode === "fixture") {
    localSequence++
    return {
      id: `sch_fixture_${localSequence}`,
      project: "fixture",
      title,
      prompt,
      schedule: { type: "daily", time },
      status: "active",
      agent: input.agent,
      model: input.model,
      nextRunAt: Date.now() + 86_400_000,
    }
  }

  const client = input.client ?? createLiveScheduledTaskActionClient(input.config)
  if (!client.scheduledTask?.create) throw new Error("Live client does not support scheduled task creation")
  const task = normalizeScheduledTask(
    await client.scheduledTask.create({
      title,
      prompt,
      schedule: { type: "daily", time },
      agent: input.agent,
      model: input.model,
    }),
  )
  if (!task) throw new Error("Backend returned an invalid scheduled task")
  return task
}

export async function runReviewCommand(input: {
  config: AxCodeAppRuntimeConfig
  command: ReviewCommand
  sessionID: string
  rollbackPoint?: AppRollbackPoint
  client?: ReviewActionClient
}) {
  if (!input.sessionID) throw new Error("Session id is required")
  if (input.config.mode === "fixture") return { accepted: true }

  const client = input.client ?? createLiveReviewActionClient(input.config)
  if (!client.review) throw new Error("Live client does not support review actions")
  if (input.command === "unrevert") {
    await client.review.unrevert?.(input.sessionID)
    return { accepted: true }
  }

  const messageID = input.rollbackPoint?.messageID
  if (!messageID) throw new Error("Rollback point does not include a message id")
  await client.review.revert?.({
    sessionID: input.sessionID,
    messageID,
    partID: input.rollbackPoint?.partID,
  })
  return { accepted: true }
}

export async function compareReviewSessions(input: {
  config: AxCodeAppRuntimeConfig
  sessionID: string
  otherSessionID: string
  deep?: boolean
  client?: ReviewActionClient
}): Promise<AppReviewComparison> {
  if (!input.sessionID || !input.otherSessionID) throw new Error("Two sessions are required for comparison")
  if (input.sessionID === input.otherSessionID) throw new Error("Choose two different sessions to compare")

  if (input.config.mode === "fixture") {
    return {
      session1: { id: input.sessionID, title: input.sessionID, riskScore: 42, decisionScore: 0.62 },
      session2: { id: input.otherSessionID, title: input.otherSessionID, riskScore: 58, decisionScore: 0.54 },
      winner: "A",
      confidence: 0.68,
      recommendation: `Prefer ${input.sessionID}`,
      reasons: ["lower risk", "stronger decision score"],
      differences: ["strategy differs", "risk differs"],
    }
  }

  const client = input.client ?? createLiveReviewActionClient(input.config)
  const compared = await client.review?.compare?.({
    sessionID: input.sessionID,
    otherSessionID: input.otherSessionID,
    deep: input.deep,
  })
  const normalized = normalizeReviewComparison(compared, input.sessionID, input.otherSessionID)
  if (!normalized) throw new Error("Backend returned an invalid session comparison")
  return normalized
}

export async function queueReviewComment(input: {
  config: AxCodeAppRuntimeConfig
  sessionID: string
  text: string
  comparison?: AppReviewComparison
  client?: ReviewActionClient
}): Promise<AppQueueItem> {
  const text = input.text.trim()
  if (!text) throw new Error("Review note is empty")
  const title = `Review note: ${draftTitle(text)}`
  const payload = {
    source: "app.review",
    mode: "comment",
    text,
    ...(input.comparison
      ? {
          compare: {
            session1: input.comparison.session1.id,
            session2: input.comparison.session2.id,
            winner: input.comparison.winner,
          },
        }
      : {}),
  }

  if (input.config.mode === "fixture") {
    localSequence++
    return {
      id: `tsk_fixture_review_comment_${localSequence}`,
      project: "fixture",
      sessionID: input.sessionID,
      title,
      kind: "review",
      status: "queued",
      priority: 0,
      payload,
      createdAt: Date.now(),
    }
  }

  const client = input.client ?? createLiveReviewActionClient(input.config)
  const item = await client.taskQueue?.enqueue?.({
    sessionID: input.sessionID,
    kind: "review",
    title,
    payload,
  })
  const normalized = normalizeLiveQueueItem(item)
  if (!normalized) throw new Error("Backend returned an invalid review queue item")
  return normalized
}

function createLiveWorktreeActionClient(
  config: Extract<AxCodeAppRuntimeConfig, { mode: "live" }>,
): WorktreeActionClient {
  const client = createLiveHeadlessClient(config).client
  return {
    worktree: {
      create: async (input) =>
        (
          await client.worktree.create({
            directory: config.directory,
            worktreeCreateInput: input,
          })
        ).data,
      reset: async (input) =>
        (
          await client.worktree.reset({
            directory: config.directory,
            worktreeResetInput: input,
          })
        ).data,
      remove: async (input) =>
        (
          await client.worktree.remove({
            directory: config.directory,
            worktreeRemoveInput: input,
          })
        ).data,
    },
  }
}

function createLiveToolPaneClient(config: Extract<AxCodeAppRuntimeConfig, { mode: "live" }>): ToolPaneClient {
  const client = createLiveHeadlessClient(config).client
  return {
    pty: {
      create: async (input) =>
        (
          await client.pty.create({
            directory: config.directory,
            command: input.command,
            title: input.title,
            cwd: input.cwd,
          })
        ).data,
      remove: async (id) =>
        (
          await client.pty.remove({
            directory: config.directory,
            ptyID: id,
          })
        ).data,
    },
    file: {
      read: async (path) =>
        (
          await client.file.read({
            directory: config.directory,
            path,
          })
        ).data,
    },
  }
}

function createLiveScheduledTaskActionClient(
  config: Extract<AxCodeAppRuntimeConfig, { mode: "live" }>,
): ScheduledTaskActionClient {
  return {
    scheduledTask: createLiveHeadlessClient(config).scheduledTask,
  }
}

function createLiveReviewActionClient(config: Extract<AxCodeAppRuntimeConfig, { mode: "live" }>): ReviewActionClient {
  const client = createLiveHeadlessClient(config).client
  const headless = createLiveHeadlessClient(config)
  return {
    taskQueue: headless.taskQueue,
    review: {
      revert: async (input) =>
        (
          await client.session.revert({
            directory: config.directory,
            sessionID: input.sessionID,
            messageID: input.messageID,
            partID: input.partID,
          })
        ).data,
      unrevert: async (sessionID) =>
        (
          await client.session.unrevert({
            directory: config.directory,
            sessionID,
          })
        ).data,
      compare: async (input) =>
        (
          await client.session.compare({
            directory: config.directory,
            sessionID: input.sessionID,
            otherSessionID: input.otherSessionID,
            deep: input.deep,
          })
        ).data,
    },
  }
}

async function createMultiRunSession(input: {
  config: AxCodeAppRuntimeConfig
  client?: QueueDraftClient
  worktree: AppWorktree
  text: string
  index: number
  count: number
}) {
  const title = `${draftTitle(input.text)} (${input.index + 1}/${input.count})`
  if (input.config.mode === "fixture") return `ses_fixture_${input.worktree.name}`
  const client =
    input.client ?? createLiveHeadlessClient(runtimeConfigForDirectory(input.config, input.worktree.directory))
  return (await createDraftSession(client, title)).id
}

function runtimeConfigForDirectory(config: Extract<AxCodeAppRuntimeConfig, { mode: "live" }>, directory?: string) {
  return directory ? { ...config, directory } : config
}

async function createDraftSession(client: QueueDraftClient, text: string) {
  if (!client.createSession) throw new Error("Live client does not support session creation")
  return client.createSession({ title: draftTitle(text) })
}

function draftTitle(text: string) {
  return text.length > 120 ? `${text.slice(0, 117)}...` : text
}

function multiRunWorktreeName(prefix: string | undefined, index: number) {
  const base =
    (prefix?.trim() || "multi-run")
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "multi-run"
  return `${base}-${index + 1}`
}

function nextMultiRunID() {
  localSequence++
  return `multirun_${localSequence}`
}

function normalizeReviewComparison(
  value: unknown,
  fallbackSessionID: string,
  fallbackOtherSessionID: string,
): AppReviewComparison | undefined {
  const record = readRecord(value)
  if (!record) return undefined
  const decision = readRecord(record["decision"])
  const advisory = readRecord(record["advisory"])
  const session1 = normalizeReviewComparisonSession(record["session1"], fallbackSessionID)
  const session2 = normalizeReviewComparisonSession(record["session2"], fallbackOtherSessionID)
  if (!session1 || !session2) return undefined
  return {
    session1,
    session2,
    winner: readWinner(decision?.["winner"]) ?? readWinner(advisory?.["winner"]) ?? "tie",
    confidence: readNumber(decision ?? advisory ?? record, "confidence"),
    recommendation: readString(decision ?? {}, "recommendation"),
    reasons: uniqueStrings(readStringArray(decision?.["reasons"]).concat(readStringArray(advisory?.["reasons"]))),
    differences: readStringArray(decision?.["differences"]),
  }
}

function normalizeReviewComparisonSession(value: unknown, fallbackID: string): AppReviewComparisonSession | undefined {
  const record = readRecord(value)
  if (!record) return { id: fallbackID, title: fallbackID }
  const risk = readRecord(record["risk"])
  const decision = readRecord(record["decision"])
  return {
    id: readString(record, "id") ?? fallbackID,
    title: readString(record, "title") ?? fallbackID,
    riskScore: risk ? readNumber(risk, "score") : undefined,
    decisionScore: decision ? readNumber(decision, "total") : undefined,
    headline: readString(record, "headline"),
  }
}

function readWinner(value: unknown): AppReviewComparison["winner"] | undefined {
  return value === "A" || value === "B" || value === "tie" ? value : undefined
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined
}

function readString(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function readNumber(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)]
}

function normalizeDraftModel(model: unknown): DraftRuntimeModel | undefined {
  if (typeof model === "string") return model
  if (!model || typeof model !== "object") return undefined
  const record = model as Record<string, unknown>
  return typeof record.providerID === "string" && typeof record.modelID === "string"
    ? { providerID: record.providerID, modelID: record.modelID }
    : undefined
}

function fixtureQueueCommand(item: AppQueueItem, command: QueueItemCommand, queue: AppQueueItem[] = []): AppQueueItem {
  if (command === "move-up" || command === "move-down") {
    return {
      ...item,
      position: reorderPosition(item, command, queue),
    }
  }

  const status =
    command === "cancel"
      ? "cancelled"
      : command === "pause"
        ? "paused"
        : command === "send-now" || command === "resume" || command === "retry"
          ? "queued"
          : item.status
  return {
    ...item,
    status,
    priority: command === "send-now" ? -1 : item.priority,
  }
}

function reorderPosition(item: AppQueueItem, command: "move-up" | "move-down", queue: AppQueueItem[] = []) {
  const ordered = queue.length > 0 ? [...queue].sort(sortQueueForAction) : [item]
  const index = ordered.findIndex((candidate) => candidate.id === item.id)
  const fallback = item.position ?? Math.max(0, index)
  if (index < 0) return fallback
  const nextIndex = command === "move-up" ? Math.max(0, index - 1) : Math.min(ordered.length - 1, index + 1)
  return ordered[nextIndex]?.position ?? nextIndex
}

function sortQueueForAction(a: AppQueueItem, b: AppQueueItem) {
  if (a.priority !== b.priority) return a.priority - b.priority
  if ((a.position ?? 0) !== (b.position ?? 0)) return (a.position ?? 0) - (b.position ?? 0)
  return a.createdAt - b.createdAt
}

function fixtureScheduledTaskCommand(
  task: AppScheduledTask,
  command: ScheduledTaskCommand,
): { task?: AppScheduledTask; queueItem?: AppQueueItem; removed?: true } {
  if (command === "remove") return { removed: true }
  if (command === "pause") return { task: { ...task, status: "paused" } }
  if (command === "resume") return { task: { ...task, status: "active" } }

  localSequence++
  const queueItem: AppQueueItem = {
    id: `tsk_fixture_automation_${localSequence}`,
    project: task.project,
    title: task.title,
    kind: "automation",
    status: "queued",
    priority: 0,
    agent: task.agent,
    model: task.model,
    sourceTaskID: task.id,
    createdAt: Date.now(),
  }
  return {
    task: { ...task, lastQueueID: queueItem.id, lastRunAt: queueItem.createdAt },
    queueItem,
  }
}

function scheduledNotificationBody(task: AppScheduledTask, queueItem?: AppQueueItem) {
  const parts = [task.title]
  if (queueItem?.title && queueItem.title !== task.title) parts.push(queueItem.title)
  if (queueItem?.sessionID) parts.push(`session ${queueItem.sessionID}`)
  return parts.join(" · ")
}
