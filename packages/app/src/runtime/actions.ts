import type {
  AppQueueItem,
  AppRollbackPoint,
  AppScheduledTask,
  AppSession,
  AppTerminal,
  AppWorktree,
} from "../projection/types"
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

type DraftRuntimePart = {
  type: string
  [key: string]: unknown
}

type CreatedSession = {
  id: string
  title?: string
  project?: string
  worktree?: string
  updatedAt?: number
}

export type ComposerAttachmentKind = "file" | "image" | "directory" | "context"

export type AppComposerAttachment = {
  id: string
  kind: ComposerAttachmentKind
  path: string
  mime: string
  filename?: string
  startLine?: number
  endLine?: number
}

export type QueueDraftClient = {
  createSession?(input?: { title?: string }): Promise<CreatedSession>
  sendPrompt?(
    sessionID: string,
    body: { parts: DraftRuntimePart[]; agent?: string; model?: DraftRuntimeModel },
    options?: { mode?: "sync" | "async" },
  ): Promise<unknown>
  sendCommand?(
    sessionID: string,
    body: { command: string; arguments: string; agent?: string; model?: string; parts?: DraftRuntimePart[] },
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
      worktree?: string
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
    edit?(
      id: string,
      input: {
        title?: string
        worktree?: string | null
        agent?: string | null
        model?: unknown
        payload?: Record<string, unknown>
        priority?: number
      },
    ): Promise<unknown>
    remove?(id: string): Promise<unknown>
  }
  replyPermission?(body: { requestID: string; reply?: "once" | "always" | "reject" }): Promise<unknown>
  replyQuestion?(body: { requestID: string; answers: unknown }): Promise<unknown>
  abort?(sessionID: string): Promise<unknown>
}

export type QueueItemCommand = "send-now" | "pause" | "resume" | "cancel" | "retry" | "remove" | "move-up" | "move-down"
export type WorktreeCommand = "create" | "reset" | "remove"
export type TerminalCommand = "create" | "remove"
export type ScheduledTaskCommand = "run-now" | "pause" | "resume" | "remove"
export type ReviewCommand = "revert" | "unrevert"

export type ScheduledTaskDraftSchedule =
  | { type: "once"; runAt: number }
  | { type: "daily"; time: string; timezone?: string }
  | { type: "weekly"; day: number; time: string; timezone?: string }
  | { type: "cron"; expression: string; timezone?: string }

export type RunDraftResult = {
  accepted: true
  sessionID: string
}

export async function createSessionAction(input: {
  config: AxCodeAppRuntimeConfig
  title?: string
  targetDirectory?: string
  client?: QueueDraftClient
}): Promise<AppSession> {
  const title = normalizeSessionTitle(input.title)

  if (input.config.mode === "fixture") {
    localSequence++
    return {
      id: `ses_fixture_new_${localSequence}`,
      title,
      project: "fixture",
      ...(input.targetDirectory ? { worktree: input.targetDirectory } : {}),
      updatedAt: Date.now(),
    }
  }

  const client =
    input.client ?? createLiveHeadlessClient(runtimeConfigForDirectory(input.config, input.targetDirectory))
  const created = await createDraftSession(client, title)
  return normalizeCreatedSession(created, {
    title,
    config: input.config,
    targetDirectory: input.targetDirectory,
  })
}

export async function chooseAndStartProjectDirectory(
  input: {
    client?: ProjectActionClient
  } = {},
): Promise<ProjectDirectorySelectionResult> {
  const bridge = input.client?.desktopBridge ?? globalThis.window?.axCodeDesktop
  if (!bridge) throw new Error("Desktop bridge is not available for project selection")
  const choice = normalizeDirectoryChoice(
    await bridge.invoke("dialog.chooseDirectory", { title: "Open AX Code project" }),
  )
  if (choice.canceled) return { changed: false, canceled: true }
  await bridge.invoke("backend.start", { directory: choice.path })
  return {
    changed: true,
    directory: choice.path,
    config: normalizeDesktopAppConfig(await bridge.invoke("app.config", {})),
  }
}

