import { createEffect, createMemo, createResource, createSignal, For, onCleanup, Show } from "solid-js"
import type {
  AppCommandCenterState,
  AppBranchRankEvidence,
  AppModelOption,
  AppQueueItem,
  AppRollbackPoint,
  AppScheduledTask,
  AppSession,
  AppSessionEvidence,
  AppTerminal,
  AppWorktree,
} from "./projection/types"
import { createFixtureCommandCenterState } from "./projection/replay"
import { createCommandCenterViewModel } from "./projection/view-model"
import { ComposerAttachments } from "./ComposerAttachments"
import { DiagnosticsPanel } from "./DiagnosticsPanel"
import { AxCodeStatusDialog } from "./AxCodeStatusDialog"
import { SessionStatusRow } from "./SessionStatusRow"
import { computeAssistantStatus } from "./runtime/assistant-status"
import {
  abortSessionTask,
  attachToBackendUrl,
  chooseAndStartProjectDirectory,
  compareReviewSessions,
  createSessionAction,
  createScheduledTask,
  notifyScheduledTaskQueued,
  openBrowserPreviewUrl,
  openFileInEditor,
  permissionAutoAcceptAllowed,
  queueReviewComment,
  queueBrowserVerificationTask,
  queueMultiRunTask,
  queueDraftTask,
  readFilePreview,
  readDesktopRuntimeConfig,
  revealFilePath,
  replyPermissionRequest,
  replyQuestionRequest,
  queueItemCommandAvailable,
  runDraftTask,
  runQueueItemCommand,
  runReviewCommand,
  runScheduledTaskCommand,
  runTerminalCommand,
  runWorktreeCommand,
  updateProjectSettings,
  editQueueItem,
  type FilePreviewResult,
  type AppReviewComparison,
  type AppComposerAttachment,
  type QueueDraftMode,
  type QueueItemCommand,
  type ReviewCommand,
  type ScheduledTaskDraftSchedule,
  type ScheduledTaskCommand,
} from "./runtime/actions"
import {
  getRuntimeConfig,
  isAppFeatureEnabled,
  runtimeNetworkScope,
  storeRuntimeConfigForReload,
} from "./runtime/config"
import { readStoredComposerDraft, writeStoredComposerDraft } from "./runtime/composer-draft"
import {
  createAppDiagnosticsReport,
  downloadDesktopUpdateArtifact,
  exportDesktopLogs,
  openDownloadedDesktopUpdateArtifact,
  readDesktopDiagnostics,
  type AppDesktopDiagnostics,
  type AppEventStreamDiagnostics,
} from "./runtime/diagnostics"
import { buildAxCodeStatusReport } from "./runtime/status-report"
import {
  bootstrapLiveCommandCenterState,
  createLiveHeadlessClient,
  followLiveCommandCenterEventsWithReconnect,
  loadLiveSessionEvidence,
  loadLiveSessionMessages,
  refreshLiveRuntimeCatalog,
  type LiveSessionMessages,
} from "./runtime/live"

const DEFAULT_BROWSER_PREVIEW_URL = "http://127.0.0.1:3000"

type QuestionAnswerDraft = {
  selected: string[]
  custom: string
}

type AppQuestionRequest = ReturnType<typeof createCommandCenterViewModel>["questions"][number]
type ToolPane = "terminal" | "browser" | "file"
type BrowserPreviewTab = {
  id: string
  title: string
  url: string
  sessionID?: string
  sessionTitle?: string
  directory?: string
  createdAt: number
}