export async function attachToBackendUrl(input: {
  baseUrl: string
  authHeader?: string
  client?: ProjectActionClient
}): Promise<BackendAttachResult> {
  const baseUrl = normalizeLoopbackHttpUrl(input.baseUrl)
  if (!baseUrl) throw new Error("Attach backend URL must use http(s) loopback")

  const bridge = input.client?.desktopBridge ?? globalThis.window?.axCodeDesktop
  if (!bridge) throw new Error("Desktop bridge is not available for backend attach")
  const authHeader = input.authHeader?.trim()
  await bridge.invoke("backend.attach", authHeader ? { baseUrl, authHeader } : { baseUrl })
  return {
    changed: true,
    baseUrl,
    config: normalizeDesktopAppConfig(await bridge.invoke("app.config", {})),
  }
}

export async function readDesktopRuntimeConfig(
  input: {
    client?: ProjectActionClient
  } = {},
): Promise<Extract<AxCodeAppRuntimeConfig, { mode: "live" }>> {
  const bridge = input.client?.desktopBridge ?? globalThis.window?.axCodeDesktop
  if (!bridge) throw new Error("Desktop bridge is not available for app config")
  return normalizeDesktopAppConfig(await bridge.invoke("app.config", {}))
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
      schedule: ScheduledTaskDraftSchedule
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
  invoke(name: "external.open", payload: { url: string }): Promise<unknown>
  invoke(name: "path.reveal", payload: { path: string }): Promise<unknown>
  invoke(name: "editor.open", payload: { path: string; line?: number; column?: number }): Promise<unknown>
  invoke(name: "dialog.chooseDirectory", payload: { title?: string }): Promise<unknown>
  invoke(name: "backend.attach", payload: { baseUrl: string; authHeader?: string }): Promise<unknown>
  invoke(name: "backend.start", payload: { directory: string; port?: number }): Promise<unknown>
  invoke(name: "app.config", payload: Record<string, never>): Promise<unknown>
  invoke(
    name: "notification.show",
    payload: { title: string; body?: string; source?: "scheduled-task"; silent?: boolean },
  ): Promise<unknown>
}

export type FileActionClient = {
  desktopBridge?: DesktopBridgeClient
}

export type BrowserActionClient = {
  desktopBridge?: DesktopBridgeClient
}

export type ProjectActionClient = {
  desktopBridge?: DesktopBridgeClient
}

export type ScheduledNotificationClient = {
  desktopBridge?: DesktopBridgeClient
}

export type SettingsActionClient = {
  config?: {
    update?(input: { model?: string }): Promise<unknown>
  }
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

export type ProjectDirectorySelectionResult =
  | {
      changed: false
      canceled: true
    }
  | {
      changed: true
      directory: string
      config: Extract<AxCodeAppRuntimeConfig, { mode: "live" }>
    }

export type BackendAttachResult = {
  changed: true
  baseUrl: string
  config: Extract<AxCodeAppRuntimeConfig, { mode: "live" }>
}

let localSequence = 0

export async function queueDraftTask(input: {
  config: AxCodeAppRuntimeConfig
  mode: QueueDraftMode
  text: string
  sessionID?: string
  targetDirectory?: string
  attachments?: AppComposerAttachment[]
  metadata?: Record<string, unknown>
  agent?: string
  model?: unknown
  sourceMessageID?: string
  sourceTaskID?: string
  client?: QueueDraftClient
}): Promise<AppQueueItem> {
  const text = input.text.trim()
  if (!text) throw new Error("Draft is empty")

  const attachments = input.attachments ?? []
  const body = attachments.length
    ? draftRuntimeBody({
        mode: input.mode,
        text,
        attachments,
        baseDirectory: draftBaseDirectory(input.config, input.targetDirectory),
        agent: input.agent,
        model: input.model,
      })
    : undefined
  const title = draftTitle(text)
  const worktree = queueDraftWorktree(input.targetDirectory, input.metadata)
  const payload = {
    source: "app.composer",
    mode: input.mode,
    text,
    ...(attachments.length ? { attachments } : {}),
    ...(body ? { body } : {}),
    ...(input.metadata ?? {}),
  }

  if (input.config.mode === "live") {
    const client =
      input.client ?? createLiveHeadlessClient(runtimeConfigForDirectory(input.config, input.targetDirectory))
    const item = await client.taskQueue?.enqueue?.({
      sessionID: input.sessionID,
      kind: input.mode,
      title,
      ...(worktree ? { worktree } : {}),
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
    ...(worktree ? { worktree } : {}),
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

export async function queueBrowserVerificationTask(input: {
  config: AxCodeAppRuntimeConfig
  url: string
  sessionID?: string
  targetDirectory?: string
  agent?: string
  model?: unknown
  client?: QueueDraftClient
}): Promise<AppQueueItem> {
  const url = normalizeExternalHttpUrl(input.url)
  if (!url) throw new Error("Browser verification URL must use http or https")
  const text = browserVerificationPrompt(url)
  const worktree = queueDraftWorktree(input.targetDirectory, undefined)
  const payload = {
    source: "app.browser-preview",
    mode: "prompt",
    text,
    browserPreviewUrl: url,
    verification: "playwright-mcp",
  }

  if (input.config.mode === "live") {
    const client =
      input.client ?? createLiveHeadlessClient(runtimeConfigForDirectory(input.config, input.targetDirectory))
    const item = await client.taskQueue?.enqueue?.({
      sessionID: input.sessionID,
      kind: "prompt",
      title: "Verify browser preview",
      ...(worktree ? { worktree } : {}),
      agent: input.agent,
      model: input.model,
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
    ...(worktree ? { worktree } : {}),
    sessionID: input.sessionID,
    title: "Verify browser preview",
    kind: "prompt",
    status: "queued",
    priority: 0,
    agent: input.agent,
    model: input.model,
    payload,
    createdAt: Date.now(),
  }
}

export async function queueMultiRunTask(input: {
  config: AxCodeAppRuntimeConfig
  text: string
  count: number
  worktreeNamePrefix?: string
  attachments?: AppComposerAttachment[]
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
      attachments: input.attachments,
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
  targetDirectory?: string
  attachments?: AppComposerAttachment[]
  agent?: string
  model?: unknown
  client?: QueueDraftClient
}): Promise<RunDraftResult> {
  const text = input.text.trim()
  if (!text) throw new Error("Draft is empty")
  const attachments = input.attachments ?? []

  if (input.config.mode === "fixture") {
    localSequence++
    return {
      accepted: true,
      sessionID: input.sessionID ?? `ses_fixture_run_${localSequence}`,
    }
  }

  const client =
    input.client ?? createLiveHeadlessClient(runtimeConfigForDirectory(input.config, input.targetDirectory))
  const sessionID = input.sessionID ?? (await createDraftSession(client, text)).id
  const baseDirectory = draftBaseDirectory(input.config, input.targetDirectory)
  if (input.mode === "prompt") {
    if (!client.sendPrompt) throw new Error("Live client does not support prompt execution")
    const body = draftRuntimeBody({
      mode: "prompt",
      text,
      attachments,
      baseDirectory,
      agent: input.agent,
      model: input.model,
    })
    await client.sendPrompt(
      sessionID,
      body as { parts: DraftRuntimePart[]; agent?: string; model?: DraftRuntimeModel },
      { mode: "async" },
    )
  } else if (input.mode === "command") {
    if (!client.sendCommand) throw new Error("Live client does not support command execution")
    const body = draftRuntimeBody({
      mode: "command",
      text,
      attachments,
      baseDirectory,
      agent: input.agent,
      model: input.model,
    })
    await client.sendCommand(
      sessionID,
      body as { command: string; arguments: string; agent?: string; model?: string; parts?: DraftRuntimePart[] },
      { mode: "async" },
    )
  } else {
    if (attachments.length > 0) throw new Error("Shell drafts do not support attachments")
    if (!client.sendShell) throw new Error("Live client does not support shell execution")
    const model = normalizeDraftModel(input.model)
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

export function permissionAutoAcceptAllowed(permission: { always?: readonly unknown[] }) {
  return permission.always?.some((pattern) => typeof pattern === "string" && pattern.trim().length > 0) === true
}

export function createComposerAttachmentDraft(input: {
  kind: ComposerAttachmentKind
  path: string
  mime?: string
  filename?: string
  startLine?: number
  endLine?: number
}): AppComposerAttachment {
  const path = input.path.trim()
  if (!path) throw new Error("Attachment path is required")
  const kind = input.kind
  const startLine = normalizeOptionalLine(input.startLine)
  const endLine = normalizeOptionalLine(input.endLine)
  if (kind === "context" && startLine !== undefined && endLine !== undefined && endLine < startLine) {
    throw new Error("Attachment end line must be greater than or equal to the start line")
  }

  localSequence++
  return {
    id: `att_${localSequence}`,
    kind,
    path,
    mime: inferAttachmentMime(kind, path, input.mime),
    filename: input.filename?.trim() || filenameFromAttachmentPath(path),
    ...(startLine !== undefined ? { startLine } : {}),
    ...(endLine !== undefined ? { endLine } : {}),
  }
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
}): Promise<AppQueueItem | { removed: true; id: string }> {
  assertQueueItemCommandAvailable(input.item, input.command)
  if (input.config.mode === "fixture") return fixtureQueueCommand(input.item, input.command, input.queue)

  const client = input.client ?? createLiveHeadlessClient(input.config)
  const api = client.taskQueue
  if (!api) throw new Error("Live client does not support task queue commands")
  if (input.command === "remove") {
    await api.remove?.(input.item.id)
    return { removed: true, id: input.item.id }
  }
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

export function queueItemCommandAvailable(item: AppQueueItem, command: QueueItemCommand): boolean {
  switch (command) {
    case "send-now":
      return item.status === "queued" || item.status === "waiting_for_idle" || item.status === "paused"
    case "pause":
      return item.status === "queued" || item.status === "waiting_for_idle"
    case "resume":
      return item.status === "paused"
    case "cancel":
      return item.status === "queued" || item.status === "waiting_for_idle" || item.status === "paused"
    case "retry":
      return item.status === "failed" || item.status === "cancelled"
    case "remove":
    case "move-up":
    case "move-down":
      return item.status !== "running" && item.status !== "blocked_permission" && item.status !== "blocked_question"
  }
}

function assertQueueItemCommandAvailable(item: AppQueueItem, command: QueueItemCommand) {
  if (queueItemCommandAvailable(item, command)) return
  throw new Error(`Queue command ${command} is not available while item ${item.id} is ${item.status}.`)
}

export async function editQueueItem(input: {
  config: AxCodeAppRuntimeConfig
  item: AppQueueItem
  title: string
  text: string
  client?: QueueDraftClient
}): Promise<AppQueueItem> {
  const title = input.title.trim()
  const text = input.text.trim()
  if (!title) throw new Error("Queue item title is required")
  if (!text) throw new Error("Queue item text is required")

  const next = {
    ...input.item,
    title,
    payload: editedQueuePayload(input.item, text),
  }

  if (input.config.mode === "fixture") return next

  const client = input.client ?? createLiveHeadlessClient(input.config)
  const item = await client.taskQueue?.edit?.(input.item.id, {
    title,
    payload: next.payload,
  })
  const normalized = normalizeLiveQueueItem(item)
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
  sessionID?: string
  sessionTitle?: string
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
        ...(input.sessionID ? { sessionID: input.sessionID } : {}),
        ...(input.sessionTitle ? { sessionTitle: input.sessionTitle } : {}),
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
    return {
      ...normalized,
      ...(input.sessionID ? { sessionID: input.sessionID } : {}),
      ...(input.sessionTitle ? { sessionTitle: input.sessionTitle } : {}),
    }
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

export async function openFileInEditor(input: {
  config: AxCodeAppRuntimeConfig
  path: string
  line?: number
  column?: number
  client?: FileActionClient
}): Promise<{ opened: true; path: string; line?: number; column?: number }> {
  const filePath = input.path.trim()
  if (!filePath) throw new Error("File path is required")
  const line = normalizeEditorPosition("line", input.line)
  const column = normalizeEditorPosition("column", input.column)
  const payload: { path: string; line?: number; column?: number } = { path: filePath }
  if (line !== undefined) payload.line = line
  if (column !== undefined) payload.column = column
  if (input.config.mode === "fixture") return { opened: true, ...payload }

  const bridge = input.client?.desktopBridge ?? globalThis.window?.axCodeDesktop
  if (!bridge) throw new Error("Desktop bridge is not available for file actions")
  await bridge.invoke("editor.open", payload)
  return { opened: true, ...payload }
}

export async function openBrowserPreviewUrl(input: {
  config: AxCodeAppRuntimeConfig
  url: string
  client?: BrowserActionClient
}): Promise<{ opened: true; url: string }> {
  const url = normalizeExternalHttpUrl(input.url)
  if (!url) throw new Error("Browser preview URL must use http or https")
  if (input.config.mode === "fixture") return { opened: true, url }

  const bridge = input.client?.desktopBridge ?? globalThis.window?.axCodeDesktop
  if (!bridge) throw new Error("Desktop bridge is not available for browser actions")
  await bridge.invoke("external.open", { url })
  return { opened: true, url }
}

export async function updateProjectSettings(input: {
  config: AxCodeAppRuntimeConfig
  model?: { providerID: string; modelID: string }
  client?: SettingsActionClient
}): Promise<{ updated: true; reloadRequired: true; model?: string }> {
  const model = input.model ? normalizeSettingsModel(input.model) : undefined
  if (!model) throw new Error("Select at least one setting to apply")

  if (input.config.mode === "fixture") {
    return { updated: true, reloadRequired: true, model }
  }

  const client = input.client ?? createLiveSettingsActionClient(input.config)
  if (!client.config?.update) throw new Error("Live client does not support settings updates")
  await client.config.update({ model })
  return { updated: true, reloadRequired: true, model }
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

function normalizeExternalHttpUrl(value: string) {
  try {
    const url = new URL(value.trim())
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined
  } catch {
    return undefined
  }
}

function normalizeLoopbackHttpUrl(value: string) {
  const normalized = normalizeExternalHttpUrl(value)
  if (!normalized) return undefined
  const url = new URL(normalized)
  if (
    url.hostname !== "127.0.0.1" &&
    url.hostname !== "localhost" &&
    url.hostname !== "::1" &&
    url.hostname !== "[::1]"
  ) {
    return undefined
  }
  return url.toString()
}

function normalizeEditorPosition(label: "line" | "column", value: number | undefined) {
  if (value === undefined || Number.isNaN(value)) return undefined
  if (!Number.isInteger(value) || value <= 0) throw new Error(`Editor ${label} must be a positive integer`)
  return value
}

function normalizeSettingsModel(model: { providerID: string; modelID: string }) {
  const providerID = model.providerID.trim()
  const modelID = model.modelID.trim()
  if (!providerID || !modelID) throw new Error("Settings model must include provider and model")
  return `${providerID}/${modelID}`
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
  time?: string
  schedule?: ScheduledTaskDraftSchedule
  agent?: string
  model?: unknown
  client?: ScheduledTaskActionClient
}): Promise<AppScheduledTask> {
  const title = input.title.trim()
  const prompt = input.prompt.trim()
  const schedule = normalizeScheduledTaskDraftSchedule(input.schedule ?? { type: "daily", time: input.time ?? "" })
  if (!title) throw new Error("Scheduled task title is required")
  if (!prompt) throw new Error("Scheduled task prompt is required")

  if (input.config.mode === "fixture") {
    localSequence++
    return {
      id: `sch_fixture_${localSequence}`,
      project: "fixture",
      title,
      prompt,
      schedule,
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
      schedule,
      agent: input.agent,
      model: input.model,
    }),
  )
  if (!task) throw new Error("Backend returned an invalid scheduled task")
  return task
}

function normalizeScheduledTaskDraftSchedule(schedule: ScheduledTaskDraftSchedule): ScheduledTaskDraftSchedule {
  if (schedule.type === "daily") {
    const time = schedule.time.trim()
    if (!isHHMM(time)) throw new Error("Daily scheduled tasks require HH:MM time")
    return { type: "daily", time, ...(schedule.timezone ? { timezone: schedule.timezone } : {}) }
  }
  if (schedule.type === "weekly") {
    const time = schedule.time.trim()
    if (!isHHMM(time)) throw new Error("Weekly scheduled tasks require HH:MM time")
    if (!Number.isInteger(schedule.day) || schedule.day < 0 || schedule.day > 6)
      throw new Error("Weekly scheduled tasks require day 0-6")
    return { type: "weekly", day: schedule.day, time, ...(schedule.timezone ? { timezone: schedule.timezone } : {}) }
  }
  if (schedule.type === "once") {
    if (!Number.isFinite(schedule.runAt) || schedule.runAt <= 0)
      throw new Error("Once scheduled tasks require a valid run time")
    return { type: "once", runAt: schedule.runAt }
  }
  const expression = schedule.expression.trim()
  if (!expression) throw new Error("Cron scheduled tasks require an expression")
  return { type: "cron", expression, ...(schedule.timezone ? { timezone: schedule.timezone } : {}) }
}

function isHHMM(value: string) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
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

function createLiveSettingsActionClient(
  config: Extract<AxCodeAppRuntimeConfig, { mode: "live" }>,
): SettingsActionClient {
  const client = createLiveHeadlessClient(config).client
  return {
    config: {
      update: async (input) => {
        const options = {
          directory: config.directory,
          config: input,
        } as Parameters<typeof client.config.update>[0]
        return (await client.config.update(options)).data
      },
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

function draftRuntimeBody(input: {
  mode: QueueDraftMode
  text: string
  attachments: AppComposerAttachment[]
  baseDirectory?: string
  agent?: string
  model?: unknown
}): Record<string, unknown> {
  if (input.mode === "shell") {
    if (input.attachments.length > 0) throw new Error("Shell drafts do not support attachments")
    return {
      command: input.text,
      agent: input.agent ?? "build",
      model: normalizeDraftModel(input.model),
    }
  }

  const parts = draftPromptParts(input.text, input.attachments, input.baseDirectory)
  if (input.mode === "command") {
    const model = normalizeDraftModel(input.model)
    return {
      command: input.text,
      arguments: "",
      agent: input.agent,
      model: typeof model === "string" ? model : undefined,
      ...(input.attachments.length > 0 ? { parts: parts.slice(1) } : {}),
    }
  }

  return {
    parts,
    agent: input.agent,
    model: normalizeDraftModel(input.model),
  }
}

function draftPromptParts(
  text: string,
  attachments: AppComposerAttachment[],
  baseDirectory?: string,
): DraftRuntimePart[] {
  return [{ type: "text", text }, ...attachments.map((attachment) => draftFilePart(attachment, baseDirectory))]
}

function draftFilePart(attachment: AppComposerAttachment, baseDirectory?: string): DraftRuntimePart {
  return {
    type: "file",
    url: attachmentUrl(attachment, baseDirectory),
    mime: attachment.mime,
    filename: attachment.filename || filenameFromAttachmentPath(attachment.path),
  }
}

function attachmentUrl(attachment: AppComposerAttachment, baseDirectory?: string) {
  const value = attachment.path.trim()
  const url = hasUrlScheme(value)
    ? new URL(assertAttachmentUrlScheme(value))
    : new URL(pathToFileUrl(resolveAttachmentPath(value, baseDirectory)))
  if (attachment.kind === "context") {
    if (attachment.startLine !== undefined) url.searchParams.set("start", String(attachment.startLine - 1))
    if (attachment.endLine !== undefined) url.searchParams.set("end", String(attachment.endLine - 1))
  }
  return url.toString()
}

function assertAttachmentUrlScheme(value: string) {
  const url = new URL(value)
  if (url.protocol !== "file:" && url.protocol !== "data:") {
    throw new Error("Attachments must use a local file path, file URL, or data URL")
  }
  return value
}

function resolveAttachmentPath(value: string, baseDirectory?: string) {
  const normalized = value.replaceAll("\\", "/")
  if (isAbsolutePath(normalized)) return normalized
  if (!baseDirectory) throw new Error("Relative attachment paths require a project directory")
  return `${baseDirectory.replace(/[\\/]+$/, "")}/${normalized.replace(/^\.\//, "")}`
}

function pathToFileUrl(value: string) {
  const normalized = value.replaceAll("\\", "/")
  const prefix = /^[A-Za-z]:\//.test(normalized) ? "file:///" : "file://"
  const encoded = normalized
    .split("/")
    .map((part, index) => (index === 0 && part === "" ? "" : encodeURIComponent(part)))
    .join("/")
  return `${prefix}${encoded}`
}

function hasUrlScheme(value: string) {
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)
}

function isAbsolutePath(value: string) {
  return value.startsWith("/") || /^[A-Za-z]:\//.test(value)
}

function draftBaseDirectory(config: AxCodeAppRuntimeConfig, targetDirectory?: string) {
  return targetDirectory ?? (config.mode === "live" ? config.directory : "/workspace/ax-code")
}

function runtimeConfigForDirectory(config: Extract<AxCodeAppRuntimeConfig, { mode: "live" }>, directory?: string) {
  return directory ? { ...config, directory } : config
}

async function createDraftSession(client: QueueDraftClient, title: string) {
  if (!client.createSession) throw new Error("Live client does not support session creation")
  return client.createSession({ title: normalizeSessionTitle(title) })
}

function normalizeCreatedSession(
  created: CreatedSession,
  input: {
    title: string
    config: Extract<AxCodeAppRuntimeConfig, { mode: "live" }>
    targetDirectory?: string
  },
): AppSession {
  return {
    id: created.id,
    title: normalizeSessionTitle(created.title ?? input.title),
    project: normalizeSessionProject(created.project, input.config.directory ?? input.targetDirectory),
    ...(created.worktree || input.targetDirectory ? { worktree: created.worktree ?? input.targetDirectory } : {}),
    updatedAt: normalizeTimestamp(created.updatedAt),
  }
}

function normalizeDirectoryChoice(value: unknown): { canceled: true } | { canceled: false; path: string } {
  const record = readRecord(value)
  if (!record || record["canceled"] === true) return { canceled: true }
  const path = readString(record, "path")?.trim()
  if (!path) return { canceled: true }
  return { canceled: false, path }
}

function normalizeDesktopAppConfig(value: unknown): Extract<AxCodeAppRuntimeConfig, { mode: "live" }> {
  const record = readRecord(value)
  if (!record || record["mode"] !== "live") throw new Error("Desktop backend did not return a live app config")
  const baseUrl = readString(record, "baseUrl")
  if (!baseUrl) throw new Error("Desktop backend config is missing baseUrl")

  const headers = normalizeStringRecord(record["headers"])
  const directory = readString(record, "directory")
  const features = normalizeFeatureConfig(record["features"])
  const scheduledTaskExecution = normalizeScheduledTaskExecution(record["scheduledTaskExecution"])
  const sessionLimit = readNumber(record, "sessionLimit")
  return {
    mode: "live",
    baseUrl,
    ...(headers ? { headers } : {}),
    ...(directory ? { directory } : {}),
    ...(features ? { features } : {}),
    ...(sessionLimit ? { sessionLimit } : {}),
    ...(scheduledTaskExecution ? { scheduledTaskExecution } : {}),
  }
}

function normalizeStringRecord(value: unknown) {
  const record = readRecord(value)
  if (!record) return undefined
  const entries = Object.entries(record).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function normalizeFeatureConfig(value: unknown): Extract<AxCodeAppRuntimeConfig, { mode: "live" }>["features"] {
  const record = readRecord(value)
  if (!record) return undefined
  const features: Extract<AxCodeAppRuntimeConfig, { mode: "live" }>["features"] = {}
  if (typeof record["terminalPane"] === "boolean") features.terminalPane = record["terminalPane"]
  if (typeof record["browserPane"] === "boolean") features.browserPane = record["browserPane"]
  if (typeof record["filePane"] === "boolean") features.filePane = record["filePane"]
  return Object.keys(features).length > 0 ? features : undefined
}

function normalizeScheduledTaskExecution(
  value: unknown,
): Extract<AxCodeAppRuntimeConfig, { mode: "live" }>["scheduledTaskExecution"] {
  const record = readRecord(value)
  if (!record) return undefined
  const owner = record["owner"]
  if (owner !== "desktop-sidecar" && owner !== "attached-backend" && owner !== "external") return undefined
  return {
    owner,
    stopsOnAppQuit: record["stopsOnAppQuit"] === true,
  }
}

function normalizeSessionTitle(value: string | undefined) {
  const title = value?.trim()
  return draftTitle(title && title.length > 0 ? title : "New session")
}

function normalizeSessionProject(value: string | undefined, directory: string | undefined) {
  const project = value?.trim()
  if (project) return project
  if (!directory) return "ax-code"
  const normalized = directory.replace(/[\\/]+$/, "").replaceAll("\\", "/")
  const last = normalized.split("/").filter(Boolean).at(-1)
  return last || "ax-code"
}

function normalizeTimestamp(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : Date.now()
}

function draftTitle(text: string) {
  return text.length > 120 ? `${text.slice(0, 117)}...` : text
}

function browserVerificationPrompt(url: string) {
  return [
    `Verify the local frontend preview at ${url}.`,
    "Use the HTML dev browser workflow and Playwright MCP browser_screenshot if it is connected.",
    "Do not open the user's browser unless explicitly asked.",
    "Report visible rendering issues, console failures when available, and the next code fixes.",
  ].join(" ")
}

function queueDraftWorktree(targetDirectory: string | undefined, metadata: Record<string, unknown> | undefined) {
  const worktree = metadata?.["worktree"]
  if (typeof worktree === "string" && worktree.trim().length > 0) return worktree.trim()
  return targetDirectory
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

function normalizeOptionalLine(value: number | undefined) {
  if (value === undefined || Number.isNaN(value)) return undefined
  if (!Number.isInteger(value) || value <= 0) throw new Error("Attachment line numbers must be positive integers")
  return value
}

function inferAttachmentMime(kind: ComposerAttachmentKind, path: string, explicit?: string) {
  const explicitMime = explicit?.trim()
  if (explicitMime) return explicitMime
  if (kind === "directory") return "application/x-directory"
  if (kind === "context" || kind === "file") return "text/plain"

  const extension = filenameFromAttachmentPath(path).toLowerCase().split(".").pop()
  if (extension === "png") return "image/png"
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg"
  if (extension === "gif") return "image/gif"
  if (extension === "webp") return "image/webp"
  if (extension === "svg") return "image/svg+xml"
  if (extension === "pdf") return "application/pdf"
  throw new Error("Image attachments require an image or PDF extension")
}

function filenameFromAttachmentPath(path: string) {
  const withoutFragment = path.split("#")[0]?.split("?")[0] ?? path
  const normalized = withoutFragment.replaceAll("\\", "/").replace(/\/+$/, "")
  const filename = normalized.split("/").filter(Boolean).pop()
  return filename ? decodeURIComponentSafe(filename) : "attachment"
}

function decodeURIComponentSafe(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
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

function fixtureQueueCommand(
  item: AppQueueItem,
  command: QueueItemCommand,
  queue: AppQueueItem[] = [],
): AppQueueItem | { removed: true; id: string } {
  if (command === "remove") return { removed: true, id: item.id }
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

function editedQueuePayload(item: AppQueueItem, text: string): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...(item.payload ?? {}), text }
  const body = payload["body"]
  if (!body || typeof body !== "object") return payload

  const mode = typeof payload["mode"] === "string" ? payload["mode"] : item.kind
  const bodyRecord = { ...(body as Record<string, unknown>) }
  if (mode === "command" || mode === "shell") {
    bodyRecord["command"] = text
    return { ...payload, body: bodyRecord }
  }

  const parts = Array.isArray(bodyRecord["parts"]) ? bodyRecord["parts"] : []
  const nextParts = [...parts]
  const textIndex = nextParts.findIndex((part) => {
    return Boolean(part && typeof part === "object" && (part as Record<string, unknown>)["type"] === "text")
  })
  if (textIndex >= 0) {
    const part = nextParts[textIndex] as Record<string, unknown>
    nextParts[textIndex] = { ...part, text }
  } else {
    nextParts.unshift({ type: "text", text })
  }
  bodyRecord["parts"] = nextParts
  return { ...payload, body: bodyRecord }
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