export function App() {
  const runtimeConfig = getRuntimeConfig()
  const fixtureState = createFixtureCommandCenterState()
  const storedComposerDraft = readStoredComposerDraft()
  const initialBrowserPreview: BrowserPreviewTab = {
    id: "browser_preview_default",
    title: "Local preview",
    url: DEFAULT_BROWSER_PREVIEW_URL,
    ...(runtimeConfig.mode === "live" && runtimeConfig.directory ? { directory: runtimeConfig.directory } : {}),
    createdAt: Date.now(),
  }
  let browserPreviewSequence = 0
  let draftInput: HTMLInputElement | undefined
  const toolPanePolicy = createMemo(() => ({
    terminal: isAppFeatureEnabled(runtimeConfig, "terminalPane"),
    browser: isAppFeatureEnabled(runtimeConfig, "browserPane"),
    file: isAppFeatureEnabled(runtimeConfig, "filePane"),
  }))
  const hasToolPanes = createMemo(() => Object.values(toolPanePolicy()).some(Boolean))
  const [composerMode, setComposerMode] = createSignal<QueueDraftMode>(storedComposerDraft?.mode ?? "prompt")
  const [draft, setDraft] = createSignal(storedComposerDraft?.text ?? "Queue a supervised follow-up...")
  const [composerAttachments, setComposerAttachments] = createSignal<AppComposerAttachment[]>(
    storedComposerDraft?.attachments ?? [],
  )
  const [selectedAgent, setSelectedAgent] = createSignal(storedComposerDraft?.agent ?? "")
  const [selectedModelKey, setSelectedModelKey] = createSignal(storedComposerDraft?.modelKey ?? "")
  const [settingsModelKey, setSettingsModelKey] = createSignal("")
  const [selectedWorktreeDirectory, setSelectedWorktreeDirectory] = createSignal(
    storedComposerDraft?.worktreeDirectory ?? "",
  )
  const [worktreeName, setWorktreeName] = createSignal("")
  const [multiRunCount, setMultiRunCount] = createSignal(2)
  const [multiRunPrefix, setMultiRunPrefix] = createSignal("parallel")
  const [automationTitle, setAutomationTitle] = createSignal("Daily branch review")
  const [automationPrompt, setAutomationPrompt] = createSignal(
    "Review the current branch and queue verification follow-ups.",
  )
  const [automationScheduleType, setAutomationScheduleType] = createSignal<ScheduledTaskDraftSchedule["type"]>("daily")
  const [automationTime, setAutomationTime] = createSignal("09:00")
  const [automationDay, setAutomationDay] = createSignal(1)
  const [automationRunAt, setAutomationRunAt] = createSignal(defaultDatetimeLocal())
  const [automationCron, setAutomationCron] = createSignal("0 9 * * 1-5")
  const [toolPane, setToolPane] = createSignal<ToolPane>(defaultToolPane(runtimeConfig))
  const [terminalCommand, setTerminalCommand] = createSignal("zsh")
  const [browserPreviews, setBrowserPreviews] = createSignal<BrowserPreviewTab[]>([initialBrowserPreview])
  const [selectedBrowserPreviewID, setSelectedBrowserPreviewID] = createSignal(initialBrowserPreview.id)
  const [browserUrl, setBrowserUrl] = createSignal(initialBrowserPreview.url)
  const [browserRefreshKey, setBrowserRefreshKey] = createSignal(0)
  const [attachBaseUrl, setAttachBaseUrl] = createSignal(
    runtimeConfig.mode === "live" ? runtimeConfig.baseUrl : "http://127.0.0.1:4096",
  )
  const [attachAuthHeader, setAttachAuthHeader] = createSignal("")
  const [filePath, setFilePath] = createSignal("packages/app/src/App.tsx")
  const [filePreview, setFilePreview] = createSignal<FilePreviewResult | undefined>()
  const [compareSessionID, setCompareSessionID] = createSignal("")
  const [reviewNote, setReviewNote] = createSignal("")
  const [reviewComparison, setReviewComparison] = createSignal<AppReviewComparison | undefined>()
  const [localSessions, setLocalSessions] = createSignal<AppSession[]>([])
  const [localQueue, setLocalQueue] = createSignal<AppQueueItem[]>([])
  const [localWorktrees, setLocalWorktrees] = createSignal(commandCenterWorktrees(fixtureState))
  const [localTerminals, setLocalTerminals] = createSignal(commandCenterTerminals(fixtureState))
  const [localScheduledTasks, setLocalScheduledTasks] = createSignal(commandCenterScheduledTasks(fixtureState))
  const [removedWorktreeDirs, setRemovedWorktreeDirs] = createSignal<string[]>([])
  const [removedTerminalIDs, setRemovedTerminalIDs] = createSignal<string[]>([])
  const [removedScheduledTaskIDs, setRemovedScheduledTaskIDs] = createSignal<string[]>([])
  const [queueBusy, setQueueBusy] = createSignal(false)
  const [runBusy, setRunBusy] = createSignal(false)
  const [worktreeBusy, setWorktreeBusy] = createSignal<string | undefined>()
  const [multiRunBusy, setMultiRunBusy] = createSignal(false)
  const [terminalBusy, setTerminalBusy] = createSignal<string | undefined>()
  const [browserBusy, setBrowserBusy] = createSignal(false)
  const [browserVerifyBusy, setBrowserVerifyBusy] = createSignal(false)
  const [projectBusy, setProjectBusy] = createSignal(false)
  const [scheduledTaskBusy, setScheduledTaskBusy] = createSignal<string | undefined>()
  const [reviewBusy, setReviewBusy] = createSignal<string | undefined>()
  const [sessionBusy, setSessionBusy] = createSignal(false)
  const [fileBusy, setFileBusy] = createSignal(false)
  const [fileActionBusy, setFileActionBusy] = createSignal(false)
  const [queueError, setQueueError] = createSignal<string | undefined>()
  const [worktreeError, setWorktreeError] = createSignal<string | undefined>()
  const [terminalError, setTerminalError] = createSignal<string | undefined>()
  const [browserError, setBrowserError] = createSignal<string | undefined>()
  const [projectError, setProjectError] = createSignal<string | undefined>()
  const [scheduledTaskError, setScheduledTaskError] = createSignal<string | undefined>()
  const [reviewError, setReviewError] = createSignal<string | undefined>()
  const [sessionError, setSessionError] = createSignal<string | undefined>()
  const [fileError, setFileError] = createSignal<string | undefined>()
  const [diagnosticsError, setDiagnosticsError] = createSignal<string | undefined>()
  const [settingsError, setSettingsError] = createSignal<string | undefined>()
  const [settingsStatus, setSettingsStatus] = createSignal<string | undefined>()
  const [settingsBusy, setSettingsBusy] = createSignal(false)
  const [probeError, setProbeError] = createSignal<string | undefined>()
  const [probeStatus, setProbeStatus] = createSignal<string | undefined>()
  const [probeBusy, setProbeBusy] = createSignal(false)
  const [diagnosticsBusy, setDiagnosticsBusy] = createSignal(false)
  const [diagnosticsLogText, setDiagnosticsLogText] = createSignal("")
  const [desktopDiagnostics, setDesktopDiagnostics] = createSignal<AppDesktopDiagnostics | undefined>()
  const [statusDialogOpen, setStatusDialogOpen] = createSignal(false)
  const [statusReportText, setStatusReportText] = createSignal("")
  const [statusReportBusy, setStatusReportBusy] = createSignal(false)
  const [eventStreamStatus, setEventStreamStatus] = createSignal<AppEventStreamDiagnostics["status"]>(
    runtimeConfig.mode === "live" ? "connecting" : "fixture",
  )
  const [eventStreamAppliedCount, setEventStreamAppliedCount] = createSignal(0)
  const [lastEventAt, setLastEventAt] = createSignal<number | undefined>()
  const [eventStreamError, setEventStreamError] = createSignal<string | undefined>()
  const [approvalBusy, setApprovalBusy] = createSignal<string | undefined>()
  const [approvalError, setApprovalError] = createSignal<string | undefined>()
  const [autoAcceptSessions, setAutoAcceptSessions] = createSignal<Record<string, boolean>>({})
  const [autoAcceptedPermissions, setAutoAcceptedPermissions] = createSignal<Record<string, boolean>>({})
  const [questionAnswers, setQuestionAnswers] = createSignal<Record<string, Record<number, QuestionAnswerDraft>>>({})
  const [queueActionBusy, setQueueActionBusy] = createSignal<string | undefined>()
  const [editingQueueID, setEditingQueueID] = createSignal<string | undefined>()
  const [editingQueueTitle, setEditingQueueTitle] = createSignal("")
  const [editingQueueText, setEditingQueueText] = createSignal("")
  const [abortBusy, setAbortBusy] = createSignal(false)
  const [eventVersion, setEventVersion] = createSignal(0)
  const [selectedSessionID, setSelectedSessionID] = createSignal<string | undefined>()
  const [evidenceCache, setEvidenceCache] = createSignal<Record<string, AppSessionEvidence>>({})
  const [sessionMessageCache, setSessionMessageCache] = createSignal<Record<string, LiveSessionMessages>>({})
  const [notifiedScheduledQueueIDs, setNotifiedScheduledQueueIDs] = createSignal<string[]>([])
  const [liveState, { refetch: refetchLiveState }] = createResource(
    () => (runtimeConfig.mode === "live" ? runtimeConfig : undefined),
    (config) => bootstrapLiveCommandCenterState(config).catch(() => fixtureState),
  )
  const commandCenterState = createMemo(() => {
    eventVersion()
    const base = liveState() ?? fixtureState
    const sessions = mergeSessions(base.projection.session, localSessions())
    const cachedMessages = sessionMessageCache()
    return {
      ...base,
      projection: {
        ...base.projection,
        message: {
          ...cachedSessionMessages(cachedMessages),
          ...base.projection.message,
        },
        part: {
          ...cachedSessionParts(cachedMessages),
          ...base.projection.part,
        },
        session: sessions,
      },
      selectedSessionID: selectedSessionID() ?? base.selectedSessionID,
      queue: mergeQueue(base.queue, localQueue()),
      worktrees: mergeWorktrees(
        commandCenterWorktrees(base).filter((item) => !removedWorktreeDirs().includes(item.directory)),
        localWorktrees(),
      ),
      terminals: mergeTerminals(
        commandCenterTerminals(base).filter((item) => !removedTerminalIDs().includes(item.id)),
        localTerminals(),
      ).filter(() => toolPanePolicy().terminal),
      scheduledTasks: mergeScheduledTasks(
        commandCenterScheduledTasks(base).filter((item) => !removedScheduledTaskIDs().includes(item.id)),
        localScheduledTasks(),
      ),
      evidence: {
        ...base.evidence,
        ...evidenceCache(),
      },
    }
  })
  const view = createMemo(() => createCommandCenterViewModel(commandCenterState()))
  const selectedBrowserPreview = createMemo(() =>
    browserPreviews().find((preview) => preview.id === selectedBrowserPreviewID()),
  )
  const diagnosticsReport = createMemo(() =>
    createAppDiagnosticsReport({
      config: runtimeConfig,
      view: view(),
      desktop: desktopDiagnostics(),
      eventStream: {
        status: eventStreamStatus(),
        appliedEvents: eventStreamAppliedCount(),
        lastEventAt: lastEventAt(),
        error: eventStreamError(),
      },
    }),
  )
  const selectedModel = createMemo(() => modelFromKey(selectedModelKey(), view().catalog.models))
  const settingsModel = createMemo(() => modelFromKey(settingsModelKey(), view().catalog.models))
  const assistantStatus = createMemo(() => {
    const v = view()
    const sessionId = v.selectedSession?.id
    const lastAssistantMessage = [...(v.messages ?? [])].reverse().find((m) => m.role === "assistant")
    const lastAssistantParts = lastAssistantMessage ? lastAssistantMessage.parts : []
    return computeAssistantStatus({
      status: v.status,
      lastAssistantParts,
      sessionId,
      pendingPermissions: v.permissions,
      pendingQuestions: v.questions,
      abortBusy: abortBusy(),
    })
  })
  const composerAttachmentsUnsupported = createMemo(
    () => composerMode() === "shell" && composerAttachments().length > 0,
  )

  createEffect(() => {
    const sessionID = selectedAutoAcceptSessionID()
    if (!sessionID || !autoAcceptSessions()[sessionID] || approvalBusy()) return
    const permission = view().permissions.find(
      (item) => permissionAutoAcceptAllowed(item) && !autoAcceptedPermissions()[item.id],
    )
    if (!permission) return
    setAutoAcceptedPermissions((state) => ({ ...state, [permission.id]: true }))
    void replyPermission(permission.id, "always")
  })
  const composerCanSubmit = createMemo(() => draft().trim().length > 0 && !composerAttachmentsUnsupported())
  const runtimeSummary = createMemo(() =>
    runtimeConfig.mode === "live"
      ? {
          title: "Live backend",
          detail: runtimeConfig.directory ?? runtimeConfig.baseUrl,
        }
      : {
          title: "Fixture runtime",
          detail: "Local deterministic state",
        },
  )
  const eventStreamBanner = createMemo(() =>
    createEventStreamBanner({
      mode: runtimeConfig.mode,
      status: eventStreamStatus(),
      appliedEvents: eventStreamAppliedCount(),
      lastEventAt: lastEventAt(),
      error: eventStreamError(),
    }),
  )
  const networkModeBanner = createMemo(() => createNetworkModeBanner(runtimeConfig))
  const requestedEvidence = new Set<string>()
  const requestedSessionMessages = new Set<string>()

  createEffect(() => {
    writeStoredComposerDraft({
      text: draft(),
      mode: composerMode(),
      attachments: composerAttachments(),
      agent: selectedAgent(),
      modelKey: selectedModelKey(),
      worktreeDirectory: selectedWorktreeDirectory(),
    })
  })

  createEffect(() => {
    const unsubscribe = globalThis.window?.axCodeDesktop?.onMenuCommand?.((command) => {
      if (command === "session.new") void createSession()
      if (command === "composer.focus") focusComposer()
      if (command === "composer.run") void runDraft()
      if (command === "composer.queue") void queueDraft()
      if (command === "diagnostics.refresh") void refreshDiagnostics()
      if (command === "diagnostics.status") void showStatusReport()
    })
    onCleanup(() => unsubscribe?.())
  })

  createEffect(() => {
    if (runtimeConfig.mode === "live") return
    if (!globalThis.window?.axCodeDesktop) return
    let canceled = false
    void readDesktopRuntimeConfig()
      .then((config) => {
        if (canceled) return
        storeRuntimeConfigForReload(config)
        globalThis.window.location.reload()
      })
      .catch(() => undefined)
    onCleanup(() => {
      canceled = true
    })
  })

  createEffect(() => {
    const policy = toolPanePolicy()
    const selected = toolPane()
    if (
      (selected === "terminal" && policy.terminal) ||
      (selected === "browser" && policy.browser) ||
      (selected === "file" && policy.file)
    ) {
      return
    }
    setToolPane(defaultToolPaneFromPolicy(policy))
  })

  async function openProjectDirectory() {
    if (projectBusy()) return
    setProjectBusy(true)
    setProjectError(undefined)
    try {
      const result = await chooseAndStartProjectDirectory()
      if (!result.changed) return
      storeRuntimeConfigForReload(result.config)
      globalThis.window.location.reload()
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : String(error))
    } finally {
      setProjectBusy(false)
    }
  }

  async function attachExistingBackend() {
    if (projectBusy()) return
    setProjectBusy(true)
    setProjectError(undefined)
    try {
      const result = await attachToBackendUrl({
        baseUrl: attachBaseUrl(),
        authHeader: attachAuthHeader(),
      })
      storeRuntimeConfigForReload(result.config)
      globalThis.window.location.reload()
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : String(error))
    } finally {
      setProjectBusy(false)
    }
  }

  createEffect(() => {
    if (runtimeConfig.mode !== "live") return
    const state = liveState()
    if (!state) return

    const controller = new AbortController()
    setEventStreamStatus("connecting")
    setEventStreamError(undefined)
    void followLiveCommandCenterEventsWithReconnect(state, () => createLiveHeadlessClient(runtimeConfig), {
      signal: controller.signal,
      probeClient: createLiveHeadlessClient(runtimeConfig),
      directory: runtimeConfig.directory,
      onStatus: (status, metadata) => {
        if (controller.signal.aborted) return
        setEventStreamStatus(status)
        if (status === "connecting") setEventStreamError(undefined)
        if (status === "error") {
          const error = metadata?.error
          const message = error instanceof Error ? error.message : String(error ?? "Event stream disconnected")
          setEventStreamError(message)
          setQueueError(message)
        }
      },
      onEvent: (_event, applied) => {
        setEventStreamStatus("connected")
        setLastEventAt(Date.now())
        if (applied) setEventVersion((version) => version + 1)
        if (applied) setEventStreamAppliedCount((count) => count + 1)
      },
      onBootstrapReload: () => {
        setEventStreamStatus("connecting")
        void Promise.resolve(refetchLiveState?.())
          .then(() => setEventVersion((version) => version + 1))
          .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error)
            setEventStreamStatus("error")
            setEventStreamError(message)
          })
      },
      onProbeRefresh: (_catalog, keys) => {
        setProbeError(undefined)
        setProbeStatus(`Runtime probes refreshed: ${keys.join(", ")}`)
        setEventVersion((version) => version + 1)
      },
      onProbeRefreshError: (error) => {
        setProbeError(error instanceof Error ? error.message : String(error))
      },
    }).catch((error) => {
      if (!controller.signal.aborted) {
        const message = error instanceof Error ? error.message : String(error)
        setEventStreamStatus("error")
        setEventStreamError(message)
        setQueueError(message)
      }
    })
    onCleanup(() => controller.abort())
  })

  createEffect(() => {
    if (runtimeConfig.mode !== "live") return
    const sessionID = view().selectedSession?.id
    if (!sessionID) return
    const existing = commandCenterState().evidence[sessionID]
    if (existing && existing.status !== "loading") return
    if (requestedEvidence.has(sessionID)) return

    requestedEvidence.add(sessionID)
    setEvidenceCache((cache) => ({ ...cache, [sessionID]: loadingSessionEvidence(sessionID) }))
    const client = createLiveHeadlessClient(runtimeConfig)
    void loadLiveSessionEvidence(client, sessionID).then((evidence) => {
      setEvidenceCache((cache) => ({ ...cache, [sessionID]: evidence }))
    })
  })

  createEffect(() => {
    if (runtimeConfig.mode !== "live") return
    const sessionID = view().selectedSession?.id
    if (!sessionID) return
    if ((commandCenterState().projection.message[sessionID]?.length ?? 0) > 0) return
    if (sessionMessageCache()[sessionID]) return
    if (requestedSessionMessages.has(sessionID)) return

    requestedSessionMessages.add(sessionID)
    const client = createLiveHeadlessClient(runtimeConfig)
    void loadLiveSessionMessages(client, sessionID, runtimeConfig.directory).then((messages) => {
      if (messages.messages.length === 0 && Object.keys(messages.parts).length === 0) return
      setSessionMessageCache((cache) => ({ ...cache, [sessionID]: messages }))
    })
  })

  createEffect(() => {
    if (runtimeConfig.mode !== "live") return
    if (!globalThis.window?.axCodeDesktop) return
    const viewState = view()
    const seen = notifiedScheduledQueueIDs()
    const pending = viewState.scheduledTasks.filter((task) => task.lastQueueID && !seen.includes(task.lastQueueID))
    if (pending.length === 0) return

    const pendingIDs = pending.map((task) => task.lastQueueID!).filter(Boolean)
    setNotifiedScheduledQueueIDs((items) => [...new Set([...items, ...pendingIDs])])
    for (const task of pending) {
      const queueItem = task.lastQueueID ? viewState.queue.find((item) => item.id === task.lastQueueID) : undefined
      void notifyScheduledTaskQueued({ config: runtimeConfig, task, queueItem }).catch(() => undefined)
    }
  })

  async function createSession() {
    if (sessionBusy()) return
    setSessionBusy(true)
    setSessionError(undefined)
    setQueueError(undefined)
    try {
      const session = await createSessionAction({
        config: runtimeConfig,
        title: draft(),
        targetDirectory: selectedWorktreeDirectory() || undefined,
      })
      setLocalSessions((items) => mergeSessions(items, [session]))
      setSelectedSessionID(session.id)
      if (runtimeConfig.mode === "live") void refetchLiveState?.()
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : String(error))
    } finally {
      setSessionBusy(false)
    }
  }

  function focusComposer() {
    draftInput?.focus()
  }

  async function queueDraft() {
    if (queueBusy()) return
    setQueueBusy(true)
    setQueueError(undefined)
    try {
      const item = await queueDraftTask({
        config: runtimeConfig,
        mode: composerMode(),
        text: draft(),
        sessionID: view().selectedSession?.id,
        targetDirectory: selectedWorktreeDirectory() || undefined,
        attachments: composerAttachments(),
        agent: selectedAgent() || undefined,
        model: selectedModel(),
      })
      setLocalQueue((items) => mergeQueue(items, [item]))
      setDraft("")
      setComposerAttachments([])
    } catch (error) {
      setQueueError(error instanceof Error ? error.message : String(error))
    } finally {
      setQueueBusy(false)
    }
  }

  async function runDraft() {
    if (runBusy()) return
    setRunBusy(true)
    setQueueError(undefined)
    try {
      const result = await runDraftTask({
        config: runtimeConfig,
        mode: composerMode(),
        text: draft(),
        sessionID: view().selectedSession?.id,
        targetDirectory: selectedWorktreeDirectory() || undefined,
        attachments: composerAttachments(),
        agent: selectedAgent() || undefined,
        model: selectedModel(),
      })
      setSelectedSessionID(result.sessionID)
      setDraft("")
      setComposerAttachments([])
    } catch (error) {
      setQueueError(error instanceof Error ? error.message : String(error))
    } finally {
      setRunBusy(false)
    }
  }

  async function replyPermission(requestID: string, reply: "once" | "always" | "reject") {
    if (approvalBusy()) return
    setApprovalBusy(requestID)
    setApprovalError(undefined)
    try {
      await replyPermissionRequest({ config: runtimeConfig, requestID, reply })
    } catch (error) {
      setApprovalError(error instanceof Error ? error.message : String(error))
    } finally {
      setApprovalBusy(undefined)
    }
  }

  function selectedAutoAcceptSessionID() {
    return commandCenterState().selectedSessionID
  }

  function selectedSessionAutoAcceptAllowed() {
    return view().permissions.some(permissionAutoAcceptAllowed)
  }

  function selectedSessionAutoAcceptEnabled() {
    const sessionID = selectedAutoAcceptSessionID()
    return sessionID ? autoAcceptSessions()[sessionID] === true : false
  }

  function toggleSelectedSessionAutoAccept(enabled: boolean) {
    const sessionID = selectedAutoAcceptSessionID()
    if (!sessionID) return
    if (enabled && !selectedSessionAutoAcceptAllowed()) return
    setAutoAcceptSessions((state) => ({ ...state, [sessionID]: enabled }))
  }

  async function answerQuestion(requestID: string, answers: string[][]) {
    if (approvalBusy()) return
    setApprovalBusy(requestID)
    setApprovalError(undefined)
    try {
      await replyQuestionRequest({ config: runtimeConfig, requestID, answers })
      setQuestionAnswers((state) => omitRecordKey(state, requestID))
    } catch (error) {
      setApprovalError(error instanceof Error ? error.message : String(error))
    } finally {
      setApprovalBusy(undefined)
    }
  }

  function updateQuestionOption(requestID: string, index: number, label: string, multiple: boolean, checked: boolean) {
    setQuestionAnswers((state) => {
      const request = state[requestID] ?? {}
      const current = request[index] ?? { selected: [], custom: "" }
      const selected = multiple
        ? checked
          ? [...new Set([...current.selected, label])]
          : current.selected.filter((item) => item !== label)
        : checked
          ? [label]
          : []
      return {
        ...state,
        [requestID]: {
          ...request,
          [index]: {
            ...current,
            selected,
          },
        },
      }
    })
  }

  function updateQuestionCustom(requestID: string, index: number, custom: string) {
    setQuestionAnswers((state) => {
      const request = state[requestID] ?? {}
      const current = request[index] ?? { selected: [], custom: "" }
      return {
        ...state,
        [requestID]: {
          ...request,
          [index]: {
            ...current,
            custom,
          },
        },
      }
    })
  }

  function questionAnswerDraft(requestID: string, index: number): QuestionAnswerDraft {
    return questionAnswers()[requestID]?.[index] ?? { selected: [], custom: "" }
  }

  function buildQuestionAnswers(question: AppQuestionRequest): string[][] {
    return question.questions.map((item, index) =>
      normalizeQuestionAnswerDraft(questionAnswerDraft(question.id, index), item.custom !== false),
    )
  }

  function canSubmitQuestionAnswer(question: AppQuestionRequest) {
    if (question.questions.length === 0) return false
    return buildQuestionAnswers(question).every((answer) => answer.length > 0)
  }

  async function runQueueAction(item: AppQueueItem, command: QueueItemCommand, queue = view().queue) {
    if (queueActionBusy()) return
    setQueueActionBusy(item.id)
    setQueueError(undefined)
    try {
      const result = await runQueueItemCommand({ config: runtimeConfig, item, command, queue })
      if ("removed" in result) {
        setLocalQueue((items) => items.filter((existing) => existing.id !== result.id))
      } else {
        setLocalQueue((items) => mergeQueue(items, [result]))
      }
    } catch (error) {
      setQueueError(error instanceof Error ? error.message : String(error))
    } finally {
      setQueueActionBusy(undefined)
    }
  }

  function startQueueEdit(item: AppQueueItem) {
    setEditingQueueID(item.id)
    setEditingQueueTitle(item.title)
    setEditingQueueText(queueItemDraftText(item))
    setQueueError(undefined)
  }

  function cancelQueueEdit() {
    setEditingQueueID(undefined)
    setEditingQueueTitle("")
    setEditingQueueText("")
  }

  async function saveQueueEdit(item: AppQueueItem) {
    if (queueActionBusy()) return
    setQueueActionBusy(item.id)
    setQueueError(undefined)
    try {
      const result = await editQueueItem({
        config: runtimeConfig,
        item,
        title: editingQueueTitle(),
        text: editingQueueText(),
      })
      setLocalQueue((items) => mergeQueue(items, [result]))
      cancelQueueEdit()
    } catch (error) {
      setQueueError(error instanceof Error ? error.message : String(error))
    } finally {
      setQueueActionBusy(undefined)
    }
  }

  async function abortSelectedSession() {
    const sessionID = view().selectedSession?.id
    if (!sessionID || abortBusy()) return
    setAbortBusy(true)
    setQueueError(undefined)
    try {
      await abortSessionTask({ config: runtimeConfig, sessionID })
    } catch (error) {
      setQueueError(error instanceof Error ? error.message : String(error))
    } finally {
      setAbortBusy(false)
    }
  }

  async function createWorktree() {
    if (worktreeBusy()) return
    setWorktreeBusy("create")
    setWorktreeError(undefined)
    try {
      const result = await runWorktreeCommand({
        config: runtimeConfig,
        command: "create",
        name: worktreeName(),
      })
      if ("directory" in result && "name" in result) {
        setLocalWorktrees((items) => mergeWorktrees(items, [result]))
        setRemovedWorktreeDirs((items) => items.filter((directory) => directory !== result.directory))
      }
      setWorktreeName("")
    } catch (error) {
      setWorktreeError(error instanceof Error ? error.message : String(error))
    } finally {
      setWorktreeBusy(undefined)
    }
  }

  async function fanOutMultiRun() {
    if (multiRunBusy()) return
    setMultiRunBusy(true)
    setWorktreeError(undefined)
    setQueueError(undefined)
    try {
      const result = await queueMultiRunTask({
        config: runtimeConfig,
        text: draft(),
        count: multiRunCount(),
        worktreeNamePrefix: multiRunPrefix(),
        attachments: composerAttachments(),
        agent: selectedAgent() || undefined,
        model: selectedModel(),
      })
      setLocalWorktrees((items) => mergeWorktrees(items, result.worktrees))
      setLocalQueue((items) => mergeQueue(items, result.queue))
      setRemovedWorktreeDirs((items) =>
        items.filter((directory) => !result.worktrees.some((worktree) => worktree.directory === directory)),
      )
      setDraft("")
      setComposerAttachments([])
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setWorktreeError(message)
      setQueueError(message)
    } finally {
      setMultiRunBusy(false)
    }
  }

  async function resetWorktree(directory: string) {
    if (worktreeBusy()) return
    setWorktreeBusy(directory)
    setWorktreeError(undefined)
    try {
      await runWorktreeCommand({ config: runtimeConfig, command: "reset", directory })
    } catch (error) {
      setWorktreeError(error instanceof Error ? error.message : String(error))
    } finally {
      setWorktreeBusy(undefined)
    }
  }

  async function removeWorktree(directory: string) {
    if (worktreeBusy()) return
    setWorktreeBusy(directory)
    setWorktreeError(undefined)
    try {
      await runWorktreeCommand({ config: runtimeConfig, command: "remove", directory })
      setRemovedWorktreeDirs((items) => [...items, directory])
      setLocalWorktrees((items) => items.filter((item) => item.directory !== directory))
    } catch (error) {
      setWorktreeError(error instanceof Error ? error.message : String(error))
    } finally {
      setWorktreeBusy(undefined)
    }
  }

  async function createTerminal() {
    if (!toolPanePolicy().terminal) {
      setTerminalError("Terminal pane is disabled by runtime policy")
      return
    }
    if (terminalBusy()) return
    setTerminalBusy("create")
    setTerminalError(undefined)
    try {
      const session = view().selectedSession
      const result = await runTerminalCommand({
        config: runtimeConfig,
        command: "create",
        shellCommand: terminalCommand(),
        cwd: selectedWorktreeDirectory() || (runtimeConfig.mode === "live" ? runtimeConfig.directory : undefined),
        sessionID: session?.id,
        sessionTitle: session?.title,
      })
      if ("id" in result && "title" in result) {
        setLocalTerminals((items) => mergeTerminals(items, [result]))
        setRemovedTerminalIDs((items) => items.filter((id) => id !== result.id))
      }
    } catch (error) {
      setTerminalError(error instanceof Error ? error.message : String(error))
    } finally {
      setTerminalBusy(undefined)
    }
  }

  async function removeTerminal(id: string) {
    if (!toolPanePolicy().terminal) {
      setTerminalError("Terminal pane is disabled by runtime policy")
      return
    }
    if (terminalBusy()) return
    setTerminalBusy(id)
    setTerminalError(undefined)
    try {
      await runTerminalCommand({ config: runtimeConfig, command: "remove", terminalID: id })
      setRemovedTerminalIDs((items) => [...items, id])
      setLocalTerminals((items) => items.filter((terminal) => terminal.id !== id))
    } catch (error) {
      setTerminalError(error instanceof Error ? error.message : String(error))
    } finally {
      setTerminalBusy(undefined)
    }
  }

  async function runScheduledAction(task: AppScheduledTask, command: ScheduledTaskCommand) {
    if (scheduledTaskBusy()) return
    setScheduledTaskBusy(task.id)
    setScheduledTaskError(undefined)
    try {
      const result = await runScheduledTaskCommand({ config: runtimeConfig, task, command })
      if (result.task) setLocalScheduledTasks((items) => mergeScheduledTasks(items, [result.task!]))
      if (result.queueItem) setLocalQueue((items) => mergeQueue(items, [result.queueItem!]))
      if (result.removed) {
        setRemovedScheduledTaskIDs((items) => [...items, task.id])
        setLocalScheduledTasks((items) => items.filter((item) => item.id !== task.id))
      }
    } catch (error) {
      setScheduledTaskError(error instanceof Error ? error.message : String(error))
    } finally {
      setScheduledTaskBusy(undefined)
    }
  }

  async function createAutomation() {
    if (scheduledTaskBusy()) return
    setScheduledTaskBusy("create")
    setScheduledTaskError(undefined)
    try {
      const task = await createScheduledTask({
        config: runtimeConfig,
        title: automationTitle(),
        prompt: automationPrompt(),
        schedule: automationScheduleDraft({
          type: automationScheduleType(),
          time: automationTime(),
          day: automationDay(),
          runAt: automationRunAt(),
          cron: automationCron(),
        }),
        agent: selectedAgent() || undefined,
        model: selectedModel(),
      })
      setLocalScheduledTasks((items) => mergeScheduledTasks(items, [task]))
    } catch (error) {
      setScheduledTaskError(error instanceof Error ? error.message : String(error))
    } finally {
      setScheduledTaskBusy(undefined)
    }
  }

  async function runReviewAction(command: ReviewCommand, rollbackPoint?: AppRollbackPoint) {
    const sessionID = view().selectedSession?.id
    if (!sessionID || reviewBusy()) return
    setReviewBusy(command === "revert" ? `rollback-${rollbackPoint?.step ?? "unknown"}` : command)
    setReviewError(undefined)
    try {
      await runReviewCommand({ config: runtimeConfig, command, sessionID, rollbackPoint })
      setEvidenceCache((cache) => {
        const current = cache[sessionID] ?? commandCenterState().evidence[sessionID]
        if (!current) return cache
        return {
          ...cache,
          [sessionID]: {
            ...current,
            status: "loading",
          },
        }
      })
      requestedEvidence.delete(sessionID)
      setEventVersion((version) => version + 1)
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : String(error))
    } finally {
      setReviewBusy(undefined)
    }
  }

  async function compareSelectedSession() {
    const sessionID = view().selectedSession?.id
    const otherSessionID = compareSessionID()
    if (!sessionID || !otherSessionID || reviewBusy()) return
    setReviewBusy("compare")
    setReviewError(undefined)
    try {
      setReviewComparison(
        await compareReviewSessions({
          config: runtimeConfig,
          sessionID,
          otherSessionID,
          deep: true,
        }),
      )
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : String(error))
    } finally {
      setReviewBusy(undefined)
    }
  }

  async function queueReviewNote() {
    const sessionID = view().selectedSession?.id
    if (!sessionID || reviewBusy()) return
    setReviewBusy("comment")
    setReviewError(undefined)
    try {
      const item = await queueReviewComment({
        config: runtimeConfig,
        sessionID,
        text: reviewNote(),
        comparison: reviewComparison(),
      })
      setLocalQueue((items) => mergeQueue(items, [item]))
      setReviewNote("")
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : String(error))
    } finally {
      setReviewBusy(undefined)
    }
  }

  async function previewFile() {
    if (fileBusy()) return
    setFileBusy(true)
    setFileError(undefined)
    try {
      setFilePreview(await readFilePreview({ config: runtimeConfig, path: filePath() }))
    } catch (error) {
      setFileError(error instanceof Error ? error.message : String(error))
    } finally {
      setFileBusy(false)
    }
  }

  async function revealCurrentFile() {
    if (fileActionBusy()) return
    setFileActionBusy(true)
    setFileError(undefined)
    try {
      await revealFilePath({ config: runtimeConfig, path: filePreview()?.path ?? filePath() })
    } catch (error) {
      setFileError(error instanceof Error ? error.message : String(error))
    } finally {
      setFileActionBusy(false)
    }
  }

  async function openCurrentFileInEditor() {
    if (fileActionBusy()) return
    setFileActionBusy(true)
    setFileError(undefined)
    try {
      await openFileInEditor({ config: runtimeConfig, path: filePreview()?.path ?? filePath() })
    } catch (error) {
      setFileError(error instanceof Error ? error.message : String(error))
    } finally {
      setFileActionBusy(false)
    }
  }

  async function openCurrentBrowserPreview() {
    if (!toolPanePolicy().browser) {
      setBrowserError("Browser pane is disabled by runtime policy")
      return
    }
    if (browserBusy()) return
    setBrowserBusy(true)
    setBrowserError(undefined)
    try {
      await openBrowserPreviewUrl({ config: runtimeConfig, url: selectedBrowserPreview()?.url ?? browserUrl() })
    } catch (error) {
      setBrowserError(error instanceof Error ? error.message : String(error))
    } finally {
      setBrowserBusy(false)
    }
  }

  function openBrowserPreviewTab() {
    if (!toolPanePolicy().browser) {
      setBrowserError("Browser pane is disabled by runtime policy")
      return
    }
    const url = normalizeBrowserPreviewUrl(browserUrl())
    if (!url) {
      setBrowserError("Browser preview URL must use http or https")
      return
    }
    const session = view().selectedSession
    const preview: BrowserPreviewTab = {
      id: `browser_preview_${++browserPreviewSequence}`,
      title: browserPreviewTitle(url),
      url,
      ...(session ? { sessionID: session.id, sessionTitle: session.title } : {}),
      ...(selectedWorktreeDirectory() || (runtimeConfig.mode === "live" && runtimeConfig.directory)
        ? { directory: selectedWorktreeDirectory() || (runtimeConfig.mode === "live" ? runtimeConfig.directory : "") }
        : {}),
      createdAt: Date.now(),
    }
    setBrowserPreviews((items) => [preview, ...items])
    setSelectedBrowserPreviewID(preview.id)
    setBrowserUrl(url)
    setBrowserRefreshKey((value) => value + 1)
    setBrowserError(undefined)
  }

  function selectBrowserPreview(preview: BrowserPreviewTab) {
    setSelectedBrowserPreviewID(preview.id)
    setBrowserUrl(preview.url)
    setBrowserError(undefined)
  }

  function closeBrowserPreview(id: string) {
    setBrowserPreviews((items) => {
      const next = items.filter((preview) => preview.id !== id)
      if (selectedBrowserPreviewID() === id) {
        const replacement = next[0]
        setSelectedBrowserPreviewID(replacement?.id ?? "")
        setBrowserUrl(replacement?.url ?? DEFAULT_BROWSER_PREVIEW_URL)
      }
      return next
    })
  }

  async function queueBrowserVerification() {
    if (browserVerifyBusy()) return
    setBrowserVerifyBusy(true)
    setBrowserError(undefined)
    try {
      const item = await queueBrowserVerificationTask({
        config: runtimeConfig,
        url: selectedBrowserPreview()?.url ?? browserUrl(),
        sessionID: view().selectedSession?.id,
        targetDirectory: selectedWorktreeDirectory() || undefined,
        agent: selectedAgent() || undefined,
        model: selectedModel(),
      })
      setLocalQueue((items) => mergeQueue(items, [item]))
    } catch (error) {
      setBrowserError(error instanceof Error ? error.message : String(error))
    } finally {
      setBrowserVerifyBusy(false)
    }
  }

  async function refreshDiagnostics() {
    if (diagnosticsBusy()) return
    setDiagnosticsBusy(true)
    setDiagnosticsError(undefined)
    try {
      setDesktopDiagnostics(await readDesktopDiagnostics())
    } catch (error) {
      setDiagnosticsError(error instanceof Error ? error.message : String(error))
    } finally {
      setDiagnosticsBusy(false)
    }
  }

  async function showStatusReport() {
    if (statusReportBusy()) return
    setStatusReportBusy(true)
    setStatusReportText("")
    setStatusDialogOpen(true)
    try {
      const text = await buildAxCodeStatusReport({
        config: runtimeConfig,
        eventStream: {
          status: eventStreamStatus(),
          appliedEvents: eventStreamAppliedCount(),
          lastEventAt: lastEventAt(),
          error: eventStreamError(),
        },
        desktop: desktopDiagnostics(),
      })
      setStatusReportText(text)
    } catch (error) {
      setStatusReportText(`Error generating report: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setStatusReportBusy(false)
    }
  }

  async function exportLogs() {
    if (diagnosticsBusy()) return
    setDiagnosticsBusy(true)
    setDiagnosticsError(undefined)
    try {
      const result = await exportDesktopLogs()
      if (!result.available) throw new Error("Desktop diagnostics bridge is unavailable")
      setDiagnosticsLogText(result.text || "No desktop logs recorded")
    } catch (error) {
      setDiagnosticsError(error instanceof Error ? error.message : String(error))
    } finally {
      setDiagnosticsBusy(false)
    }
  }

  async function downloadUpdate() {
    if (diagnosticsBusy()) return
    setDiagnosticsBusy(true)
    setDiagnosticsError(undefined)
    try {
      const result = await downloadDesktopUpdateArtifact()
      if (!result.available) throw new Error(result.reason ?? "Desktop update bridge is unavailable")
      setDesktopDiagnostics((current) => ({
        ...(current ?? { available: true, errors: [] }),
        capabilities: current?.capabilities ? { ...current.capabilities, update: result } : { update: result },
      }))
      if (result.status === "error") throw new Error(result.reason ?? "Desktop update download failed")
      if (result.status !== "downloaded") setDiagnosticsError(result.reason ?? `Update download ${result.status}`)
    } catch (error) {
      setDiagnosticsError(error instanceof Error ? error.message : String(error))
    } finally {
      setDiagnosticsBusy(false)
    }
  }

  async function revealDownloadedUpdate() {
    if (diagnosticsBusy()) return
    const artifactPath = diagnosticsReport().desktop.capabilities?.update?.artifactPath
    if (!artifactPath) return
    setDiagnosticsBusy(true)
    setDiagnosticsError(undefined)
    try {
      await revealFilePath({ config: runtimeConfig, path: artifactPath })
    } catch (error) {
      setDiagnosticsError(error instanceof Error ? error.message : String(error))
    } finally {
      setDiagnosticsBusy(false)
    }
  }

  async function applyProjectModelSetting() {
    if (settingsBusy()) return
    const model = settingsModel()
    setSettingsBusy(true)
    setSettingsError(undefined)
    setSettingsStatus(undefined)
    try {
      const result = await updateProjectSettings({ config: runtimeConfig, model })
      setSelectedModelKey("")
      setSettingsStatus(
        result.model
          ? `Project default model saved: ${result.model}. Backend reload completed.`
          : "Project settings saved.",
      )
      await refreshDiagnostics()
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : String(error))
    } finally {
      setSettingsBusy(false)
    }
  }

  async function refreshRuntimeProbes() {
    if (probeBusy()) return
    setProbeBusy(true)
    setProbeError(undefined)
    setProbeStatus(undefined)
    try {
      if (runtimeConfig.mode !== "live") {
        setProbeStatus("Fixture runtime probes are already loaded.")
        return
      }
      const state = liveState()
      if (!state) {
        setProbeStatus("Live backend is still starting.")
        return
      }
      state.catalog = await refreshLiveRuntimeCatalog(state.catalog, createLiveHeadlessClient(runtimeConfig), {
        directory: runtimeConfig.directory,
        keys: ["mcp", "lsp", "debug-engine"],
      })
      setProbeStatus("Runtime probes refreshed.")
      setEventVersion((version) => version + 1)
    } catch (error) {
      setProbeError(error instanceof Error ? error.message : String(error))
    } finally {
      setProbeBusy(false)
    }
  }

  async function openDownloadedUpdate() {
    if (diagnosticsBusy()) return
    const artifactPath = diagnosticsReport().desktop.capabilities?.update?.artifactPath
    if (!artifactPath) return
    setDiagnosticsBusy(true)
    setDiagnosticsError(undefined)
    try {
      const result = await openDownloadedDesktopUpdateArtifact(artifactPath)
      setDesktopDiagnostics((current) => ({
        ...(current ?? { available: true, errors: [] }),
        capabilities: current?.capabilities ? { ...current.capabilities, update: result } : { update: result },
      }))
      if (result.status !== "opened") throw new Error(result.reason ?? `Update open ${result.status}`)
    } catch (error) {
      setDiagnosticsError(error instanceof Error ? error.message : String(error))
    } finally {
      setDiagnosticsBusy(false)
    }
  }

  return (
    <>
    <main class="app-shell" data-testid="ax-code-app">
      <a class="skip-link" href="#work-surface">
        Skip to work surface
      </a>
      <aside class="project-rail" aria-label="Projects and sessions">
        <a class="brand-block" href="#work-surface" aria-label="ax-code">
          <div class="brand-mark">AX</div>
          <div>
            <h1>AX Code</h1>
            <p>Command center</p>
          </div>
        </a>

        <section class="rail-section">
          <h2>Project</h2>
          <button
            class="project-button"
            disabled={!globalThis.window?.axCodeDesktop || projectBusy()}
            onClick={openProjectDirectory}
            title="Open project"
            type="button"
          >
            <span>{projectButtonLabel(runtimeConfig)}</span>
            <strong>{projectBusy() ? "..." : view().queueSummary.total}</strong>
          </button>
          <form
            class="backend-attach-form"
            aria-label="Attach existing backend"
            onSubmit={(event) => {
              event.preventDefault()
              void attachExistingBackend()
            }}
          >
            <label>
              <span>Attach backend</span>
              <input
                aria-label="Attach backend URL"
                inputmode="url"
                onInput={(event) => setAttachBaseUrl(event.currentTarget.value)}
                placeholder="http://127.0.0.1:4096"
                value={attachBaseUrl()}
              />
            </label>
            <label>
              <span>Authorization header</span>
              <input
                aria-label="Attach backend authorization header"
                autocomplete="off"
                onInput={(event) => setAttachAuthHeader(event.currentTarget.value)}
                placeholder="Bearer ..."
                type="password"
                value={attachAuthHeader()}
              />
            </label>
            <button disabled={!globalThis.window?.axCodeDesktop || projectBusy()} type="submit">
              Attach
            </button>
          </form>
          <Show when={projectError()}>{(message) => <p class="rail-error">{message()}</p>}</Show>
        </section>

        <section class="rail-section">
          <div class="rail-heading">
            <h2>Sessions</h2>
            <button aria-label="Create session" disabled={sessionBusy()} onClick={createSession} type="button">
              {sessionBusy() ? "Creating" : "New session"}
            </button>
          </div>
          <Show when={sessionError()}>{(message) => <p class="rail-error">{message()}</p>}</Show>
          <For each={view().sessions}>
            {(session) => (
              <button
                class="session-button"
                classList={{ active: session.id === view().selectedSession?.id }}
                aria-current={session.id === view().selectedSession?.id ? "page" : undefined}
                onClick={() => setSelectedSessionID(session.id)}
                type="button"
              >
                <span>{session.title}</span>
                <small>{session.worktree ?? "primary"}</small>
              </button>
            )}
          </For>
        </section>
      </aside>

      <section class="work-surface" id="work-surface" aria-label="Task queue and selected session">
        <div class="sr-only" role="status" aria-live="polite">
          {queueError() ??
            projectError() ??
            sessionError() ??
            approvalError() ??
            worktreeError() ??
            scheduledTaskError() ??
            reviewError() ??
            fileError() ??
            ""}
        </div>
        <header class="surface-header">
          <div>
            <p class="eyebrow">Branch {view().branch}</p>
            <h2>{view().selectedSession?.title ?? "No session selected"}</h2>
          </div>
          <div class="status-strip" aria-label="Queue summary">
            <span>
              <strong>{view().queueSummary.running}</strong> running
            </span>
            <span>
              <strong>{view().queueSummary.blocked}</strong> blocked
            </span>
            <span>
              <strong>{view().queueSummary.queued}</strong> queued
            </span>
            <button disabled={!view().selectedSession || abortBusy()} onClick={abortSelectedSession} type="button">
              Abort
            </button>
          </div>
        </header>

        <section
          class="reconnect-banner"
          data-status={eventStreamBanner().status}
          role="status"
          aria-live="polite"
          aria-label="Event stream status"
        >
          <div>
            <strong>{eventStreamBanner().title}</strong>
            <p>{eventStreamBanner().detail}</p>
          </div>
          <span>{eventStreamBanner().badge}</span>
        </section>

        <Show when={networkModeBanner()}>
          {(banner) => (
            <section
              class="network-mode-banner"
              data-scope={banner().scope}
              role="status"
              aria-live="polite"
              aria-label="Backend network mode"
            >
              <div>
                <strong>{banner().title}</strong>
                <p>{banner().detail}</p>
              </div>
              <span>{banner().badge}</span>
            </section>
          )}
        </Show>

        <section class="queue-panel" aria-label="Task queue">
          <div class="panel-heading">
            <h3>Task queue</h3>
            <span>
              {view().queueSummary.total} items
              {view().queueHiddenCount > 0 ? ` · showing ${view().queue.length}` : ""}
            </span>
          </div>
          <div class="queue-list">
            <For each={view().queue}>
              {(item, index) => (
                <article class="queue-item" data-status={item.status}>
                  <div>
                    <strong>{item.title}</strong>
                    <p>
                      {item.kind}
                      {item.agent ? ` · ${item.agent}` : ""} · {queueTargetLabel(item, view().worktrees)}
                    </p>
                    <Show when={item.error}>{(message) => <p class="queue-error">{message()}</p>}</Show>
                    <Show when={editingQueueID() === item.id}>
                      <div class="queue-edit-form">
                        <input
                          aria-label={`Edit queue title for ${item.title}`}
                          onInput={(event) => setEditingQueueTitle(event.currentTarget.value)}
                          value={editingQueueTitle()}
                        />
                        <textarea
                          aria-label={`Edit queue text for ${item.title}`}
                          onInput={(event) => setEditingQueueText(event.currentTarget.value)}
                          value={editingQueueText()}
                        />
                        <div>
                          <button
                            disabled={
                              queueActionBusy() === item.id || !editingQueueTitle().trim() || !editingQueueText().trim()
                            }
                            onClick={() => saveQueueEdit(item)}
                            type="button"
                          >
                            Save edit
                          </button>
                          <button disabled={queueActionBusy() === item.id} onClick={cancelQueueEdit} type="button">
                            Cancel edit
                          </button>
                        </div>
                      </div>
                    </Show>
                  </div>
                  <div class="queue-controls">
                    <span class="queue-status">{item.status.replaceAll("_", " ")}</span>
                    <button
                      disabled={
                        queueActionBusy() === item.id || index() === 0 || !queueItemCommandAvailable(item, "move-up")
                      }
                      onClick={() => runQueueAction(item, "move-up", view().queue)}
                      type="button"
                    >
                      Up
                    </button>
                    <button
                      disabled={
                        queueActionBusy() === item.id ||
                        index() === view().queue.length - 1 ||
                        !queueItemCommandAvailable(item, "move-down")
                      }
                      onClick={() => runQueueAction(item, "move-down", view().queue)}
                      type="button"
                    >
                      Down
                    </button>
                    <button
                      disabled={queueActionBusy() === item.id || !queueItemCommandAvailable(item, "send-now")}
                      onClick={() => runQueueAction(item, "send-now")}
                      type="button"
                    >
                      Send now
                    </button>
                    <Show
                      when={item.status === "paused"}
                      fallback={
                        <button
                          disabled={queueActionBusy() === item.id || !queueItemCommandAvailable(item, "pause")}
                          onClick={() => runQueueAction(item, "pause")}
                          type="button"
                        >
                          Pause
                        </button>
                      }
                    >
                      <button
                        disabled={queueActionBusy() === item.id || !queueItemCommandAvailable(item, "resume")}
                        onClick={() => runQueueAction(item, "resume")}
                        type="button"
                      >
                        Resume
                      </button>
                    </Show>
                    <button
                      disabled={queueActionBusy() === item.id || !queueItemCommandAvailable(item, "cancel")}
                      onClick={() => runQueueAction(item, "cancel")}
                      type="button"
                    >
                      Cancel
                    </button>
                    <Show when={item.status === "failed" || item.status === "cancelled"}>
                      <button
                        disabled={queueActionBusy() === item.id || !queueItemCommandAvailable(item, "retry")}
                        onClick={() => runQueueAction(item, "retry")}
                        type="button"
                      >
                        Retry
                      </button>
                    </Show>
                    <button
                      disabled={queueActionBusy() === item.id || !isQueueItemEditable(item)}
                      onClick={() => startQueueEdit(item)}
                      type="button"
                    >
                      Edit
                    </button>
                    <button
                      disabled={queueActionBusy() === item.id || !isQueueItemRemovable(item)}
                      onClick={() => runQueueAction(item, "remove")}
                      type="button"
                    >
                      Remove
                    </button>
                  </div>
                </article>
              )}
            </For>
          </div>
        </section>

        <section class="thread-panel" aria-label="Selected session thread">
          <Show when={view().messageHiddenCount > 0}>
            <p class="thread-window-note">{view().messageHiddenCount} older messages collapsed for performance</p>
          </Show>
          <For each={view().messages}>
            {(message) => (
              <article class="thread-message" data-role={message.role}>
                <div class="message-role">{message.role}</div>
                <p>{message.text}</p>
              </article>
            )}
          </For>
          <SessionStatusRow
            snapshot={assistantStatus()}
            onAbort={abortSelectedSession}
            abortDisabled={!view().selectedSession || abortBusy()}
          />
        </section>

        <section class="tool-pane" aria-label="Terminal, browser, and file preview">
          <Show when={hasToolPanes()}>
            <div class="mode-tabs" role="tablist" aria-label="Tool pane">
              <Show when={toolPanePolicy().terminal}>
                <button
                  id="tool-tab-terminal"
                  role="tab"
                  aria-selected={toolPane() === "terminal"}
                  aria-controls="tool-panel-terminal"
                  classList={{ active: toolPane() === "terminal" }}
                  onClick={() => setToolPane("terminal")}
                  type="button"
                >
                  Terminal
                </button>
              </Show>
              <Show when={toolPanePolicy().browser}>
                <button
                  id="tool-tab-browser"
                  role="tab"
                  aria-selected={toolPane() === "browser"}
                  aria-controls="tool-panel-browser"
                  classList={{ active: toolPane() === "browser" }}
                  onClick={() => setToolPane("browser")}
                  type="button"
                >
                  Browser
                </button>
              </Show>
              <Show when={toolPanePolicy().file}>
                <button
                  id="tool-tab-file"
                  role="tab"
                  aria-selected={toolPane() === "file"}
                  aria-controls="tool-panel-file"
                  classList={{ active: toolPane() === "file" }}
                  onClick={() => setToolPane("file")}
                  type="button"
                >
                  File
                </button>
              </Show>
            </div>
          </Show>

          <Show when={!hasToolPanes()}>
            <div class="tool-pane-body unavailable-panel">Tool panes disabled by runtime policy</div>
          </Show>

          <Show when={toolPanePolicy().terminal}>
            <div
              class="tool-pane-body"
              id="tool-panel-terminal"
              role="tabpanel"
              aria-labelledby="tool-tab-terminal"
              hidden={toolPane() !== "terminal"}
            >
              <div class="tool-command-row">
                <input
                  aria-label="Terminal command"
                  onInput={(event) => setTerminalCommand(event.currentTarget.value)}
                  value={terminalCommand()}
                />
                <button disabled={terminalBusy() === "create"} onClick={createTerminal} type="button">
                  New terminal
                </button>
              </div>
              <Show when={terminalError()}>{(message) => <p class="composer-error">{message()}</p>}</Show>
              <For each={view().terminals}>
                {(terminal) => (
                  <div class="terminal-row" data-status={terminal.status}>
                    <div>
                      <strong>{terminal.title}</strong>
                      <small>
                        {terminal.command} · {terminalScopeLabel(terminal)}
                      </small>
                    </div>
                    <div class="tool-row-actions">
                      <span>{terminal.status}</span>
                      <button
                        disabled={terminalBusy() === terminal.id}
                        onClick={() => removeTerminal(terminal.id)}
                        type="button"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>

          <Show when={toolPanePolicy().browser}>
            <div
              class="tool-pane-body"
              id="tool-panel-browser"
              role="tabpanel"
              aria-labelledby="tool-tab-browser"
              hidden={toolPane() !== "browser"}
            >
              <div class="tool-command-row">
                <input
                  aria-label="Browser preview URL"
                  onInput={(event) => setBrowserUrl(event.currentTarget.value)}
                  value={browserUrl()}
                />
                <button onClick={openBrowserPreviewTab} type="button">
                  Open preview
                </button>
                <button onClick={() => setBrowserRefreshKey((value) => value + 1)} type="button">
                  Refresh
                </button>
                <button disabled={browserVerifyBusy()} onClick={queueBrowserVerification} type="button">
                  {browserVerifyBusy() ? "Queuing" : "Verify"}
                </button>
                <button disabled={browserBusy()} onClick={openCurrentBrowserPreview} type="button">
                  Open external
                </button>
              </div>
              <Show when={browserError()}>{(message) => <p class="composer-error">{message()}</p>}</Show>
              <div class="browser-preview-list" aria-label="Browser previews">
                <For each={browserPreviews()}>
                  {(preview) => (
                    <div class="browser-preview-row" classList={{ active: preview.id === selectedBrowserPreviewID() }}>
                      <button
                        aria-current={preview.id === selectedBrowserPreviewID() ? "page" : undefined}
                        onClick={() => selectBrowserPreview(preview)}
                        type="button"
                      >
                        <span>{preview.title}</span>
                        <small>{preview.sessionTitle ?? preview.directory ?? "project preview"}</small>
                      </button>
                      <button
                        aria-label={`Close browser preview ${preview.title}`}
                        onClick={() => closeBrowserPreview(preview.id)}
                        type="button"
                      >
                        Close
                      </button>
                    </div>
                  )}
                </For>
                <Show when={browserPreviews().length === 0}>
                  <p class="muted">No browser previews open.</p>
                </Show>
              </div>
              <iframe
                class="browser-frame"
                sandbox="allow-forms allow-same-origin allow-scripts"
                src={
                  toolPane() === "browser" && selectedBrowserPreview()
                    ? browserPreviewSrc(selectedBrowserPreview()!.url, browserRefreshKey())
                    : "about:blank"
                }
                title="Browser preview"
              />
            </div>
          </Show>

          <Show when={toolPanePolicy().file}>
            <div
              class="tool-pane-body"
              id="tool-panel-file"
              role="tabpanel"
              aria-labelledby="tool-tab-file"
              hidden={toolPane() !== "file"}
            >
              <div class="tool-command-row file-command-row">
                <input
                  aria-label="File path"
                  onInput={(event) => setFilePath(event.currentTarget.value)}
                  value={filePath()}
                />
                <button disabled={fileBusy()} onClick={previewFile} type="button">
                  Preview
                </button>
                <button disabled={fileActionBusy()} onClick={revealCurrentFile} type="button">
                  Reveal path
                </button>
                <button disabled={fileActionBusy()} onClick={openCurrentFileInEditor} type="button">
                  Open editor
                </button>
              </div>
              <Show when={fileError()}>{(message) => <p class="composer-error">{message()}</p>}</Show>
              <Show when={filePreview()} fallback={<p class="muted">No file loaded</p>}>
                {(preview) => (
                  <pre class="file-preview" data-type={preview().type}>
                    {preview().type === "binary"
                      ? `Binary file · ${preview().mimeType ?? "unknown"}`
                      : preview().content}
                  </pre>
                )}
              </Show>
            </div>
          </Show>
        </section>

        <footer class="composer-bar" aria-label="Composer">
          <div class="mode-tabs" role="group" aria-label="Composer mode">
            <button
              aria-pressed={composerMode() === "prompt"}
              classList={{ active: composerMode() === "prompt" }}
              onClick={() => setComposerMode("prompt")}
              type="button"
            >
              Prompt
            </button>
            <button
              aria-pressed={composerMode() === "command"}
              classList={{ active: composerMode() === "command" }}
              onClick={() => setComposerMode("command")}
              type="button"
            >
              Command
            </button>
            <button
              aria-pressed={composerMode() === "shell"}
              classList={{ active: composerMode() === "shell" }}
              onClick={() => setComposerMode("shell")}
              type="button"
            >
              Shell
            </button>
          </div>
          <div class="composer-input-stack">
            <div class="composer-selectors">
              <select
                aria-label="Agent"
                onChange={(event) => setSelectedAgent(event.currentTarget.value)}
                value={selectedAgent()}
              >
                <option value="">Default agent</option>
                <For each={view().catalog.agents}>{(agent) => <option value={agent.id}>{agent.label}</option>}</For>
              </select>
              <select
                aria-label="Model"
                onChange={(event) => setSelectedModelKey(event.currentTarget.value)}
                value={selectedModelKey()}
              >
                <option value="">Default model</option>
                <For each={view().catalog.models}>
                  {(model) => <option value={modelKey(model)}>{model.label}</option>}
                </For>
              </select>
              <select
                aria-label="Queue target worktree"
                onChange={(event) => setSelectedWorktreeDirectory(event.currentTarget.value)}
                value={selectedWorktreeDirectory()}
              >
                <option value="">Primary workspace</option>
                <For each={view().worktrees.filter((worktree) => worktree.name !== "primary")}>
                  {(worktree) => <option value={worktree.directory}>{worktree.name}</option>}
                </For>
              </select>
            </div>
            <input
              aria-label="Draft prompt"
              onInput={(event) => setDraft(event.currentTarget.value)}
              ref={(element) => {
                draftInput = element
              }}
              value={draft()}
            />
            <ComposerAttachments
              attachments={composerAttachments()}
              unsupported={composerAttachmentsUnsupported()}
              onChange={setComposerAttachments}
              onError={setQueueError}
            />
            <Show when={queueError()}>{(message) => <span class="composer-error">{message()}</span>}</Show>
          </div>
          <button class="primary-action" disabled={runBusy() || !composerCanSubmit()} onClick={runDraft} type="button">
            {runBusy() ? "Running" : "Run"}
          </button>
          <button
            class="secondary-action"
            disabled={queueBusy() || !composerCanSubmit()}
            onClick={queueDraft}
            type="button"
          >
            {queueBusy() ? "Queueing" : "Queue"}
          </button>
        </footer>
      </section>

      <aside class="summary-panel" aria-label="Plan, approvals, and evidence">
        <section>
          <h3>Goal</h3>
          <Show when={view().goal} fallback={<p class="muted">No active goal</p>}>
            {(goal) => (
              <div class="summary-card">
                <strong>{goal().objective}</strong>
                <p>{goal().status}</p>
              </div>
            )}
          </Show>
        </section>

        <section>
          <h3>Todos</h3>
          <For each={view().todos}>
            {(todo) => (
              <div class="todo-row" data-status={todo.status}>
                <span>{todo.text}</span>
                <small>{todo.status.replaceAll("_", " ")}</small>
              </div>
            )}
          </For>
        </section>

        <section>
          <h3>Worktrees</h3>
          <div class="worktree-create">
            <input
              aria-label="New worktree name"
              onInput={(event) => setWorktreeName(event.currentTarget.value)}
              placeholder="sandbox name"
              value={worktreeName()}
            />
            <button disabled={worktreeBusy() === "create"} onClick={createWorktree} type="button">
              Create
            </button>
          </div>
          <div class="multirun-create">
            <input
              aria-label="Multi-run worktree prefix"
              onInput={(event) => setMultiRunPrefix(event.currentTarget.value)}
              placeholder="multi-run prefix"
              value={multiRunPrefix()}
            />
            <input
              aria-label="Multi-run count"
              min="1"
              max="6"
              onInput={(event) => setMultiRunCount(event.currentTarget.valueAsNumber || 1)}
              type="number"
              value={String(multiRunCount())}
            />
            <button disabled={multiRunBusy() || draft().trim().length === 0} onClick={fanOutMultiRun} type="button">
              Multi-run
            </button>
          </div>
          <Show when={worktreeError()}>{(message) => <p class="approval-error">{message()}</p>}</Show>
          <For each={view().multiRunGroups}>
            {(group) => (
              <div class="multirun-row" data-attention={group.attention}>
                <div>
                  <strong>{group.title}</strong>
                  <small>{multiRunGroupLabel(group)}</small>
                  <Show when={group.conflictPaths.length > 0}>
                    <small class="multirun-conflicts">Conflicts: {group.conflictPaths.slice(0, 3).join(", ")}</small>
                  </Show>
                </div>
                <div class="multirun-metrics" aria-label={`Multi-run ${group.id} comparison`}>
                  <span>{group.attention}</span>
                  <span>{group.running} run</span>
                  <span>{group.blocked} block</span>
                  <span>{group.completed} done</span>
                </div>
              </div>
            )}
          </For>
          <For each={view().worktrees}>
            {(worktree) => (
              <div class="worktree-row">
                <div>
                  <strong>{worktree.name}</strong>
                  <small>
                    {worktree.branch ? `branch ${worktree.branch} · ${worktree.directory}` : worktree.directory}
                  </small>
                </div>
                <div class="worktree-actions">
                  <button
                    disabled={worktreeBusy() === worktree.directory}
                    onClick={() => resetWorktree(worktree.directory)}
                    type="button"
                  >
                    Reset
                  </button>
                  <button
                    disabled={worktreeBusy() === worktree.directory}
                    onClick={() => removeWorktree(worktree.directory)}
                    type="button"
                  >
                    Remove
                  </button>
                </div>
              </div>
            )}
          </For>
        </section>

        <section>
          <h3>Settings</h3>
          <div class="summary-card runtime-card">
            <strong>{runtimeSummary().title}</strong>
            <p>{runtimeSummary().detail}</p>
          </div>
          <div class="evidence-grid" aria-label="Runtime catalog">
            <span>
              <strong>{view().catalog.providers.length}</strong> providers
            </span>
            <span>
              <strong>{view().catalog.models.length}</strong> models
            </span>
            <span>
              <strong>{view().catalog.agents.length}</strong> agents
            </span>
            <span>
              <strong>{skillSummaryLabel(view().catalog.skills)}</strong> skills
            </span>
            <span>
              <strong>{selectedModel()?.modelID ?? "default"}</strong> model
            </span>
            <span>
              <strong>
                {view().catalog.mcp.connected}/{view().catalog.mcp.total}
              </strong>{" "}
              MCP
            </span>
            <span>
              <strong>
                {view().catalog.lsp.connected}/{view().catalog.lsp.total}
              </strong>{" "}
              LSP
            </span>
            <span>
              <strong>{codeIndexSummaryLabel(view().catalog.codeIndex)}</strong> code index
            </span>
            <span>
              <strong>{permissionSummaryLabel(view().catalog.permission)}</strong> permissions
            </span>
          </div>
          <Show when={view().catalog.providers.length === 0}>
            <p class="muted">No providers returned by backend</p>
          </Show>
          <p class="muted">
            MCP {view().catalog.mcp.connected} connected · {view().catalog.mcp.failed} failed ·{" "}
            {view().catalog.mcp.needsAuth} needs auth · {view().catalog.mcp.needsTrust} needs trust
          </p>
          <p class="muted">
            LSP {view().catalog.lsp.connected} connected · {view().catalog.lsp.error} error · Code index{" "}
            {codeIndexDetailLabel(view().catalog.codeIndex)}
          </p>
          <p class="muted">Skills {skillDetailLabel(view().catalog.skills)}</p>
          <For each={view().catalog.providers.slice(0, 5)}>
            {(provider) => (
              <div class="provider-row" data-status={provider.status}>
                <div>
                  <strong>{provider.label}</strong>
                  <small>
                    {provider.source ?? "unknown"} · {provider.modelCount} models
                    {provider.reason ? ` · ${provider.reason}` : ""}
                  </small>
                </div>
                <span>{provider.defaultModelID ?? provider.status.replaceAll("_", " ")}</span>
              </div>
            )}
          </For>
          <For each={view().catalog.skills.slice(0, 5)}>
            {(skill) => (
              <div class="provider-row" data-status={skill.status}>
                <div>
                  <strong>{skill.name}</strong>
                  <small>
                    {skillSourceLabel(skill)}
                    {skill.description ? ` · ${skill.description}` : ""}
                    {skill.issues.length > 0 ? ` · ${skill.issues[0]}` : ""}
                  </small>
                </div>
                <span>{skill.status === "warn" ? "review" : "ready"}</span>
              </div>
            )}
          </For>
          <div class="settings-editor" aria-label="Project settings">
            <div>
              <strong>Project defaults</strong>
              <small>Backend reload required for saved config changes</small>
            </div>
            <div class="settings-editor-row">
              <select
                aria-label="Project default model"
                onChange={(event) => setSettingsModelKey(event.currentTarget.value)}
                value={settingsModelKey()}
              >
                <option value="">Choose model</option>
                <For each={view().catalog.models}>
                  {(model) => <option value={modelKey(model)}>{model.label}</option>}
                </For>
              </select>
              <button disabled={settingsBusy() || !settingsModel()} onClick={applyProjectModelSetting} type="button">
                Apply default
              </button>
            </div>
            <Show when={settingsStatus()}>{(message) => <p class="settings-status">{message()}</p>}</Show>
            <Show when={settingsError()}>{(message) => <p class="approval-error">{message()}</p>}</Show>
          </div>
          <div class="settings-editor" aria-label="Runtime probes">
            <div>
              <strong>Runtime probes</strong>
              <small>MCP, LSP, and code index status</small>
            </div>
            <div class="settings-editor-row settings-editor-row-single">
              <button disabled={probeBusy()} onClick={refreshRuntimeProbes} type="button">
                Refresh probes
              </button>
            </div>
            <Show when={probeStatus()}>{(message) => <p class="settings-status">{message()}</p>}</Show>
            <Show when={probeError()}>{(message) => <p class="approval-error">{message()}</p>}</Show>
          </div>
        </section>

        <DiagnosticsPanel
          report={diagnosticsReport()}
          busy={diagnosticsBusy()}
          error={diagnosticsError()}
          logText={diagnosticsLogText()}
          onRefresh={refreshDiagnostics}
          onExportLogs={exportLogs}
          onDownloadUpdate={downloadUpdate}
          onRevealUpdate={revealDownloadedUpdate}
          onOpenUpdate={openDownloadedUpdate}
          onShowStatusReport={showStatusReport}
          statusReportBusy={statusReportBusy()}
        />

        <section>
          <h3>Automations</h3>
          <div class="automation-create">
            <input
              aria-label="Automation title"
              onInput={(event) => setAutomationTitle(event.currentTarget.value)}
              value={automationTitle()}
            />
            <select
              aria-label="Automation schedule type"
              onChange={(event) =>
                setAutomationScheduleType(event.currentTarget.value as ScheduledTaskDraftSchedule["type"])
              }
              value={automationScheduleType()}
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="once">Once</option>
              <option value="cron">Cron</option>
            </select>
            <Show
              when={automationScheduleType() === "once"}
              fallback={
                <Show
                  when={automationScheduleType() === "cron"}
                  fallback={
                    <>
                      <Show when={automationScheduleType() === "weekly"}>
                        <select
                          aria-label="Automation weekly day"
                          onChange={(event) => setAutomationDay(Number(event.currentTarget.value))}
                          value={String(automationDay())}
                        >
                          <option value="0">Sunday</option>
                          <option value="1">Monday</option>
                          <option value="2">Tuesday</option>
                          <option value="3">Wednesday</option>
                          <option value="4">Thursday</option>
                          <option value="5">Friday</option>
                          <option value="6">Saturday</option>
                        </select>
                      </Show>
                      <input
                        aria-label="Automation time"
                        onInput={(event) => setAutomationTime(event.currentTarget.value)}
                        type="time"
                        value={automationTime()}
                      />
                    </>
                  }
                >
                  <input
                    aria-label="Automation cron expression"
                    onInput={(event) => setAutomationCron(event.currentTarget.value)}
                    value={automationCron()}
                  />
                </Show>
              }
            >
              <input
                aria-label="Automation run at"
                onInput={(event) => setAutomationRunAt(event.currentTarget.value)}
                type="datetime-local"
                value={automationRunAt()}
              />
            </Show>
            <textarea
              aria-label="Automation prompt"
              onInput={(event) => setAutomationPrompt(event.currentTarget.value)}
              value={automationPrompt()}
            />
            <button disabled={scheduledTaskBusy() === "create"} onClick={createAutomation} type="button">
              Create
            </button>
          </div>
          <Show when={scheduledTaskError()}>{(message) => <p class="approval-error">{message()}</p>}</Show>
          <p class="muted">{scheduledTaskExecutionLabel(runtimeConfig)}</p>
          <p class="muted">{scheduledNotificationLabel(runtimeConfig)}</p>
          <Show when={view().scheduledTasks.length === 0}>
            <p class="muted">No scheduled tasks</p>
          </Show>
          <For each={view().scheduledTasks}>
            {(task) => (
              <div class="scheduled-row" data-status={task.status}>
                <div>
                  <strong>{task.title}</strong>
                  <small>
                    {scheduleLabel(task.schedule)}
                    {task.nextRunAt ? ` · next ${formatTime(task.nextRunAt)}` : ""}
                  </small>
                  <small>{scheduledTaskRunLabel(task, commandCenterState().queue)}</small>
                  <Show when={task.error}>{(message) => <small class="scheduled-error">{message()}</small>}</Show>
                </div>
                <div class="scheduled-actions">
                  <span>{task.status}</span>
                  <button
                    disabled={scheduledTaskBusy() === task.id}
                    onClick={() => runScheduledAction(task, "run-now")}
                    type="button"
                  >
                    Run now
                  </button>
                  <Show
                    when={task.status === "paused"}
                    fallback={
                      <button
                        disabled={scheduledTaskBusy() === task.id}
                        onClick={() => runScheduledAction(task, "pause")}
                        type="button"
                      >
                        Pause
                      </button>
                    }
                  >
                    <button
                      disabled={scheduledTaskBusy() === task.id}
                      onClick={() => runScheduledAction(task, "resume")}
                      type="button"
                    >
                      Resume
                    </button>
                  </Show>
                </div>
              </div>
            )}
          </For>
        </section>

        <section>
          <h3>Approvals</h3>
          <Show when={approvalError()}>{(message) => <p class="approval-error">{message()}</p>}</Show>
          <div class="approval-policy" role="group" aria-label="Permission auto-accept policy">
            <label>
              <input
                checked={selectedSessionAutoAcceptEnabled()}
                disabled={!selectedSessionAutoAcceptAllowed()}
                onChange={(event) => toggleSelectedSessionAutoAccept(event.currentTarget.checked)}
                type="checkbox"
              />
              <span>Auto-accept allowed permissions for this session</span>
            </label>
            <small>
              {selectedSessionAutoAcceptAllowed()
                ? "Uses the backend Always policy for matching pending requests."
                : "No pending permission exposes an Always policy."}
            </small>
          </div>
          <For each={view().permissions}>
            {(permission) => (
              <div class="approval-card">
                <strong>{permission.permission}</strong>
                <p>{permission.patterns.join(", ")}</p>
                <div class="approval-actions">
                  <button
                    disabled={approvalBusy() === permission.id}
                    onClick={() => replyPermission(permission.id, "once")}
                    type="button"
                  >
                    Allow
                  </button>
                  <button
                    disabled={approvalBusy() === permission.id}
                    onClick={() => replyPermission(permission.id, "always")}
                    type="button"
                  >
                    Always
                  </button>
                  <button
                    disabled={approvalBusy() === permission.id}
                    onClick={() => replyPermission(permission.id, "reject")}
                    type="button"
                  >
                    Reject
                  </button>
                </div>
              </div>
            )}
          </For>
          <For each={view().questions}>
            {(question) => (
              <div class="approval-card">
                <strong>{question.questions[0]?.header ?? "Question"}</strong>
                <For each={question.questions}>
                  {(item, index) => (
                    <div class="question-form">
                      <p>{item.question}</p>
                      <div class="question-options" role="group" aria-label={`Answers for ${item.header}`}>
                        <For each={item.options}>
                          {(option) => (
                            <label class="question-option">
                              <input
                                checked={questionAnswerDraft(question.id, index()).selected.includes(option.label)}
                                name={`question-${question.id}-${index()}`}
                                onChange={(event) =>
                                  updateQuestionOption(
                                    question.id,
                                    index(),
                                    option.label,
                                    item.multiple ?? false,
                                    event.currentTarget.checked,
                                  )
                                }
                                type={item.multiple ? "checkbox" : "radio"}
                              />
                              <span>
                                <strong>{option.label}</strong>
                                <small>{option.description}</small>
                              </span>
                            </label>
                          )}
                        </For>
                      </div>
                      <Show when={item.custom !== false}>
                        <input
                          aria-label={`Custom answer for ${item.header}`}
                          onInput={(event) => updateQuestionCustom(question.id, index(), event.currentTarget.value)}
                          placeholder="Custom answer"
                          value={questionAnswerDraft(question.id, index()).custom}
                        />
                      </Show>
                    </div>
                  )}
                </For>
                <div class="approval-actions">
                  <button
                    disabled={approvalBusy() === question.id || !canSubmitQuestionAnswer(question)}
                    onClick={() => answerQuestion(question.id, buildQuestionAnswers(question))}
                    type="button"
                  >
                    Submit answer
                  </button>
                </div>
              </div>
            )}
          </For>
        </section>

        <section>
          <h3>Review</h3>
          <Show when={view().evidence} fallback={<p class="muted">No review evidence</p>}>
            {(evidence) => (
              <div class="evidence-stack">
                <div class="evidence-card" data-risk={evidence().risk?.level.toLowerCase() ?? evidence().status}>
                  <div class="evidence-title">
                    <strong>{evidence().risk ? `Risk ${evidence().risk!.level}` : "Risk unavailable"}</strong>
                    <small>{formatEvidenceScore(evidence())}</small>
                  </div>
                  <p>{evidence().risk?.summary ?? evidence().errors[0] ?? "No risk assessment recorded"}</p>
                  <For each={evidence().risk?.drivers ?? []}>
                    {(driver) => <span class="evidence-chip">{driver}</span>}
                  </For>
                </div>

                <Show when={evidence().semantic}>
                  {(semantic) => (
                    <div class="evidence-card">
                      <div class="evidence-title">
                        <strong>{semantic().headline}</strong>
                        <small>{semantic().risk}</small>
                      </div>
                      <p>
                        {semantic().files ?? semantic().changes.length} files · +{semantic().additions ?? 0} -
                        {semantic().deletions ?? 0}
                      </p>
                      <For each={semantic().changes.slice(0, 3)}>
                        {(change) => (
                          <div class="evidence-row">
                            <span>{change.file}</span>
                            <small>{change.risk ?? "change"}</small>
                          </div>
                        )}
                      </For>
                    </div>
                  )}
                </Show>

                <Show when={evidence().dre}>
                  {(dre) => (
                    <div class="evidence-card">
                      <div class="evidence-title">
                        <strong>DRE</strong>
                        <small>{dre().readiness ?? "recorded"}</small>
                      </div>
                      <p>{dre().decision ?? dre().summary}</p>
                      <For each={dre().timeline.slice(0, 3)}>{(line) => <span class="evidence-chip">{line}</span>}</For>
                    </div>
                  )}
                </Show>

                <Show when={evidence().branchRank}>
                  {(branchRank) => (
                    <div class="evidence-card">
                      <div class="evidence-title">
                        <strong>Branch rank</strong>
                        <small>{branchRankConfidenceLabel(branchRank().confidence)}</small>
                      </div>
                      <p>{branchRankRecommendationLabel(branchRank())}</p>
                      <For each={branchRank().reasons.slice(0, 3)}>
                        {(reason) => <span class="evidence-chip">{reason}</span>}
                      </For>
                      <For each={branchRank().items.slice(0, 3)}>
                        {(item) => (
                          <div class="evidence-row">
                            <span>
                              {item.title}
                              {item.current ? " · current" : ""}
                              {item.recommended ? " · recommended" : ""}
                            </span>
                            <small>{branchRankItemScoreLabel(item)}</small>
                          </div>
                        )}
                      </For>
                    </div>
                  )}
                </Show>

                <div class="evidence-card">
                  <div class="evidence-title">
                    <strong>Compare and comment</strong>
                    <button
                      disabled={reviewBusy() === "compare" || !compareSessionID()}
                      onClick={compareSelectedSession}
                      type="button"
                    >
                      Compare
                    </button>
                  </div>
                  <div class="review-compare-row">
                    <select
                      aria-label="Compare with session"
                      onChange={(event) => setCompareSessionID(event.currentTarget.value)}
                      value={compareSessionID()}
                    >
                      <option value="">Compare session</option>
                      <For each={view().sessions.filter((session) => session.id !== view().selectedSession?.id)}>
                        {(session) => <option value={session.id}>{session.title}</option>}
                      </For>
                    </select>
                  </div>
                  <Show when={reviewComparison()}>
                    {(comparison) => (
                      <div class="review-comparison">
                        <strong>{comparison().recommendation ?? "Comparison ready"}</strong>
                        <small>
                          winner {comparison().winner}
                          {typeof comparison().confidence === "number"
                            ? ` · ${Math.round(comparison().confidence! * 100)}%`
                            : ""}
                        </small>
                        <For each={comparison().differences.slice(0, 3)}>
                          {(difference) => <span class="evidence-chip">{difference}</span>}
                        </For>
                      </div>
                    )}
                  </Show>
                  <textarea
                    aria-label="Review note"
                    onInput={(event) => setReviewNote(event.currentTarget.value)}
                    placeholder="Add a review note or follow-up..."
                    value={reviewNote()}
                  />
                  <button
                    disabled={reviewBusy() === "comment" || reviewNote().trim().length === 0}
                    onClick={queueReviewNote}
                    type="button"
                  >
                    Queue review note
                  </button>
                </div>

                <Show when={reviewError()}>{(message) => <p class="approval-error">{message()}</p>}</Show>

                <Show when={evidence().rollbackPoints.length > 0}>
                  <div class="evidence-card">
                    <div class="evidence-title">
                      <strong>Rollback points</strong>
                      <button
                        disabled={reviewBusy() === "unrevert"}
                        onClick={() => runReviewAction("unrevert")}
                        type="button"
                      >
                        Restore
                      </button>
                    </div>
                    <For each={evidence().rollbackPoints.slice(0, 4)}>
                      {(point) => (
                        <div class="rollback-row">
                          <div>
                            <span>Step {point.step}</span>
                            <small>{rollbackPointLabel(point)}</small>
                          </div>
                          <button
                            disabled={reviewBusy() === `rollback-${point.step}` || !point.messageID}
                            onClick={() => runReviewAction("revert", point)}
                            type="button"
                          >
                            Revert
                          </button>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>

                <div class="evidence-grid" aria-label="Review artifacts">
                  <span>
                    <strong>{evidence().artifactCounts.findings}</strong> findings
                  </span>
                  <span>
                    <strong>{evidence().artifactCounts.verificationEnvelopes}</strong> checks
                  </span>
                  <span>
                    <strong>{evidence().artifactCounts.reviewResults}</strong> reviews
                  </span>
                  <span>
                    <strong>{evidence().rollbackPoints.length}</strong> rollback
                  </span>
                </div>

                <For each={artifactPreviewGroups(evidence())}>
                  {(group) => (
                    <Show when={group.items.length > 0}>
                      <div class="evidence-card">
                        <div class="evidence-title">
                          <strong>{group.title}</strong>
                          <small>{group.items.length} shown</small>
                        </div>
                        <For each={group.items.slice(0, 3)}>
                          {(item) => (
                            <div class="artifact-preview-row">
                              <div>
                                <strong>{item.title}</strong>
                                <Show when={item.detail}>{(detail) => <small>{detail()}</small>}</Show>
                              </div>
                              <small>{item.status ?? item.id ?? "recorded"}</small>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
                  )}
                </For>
              </div>
            )}
          </Show>
          <For each={view().diffs}>
            {(diff) => (
              <div class="diff-row">
                <span>{diff.path}</span>
                <small>
                  +{diff.added} -{diff.removed}
                </small>
              </div>
            )}
          </For>
        </section>
      </aside>
    </main>
    <AxCodeStatusDialog
      open={statusDialogOpen()}
      reportText={statusReportText()}
      busy={statusReportBusy()}
      onClose={() => setStatusDialogOpen(false)}
    />
    </>
  )
}

function mergeQueue(base: AppQueueItem[], additions: AppQueueItem[]) {
  const result = [...base]
  for (const item of additions) {
    const index = result.findIndex((existing) => existing.id === item.id)
    if (index >= 0) result[index] = item
    else result.push(item)
  }
  return result
}

function mergeSessions(base: AppSession[], additions: AppSession[]) {
  const result = [...base]
  for (const item of additions) {
    const index = result.findIndex((existing) => existing.id === item.id)
    if (index >= 0) result[index] = item
    else result.unshift(item)
  }
  return result.sort((a, b) => b.updatedAt - a.updatedAt)
}

function cachedSessionMessages(cache: Record<string, LiveSessionMessages>) {
  return Object.fromEntries(Object.entries(cache).map(([sessionID, value]) => [sessionID, value.messages]))
}

function cachedSessionParts(cache: Record<string, LiveSessionMessages>) {
  return Object.assign({}, ...Object.values(cache).map((value) => value.parts)) as LiveSessionMessages["parts"]
}

function projectButtonLabel(config: ReturnType<typeof getRuntimeConfig>) {
  if (config.mode !== "live") return "Open project"
  const source = config.directory ?? config.baseUrl
  const normalized = source.replace(/[\\/]+$/, "").replaceAll("\\", "/")
  return normalized.split("/").filter(Boolean).at(-1) ?? source
}

function queueTargetLabel(item: AppQueueItem, worktrees: AppWorktree[]) {
  const worktree = item.directory ? worktrees.find((candidate) => candidate.directory === item.directory) : undefined
  return worktree?.name ?? item.directory ?? item.project
}

function queueItemDraftText(item: AppQueueItem) {
  const text = item.payload?.["text"]
  if (typeof text === "string" && text.trim()) return text
  const body = item.payload?.["body"]
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>
    const command = record["command"]
    if (typeof command === "string" && command.trim()) return command
    const parts = Array.isArray(record["parts"]) ? record["parts"] : []
    const part = parts.find(
      (candidate) =>
        candidate &&
        typeof candidate === "object" &&
        (candidate as Record<string, unknown>)["type"] === "text" &&
        typeof (candidate as Record<string, unknown>)["text"] === "string",
    ) as Record<string, unknown> | undefined
    if (typeof part?.["text"] === "string" && part["text"].trim()) return part["text"]
  }
  return item.title
}

function isQueueItemEditable(item: AppQueueItem) {
  return (
    item.status === "queued" ||
    item.status === "waiting_for_idle" ||
    item.status === "paused" ||
    item.status === "failed" ||
    item.status === "cancelled"
  )
}

function isQueueItemRemovable(item: AppQueueItem) {
  return item.status !== "running" && item.status !== "blocked_permission" && item.status !== "blocked_question"
}

function commandCenterWorktrees(state: AppCommandCenterState) {
  return state.worktrees
}

function commandCenterTerminals(state: AppCommandCenterState) {
  return state.terminals
}

function commandCenterScheduledTasks(state: AppCommandCenterState) {
  return state.scheduledTasks
}

function mergeWorktrees(base: AppWorktree[], additions: AppWorktree[]) {
  const result = [...base]
  for (const item of additions) {
    const index = result.findIndex((existing) => existing.directory === item.directory)
    if (index >= 0) result[index] = item
    else result.push(item)
  }
  return result
}

function mergeTerminals(base: AppTerminal[], additions: AppTerminal[]) {
  const result = [...base]
  for (const item of additions) {
    const index = result.findIndex((existing) => existing.id === item.id)
    if (index >= 0) result[index] = item
    else result.push(item)
  }
  return result
}

function mergeScheduledTasks(base: AppScheduledTask[], additions: AppScheduledTask[]) {
  const result = [...base]
  for (const item of additions) {
    const index = result.findIndex((existing) => existing.id === item.id)
    if (index >= 0) result[index] = item
    else result.push(item)
  }
  return result
}

function loadingSessionEvidence(sessionID: string): AppSessionEvidence {
  return {
    sessionID,
    status: "loading",
    rollbackPoints: [],
    artifactCounts: {
      findings: 0,
      verificationEnvelopes: 0,
      reviewResults: 0,
      debugCases: 0,
      decisionHints: 0,
    },
    artifactPreviews: {
      findings: [],
      verificationEnvelopes: [],
      reviewResults: [],
      debugCases: [],
      decisionHints: [],
    },
    errors: [],
  }
}

function formatEvidenceScore(evidence: AppSessionEvidence) {
  if (!evidence.risk) return evidence.status
  const parts = []
  if (typeof evidence.risk.score === "number") parts.push(`${evidence.risk.score}/100`)
  if (typeof evidence.risk.confidence === "number") parts.push(`${Math.round(evidence.risk.confidence * 100)}%`)
  if (evidence.risk.readiness) parts.push(evidence.risk.readiness.replaceAll("_", " "))
  return parts.join(" · ") || evidence.risk.level
}

function artifactPreviewGroups(evidence: AppSessionEvidence) {
  return [
    { title: "Findings", items: evidence.artifactPreviews.findings },
    { title: "Verification envelopes", items: evidence.artifactPreviews.verificationEnvelopes },
    { title: "Review results", items: evidence.artifactPreviews.reviewResults },
    { title: "Debug cases", items: evidence.artifactPreviews.debugCases },
    { title: "Decision hints", items: evidence.artifactPreviews.decisionHints },
  ]
}

function branchRankConfidenceLabel(confidence?: number) {
  return typeof confidence === "number" ? `${Math.round(confidence * 100)}% confidence` : "ranked"
}

function branchRankRecommendationLabel(branchRank: AppBranchRankEvidence) {
  if (!branchRank.recommendedTitle) return "No recommended branch recorded"
  return `Recommended: ${branchRank.recommendedTitle}`
}

function branchRankItemScoreLabel(item: AppBranchRankEvidence["items"][number]) {
  const parts = []
  if (item.riskLevel) parts.push(item.riskScore == null ? item.riskLevel : `${item.riskLevel} ${item.riskScore}`)
  if (typeof item.decisionScore === "number") parts.push(`${item.decisionScore} decision`)
  return parts.join(" · ") || item.headline || "branch"
}

function rollbackPointLabel(point: AppRollbackPoint) {
  const tools = point.tools.length > 0 ? point.tools.join(", ") : point.kinds.join(", ")
  const tokens = point.tokens ? `${point.tokens.input}/${point.tokens.output} tokens` : undefined
  const duration = point.durationMs ? `${Math.round(point.durationMs)}ms` : undefined
  return [tools || "recorded step", duration, tokens].filter(Boolean).join(" · ")
}

function multiRunGroupLabel(group: ReturnType<typeof createCommandCenterViewModel>["multiRunGroups"][number]) {
  const worktrees = group.worktrees.length > 0 ? group.worktrees.join(", ") : "no worktrees"
  const sessions = group.sessions.length > 0 ? `${group.sessions.length} sessions` : "waiting for sessions"
  const changed = group.changedFiles.length > 0 ? `${group.changedFiles.length} files` : "no diff"
  return `${group.total} variants · ${sessions} · ${changed} · ${worktrees}`
}

function modelKey(model: AppModelOption) {
  return `${model.providerID}:${model.modelID}`
}

function modelFromKey(key: string, models: AppModelOption[]) {
  if (!key) return undefined
  const model = models.find((item) => modelKey(item) === key)
  return model ? { providerID: model.providerID, modelID: model.modelID } : undefined
}

function defaultToolPane(config: ReturnType<typeof getRuntimeConfig>): ToolPane {
  return defaultToolPaneFromPolicy({
    terminal: isAppFeatureEnabled(config, "terminalPane"),
    browser: isAppFeatureEnabled(config, "browserPane"),
    file: isAppFeatureEnabled(config, "filePane"),
  })
}

function defaultToolPaneFromPolicy(policy: { terminal: boolean; browser: boolean; file: boolean }): ToolPane {
  if (policy.terminal) return "terminal"
  if (policy.browser) return "browser"
  return "file"
}

function browserPreviewSrc(value: string, refreshKey: number) {
  try {
    const url = new URL(value)
    if (url.protocol === "http:" || url.protocol === "https:") {
      if (refreshKey > 0) url.searchParams.set("_ax_preview_reload", String(refreshKey))
      return url.toString()
    }
  } catch {
    return "about:blank"
  }
  return "about:blank"
}

function normalizeBrowserPreviewUrl(value: string) {
  try {
    const url = new URL(value.trim())
    if (url.protocol === "http:" || url.protocol === "https:") return url.toString()
  } catch {
    return undefined
  }
  return undefined
}

function browserPreviewTitle(value: string) {
  try {
    const url = new URL(value)
    const path = url.pathname === "/" ? "" : url.pathname
    return `${url.host}${path}` || "Browser preview"
  } catch {
    return "Browser preview"
  }
}

function terminalScopeLabel(terminal: AppTerminal) {
  const scope = terminal.sessionTitle ?? terminal.cwd
  return scope || "project"
}

function permissionSummaryLabel(permission: ReturnType<typeof createCommandCenterViewModel>["catalog"]["permission"]) {
  if (permission.totalRules === 0) return "default"
  return `${permission.allow} allow/${permission.ask} ask/${permission.deny} deny`
}

function skillSummaryLabel(skills: ReturnType<typeof createCommandCenterViewModel>["catalog"]["skills"]) {
  const warnings = skills.filter((skill) => skill.status === "warn").length
  return warnings > 0 ? `${skills.length}/${warnings} warn` : String(skills.length)
}

function skillDetailLabel(skills: ReturnType<typeof createCommandCenterViewModel>["catalog"]["skills"]) {
  if (skills.length === 0) return "none discovered"
  const warnings = skills.filter((skill) => skill.status === "warn").length
  const ready = skills.length - warnings
  return `${ready} ready · ${warnings} warnings`
}

function skillSourceLabel(skill: ReturnType<typeof createCommandCenterViewModel>["catalog"]["skills"][number]) {
  if (skill.builtin) return "built-in"
  if (!skill.location) return "workspace"
  if (
    skill.location.includes("/.ax-code/") ||
    skill.location.includes("/.agents/") ||
    skill.location.includes("/.claude/")
  ) {
    return "project"
  }
  return skill.location
}

function codeIndexSummaryLabel(codeIndex: ReturnType<typeof createCommandCenterViewModel>["catalog"]["codeIndex"]) {
  if (codeIndex.state === "indexing") return `${codeIndex.completed}/${codeIndex.total || "?"}`
  if (codeIndex.state === "failed") return "failed"
  if (codeIndex.nodeCount > 0) return `${codeIndex.nodeCount} nodes`
  return "idle"
}

function codeIndexDetailLabel(codeIndex: ReturnType<typeof createCommandCenterViewModel>["catalog"]["codeIndex"]) {
  const progress =
    codeIndex.total > 0
      ? `${codeIndex.completed}/${codeIndex.total}`
      : codeIndex.nodeCount > 0
        ? `${codeIndex.nodeCount} nodes`
        : "no graph"
  const pending = codeIndex.pendingPlans === 1 ? "1 pending plan" : `${codeIndex.pendingPlans} pending plans`
  return `${codeIndex.state} · ${progress} · ${pending}`
}

function automationScheduleDraft(input: {
  type: ScheduledTaskDraftSchedule["type"]
  time: string
  day: number
  runAt: string
  cron: string
}): ScheduledTaskDraftSchedule {
  if (input.type === "weekly") return { type: "weekly", day: input.day, time: input.time }
  if (input.type === "once") return { type: "once", runAt: Date.parse(input.runAt) }
  if (input.type === "cron") return { type: "cron", expression: input.cron }
  return { type: "daily", time: input.time }
}

function defaultDatetimeLocal() {
  const date = new Date(Date.now() + 60 * 60 * 1000)
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`
}

function createEventStreamBanner(input: {
  mode: ReturnType<typeof getRuntimeConfig>["mode"]
  status: AppEventStreamDiagnostics["status"]
  appliedEvents: number
  lastEventAt?: number
  error?: string
}) {
  if (input.mode === "fixture") {
    return {
      status: "fixture",
      title: "Event stream fixture",
      detail: "Using deterministic local projection state.",
      badge: "fixture",
    }
  }
  if (input.status === "connected") {
    return {
      status: "connected",
      title: "Event stream connected",
      detail: `${input.appliedEvents} events applied${input.lastEventAt ? ` · last ${formatTime(input.lastEventAt)}` : ""}`,
      badge: "live",
    }
  }
  if (input.status === "error") {
    return {
      status: "error",
      title: "Event stream error",
      detail: input.error ?? "Live updates are paused until the backend stream reconnects.",
      badge: "attention",
    }
  }
  if (input.status === "unavailable") {
    return {
      status: "unavailable",
      title: "Event stream unavailable",
      detail: "Using bootstrap state. Refresh diagnostics or reconnect the backend.",
      badge: "offline",
    }
  }
  return {
    status: "connecting",
    title: "Reconnecting to backend events",
    detail: "Command actions remain available while live updates recover.",
    badge: "reconnect",
  }
}

function createNetworkModeBanner(config: ReturnType<typeof getRuntimeConfig>) {
  const scope = runtimeNetworkScope(config)
  if (scope === "fixture" || scope === "loopback") return undefined
  if (scope === "invalid") {
    return {
      scope,
      title: "Backend URL is invalid",
      detail: "Live runtime may not connect until the configured backend URL is fixed.",
      badge: "invalid",
    }
  }
  return {
    scope,
    title: "Remote backend mode",
    detail: "Trusted desktop bridge capabilities are limited to loopback backends; remote surfaces remain gated.",
    badge: "network",
  }
}

function scheduleLabel(value: unknown) {
  if (!value || typeof value !== "object") return "schedule"
  const record = value as Record<string, unknown>
  if (record.type === "daily") return `daily ${record.time ?? ""}`.trim()
  if (record.type === "weekly") return `weekly ${record.time ?? ""}`.trim()
  if (record.type === "once" && typeof record.runAt === "number") return `once ${formatTime(record.runAt)}`
  if (record.type === "cron") return `cron ${record.expression ?? ""}`.trim()
  return String(record.type ?? "schedule")
}

function scheduledTaskExecutionLabel(config: ReturnType<typeof getRuntimeConfig>) {
  if (config.mode !== "live") return "Fixture scheduler"
  const execution = config.scheduledTaskExecution
  if (!execution) return "Backend scheduler"
  if (execution.owner === "desktop-sidecar") return "Runs while this desktop app owns the backend"
  if (execution.owner === "attached-backend") return "Runs on the attached backend"
  return execution.stopsOnAppQuit ? "Runs while this app is open" : "Runs outside this app"
}

function scheduledNotificationLabel(config: ReturnType<typeof getRuntimeConfig>) {
  if (config.mode !== "live") return "Notifications: fixture only"
  return globalThis.window?.axCodeDesktop ? "Notifications: desktop enabled" : "Notifications: unavailable"
}

function scheduledTaskRunLabel(task: AppScheduledTask, queue: AppQueueItem[]) {
  const linkedQueue = task.lastQueueID ? queue.find((item) => item.id === task.lastQueueID) : undefined
  const sessionID = task.lastSessionID ?? linkedQueue?.sessionID
  const durationMs = task.lastDurationMs ?? queueItemDurationMs(linkedQueue)
  const parts = [task.lastRunAt ? `last ${formatTime(task.lastRunAt)}` : "never run"]

  if (durationMs !== undefined) parts.push(`duration ${formatDuration(durationMs)}`)
  if (sessionID) parts.push(`session ${sessionID}`)
  if (task.lastQueueID) parts.push(`queue ${linkedQueue?.status?.replaceAll("_", " ") ?? task.lastQueueID}`)

  return parts.join(" · ")
}

function queueItemDurationMs(item: AppQueueItem | undefined) {
  if (item?.startedAt === undefined || item.completedAt === undefined) return undefined
  return Math.max(0, item.completedAt - item.startedAt)
}

function formatDuration(value: number) {
  if (value < 1000) return `${value}ms`
  const seconds = value / 1000
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
}

function formatTime(value: number) {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function normalizeQuestionAnswerDraft(draft: QuestionAnswerDraft, allowCustom: boolean) {
  const custom = allowCustom ? draft.custom.trim() : ""
  return [...new Set([...draft.selected, ...(custom ? [custom] : [])])].filter(Boolean)
}

function omitRecordKey<T>(record: Record<string, T>, key: string) {
  const { [key]: _omitted, ...rest } = record
  return rest
}
