import { createEffect, createMemo, createResource, createSignal, For, onCleanup, Show } from "solid-js"
import type {
  AppCommandCenterState,
  AppModelOption,
  AppQueueItem,
  AppRollbackPoint,
  AppScheduledTask,
  AppSessionEvidence,
  AppTerminal,
  AppWorktree,
} from "./projection/types"
import { createFixtureCommandCenterState } from "./projection/replay"
import { createCommandCenterViewModel } from "./projection/view-model"
import { DiagnosticsPanel } from "./DiagnosticsPanel"
import {
  abortSessionTask,
  compareReviewSessions,
  createScheduledTask,
  notifyScheduledTaskQueued,
  queueReviewComment,
  queueMultiRunTask,
  queueDraftTask,
  readFilePreview,
  revealFilePath,
  replyPermissionRequest,
  replyQuestionRequest,
  runDraftTask,
  runQueueItemCommand,
  runReviewCommand,
  runScheduledTaskCommand,
  runTerminalCommand,
  runWorktreeCommand,
  type FilePreviewResult,
  type AppReviewComparison,
  type QueueDraftMode,
  type QueueItemCommand,
  type ReviewCommand,
  type ScheduledTaskCommand,
} from "./runtime/actions"
import { getRuntimeConfig } from "./runtime/config"
import {
  createAppDiagnosticsReport,
  exportDesktopLogs,
  readDesktopDiagnostics,
  type AppDesktopDiagnostics,
  type AppEventStreamDiagnostics,
} from "./runtime/diagnostics"
import {
  bootstrapLiveCommandCenterState,
  createLiveHeadlessClient,
  followLiveCommandCenterEvents,
  loadLiveSessionEvidence,
} from "./runtime/live"

const DRAFT_STORAGE_KEY = "ax-code.app.composer-draft"

export function App() {
  const runtimeConfig = getRuntimeConfig()
  const fixtureState = createFixtureCommandCenterState()
  const [composerMode, setComposerMode] = createSignal<QueueDraftMode>("prompt")
  const [draft, setDraft] = createSignal(readStoredDraft() ?? "Queue a supervised follow-up...")
  const [selectedAgent, setSelectedAgent] = createSignal("")
  const [selectedModelKey, setSelectedModelKey] = createSignal("")
  const [selectedWorktreeDirectory, setSelectedWorktreeDirectory] = createSignal("")
  const [worktreeName, setWorktreeName] = createSignal("")
  const [multiRunCount, setMultiRunCount] = createSignal(2)
  const [multiRunPrefix, setMultiRunPrefix] = createSignal("parallel")
  const [automationTitle, setAutomationTitle] = createSignal("Daily branch review")
  const [automationPrompt, setAutomationPrompt] = createSignal(
    "Review the current branch and queue verification follow-ups.",
  )
  const [automationTime, setAutomationTime] = createSignal("09:00")
  const [toolPane, setToolPane] = createSignal<"terminal" | "browser" | "file">("terminal")
  const [terminalCommand, setTerminalCommand] = createSignal("zsh")
  const [browserUrl, setBrowserUrl] = createSignal("http://127.0.0.1:3000")
  const [filePath, setFilePath] = createSignal("packages/app/src/App.tsx")
  const [filePreview, setFilePreview] = createSignal<FilePreviewResult | undefined>()
  const [compareSessionID, setCompareSessionID] = createSignal("")
  const [reviewNote, setReviewNote] = createSignal("")
  const [reviewComparison, setReviewComparison] = createSignal<AppReviewComparison | undefined>()
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
  const [scheduledTaskBusy, setScheduledTaskBusy] = createSignal<string | undefined>()
  const [reviewBusy, setReviewBusy] = createSignal<string | undefined>()
  const [fileBusy, setFileBusy] = createSignal(false)
  const [fileActionBusy, setFileActionBusy] = createSignal(false)
  const [queueError, setQueueError] = createSignal<string | undefined>()
  const [worktreeError, setWorktreeError] = createSignal<string | undefined>()
  const [terminalError, setTerminalError] = createSignal<string | undefined>()
  const [scheduledTaskError, setScheduledTaskError] = createSignal<string | undefined>()
  const [reviewError, setReviewError] = createSignal<string | undefined>()
  const [fileError, setFileError] = createSignal<string | undefined>()
  const [diagnosticsError, setDiagnosticsError] = createSignal<string | undefined>()
  const [diagnosticsBusy, setDiagnosticsBusy] = createSignal(false)
  const [diagnosticsLogText, setDiagnosticsLogText] = createSignal("")
  const [desktopDiagnostics, setDesktopDiagnostics] = createSignal<AppDesktopDiagnostics | undefined>()
  const [eventStreamStatus, setEventStreamStatus] = createSignal<AppEventStreamDiagnostics["status"]>(
    runtimeConfig.mode === "live" ? "connecting" : "fixture",
  )
  const [eventStreamAppliedCount, setEventStreamAppliedCount] = createSignal(0)
  const [lastEventAt, setLastEventAt] = createSignal<number | undefined>()
  const [eventStreamError, setEventStreamError] = createSignal<string | undefined>()
  const [approvalBusy, setApprovalBusy] = createSignal<string | undefined>()
  const [approvalError, setApprovalError] = createSignal<string | undefined>()
  const [queueActionBusy, setQueueActionBusy] = createSignal<string | undefined>()
  const [abortBusy, setAbortBusy] = createSignal(false)
  const [eventVersion, setEventVersion] = createSignal(0)
  const [selectedSessionID, setSelectedSessionID] = createSignal<string | undefined>()
  const [evidenceCache, setEvidenceCache] = createSignal<Record<string, AppSessionEvidence>>({})
  const [notifiedScheduledQueueIDs, setNotifiedScheduledQueueIDs] = createSignal<string[]>([])
  const [liveState] = createResource(
    () => (runtimeConfig.mode === "live" ? runtimeConfig : undefined),
    (config) => bootstrapLiveCommandCenterState(config).catch(() => fixtureState),
  )
  const commandCenterState = createMemo(() => {
    eventVersion()
    const base = liveState() ?? fixtureState
    return {
      ...base,
      selectedSessionID: selectedSessionID() ?? base.selectedSessionID,
      queue: mergeQueue(base.queue, localQueue()),
      worktrees: mergeWorktrees(
        commandCenterWorktrees(base).filter((item) => !removedWorktreeDirs().includes(item.directory)),
        localWorktrees(),
      ),
      terminals: mergeTerminals(
        commandCenterTerminals(base).filter((item) => !removedTerminalIDs().includes(item.id)),
        localTerminals(),
      ),
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
  const requestedEvidence = new Set<string>()

  createEffect(() => {
    writeStoredDraft(draft())
  })

  createEffect(() => {
    if (runtimeConfig.mode !== "live") return
    const state = liveState()
    if (!state) return

    const controller = new AbortController()
    const client = createLiveHeadlessClient(runtimeConfig)
    setEventStreamStatus("connecting")
    setEventStreamError(undefined)
    void followLiveCommandCenterEvents(state, client, {
      signal: controller.signal,
      onEvent: (_event, applied) => {
        setEventStreamStatus("connected")
        setLastEventAt(Date.now())
        if (applied) setEventVersion((version) => version + 1)
        if (applied) setEventStreamAppliedCount((count) => count + 1)
      },
    })
      .then((count) => {
        if (!controller.signal.aborted && count === 0) setEventStreamStatus("unavailable")
      })
      .catch((error) => {
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
        agent: selectedAgent() || undefined,
        model: selectedModel(),
      })
      setLocalQueue((items) => mergeQueue(items, [item]))
      setDraft("")
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
        agent: selectedAgent() || undefined,
        model: selectedModel(),
      })
      setSelectedSessionID(result.sessionID)
      setDraft("")
    } catch (error) {
      setQueueError(error instanceof Error ? error.message : String(error))
    } finally {
      setRunBusy(false)
    }
  }

  async function replyPermission(requestID: string, reply: "once" | "reject") {
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

  async function answerQuestion(requestID: string, question: unknown) {
    if (approvalBusy()) return
    setApprovalBusy(requestID)
    setApprovalError(undefined)
    try {
      await replyQuestionRequest({ config: runtimeConfig, requestID, answers: defaultQuestionAnswer(question) })
    } catch (error) {
      setApprovalError(error instanceof Error ? error.message : String(error))
    } finally {
      setApprovalBusy(undefined)
    }
  }

  async function runQueueAction(item: AppQueueItem, command: QueueItemCommand, queue = view().queue) {
    if (queueActionBusy()) return
    setQueueActionBusy(item.id)
    setQueueError(undefined)
    try {
      const updated = await runQueueItemCommand({ config: runtimeConfig, item, command, queue })
      setLocalQueue((items) => mergeQueue(items, [updated]))
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
        agent: selectedAgent() || undefined,
        model: selectedModel(),
      })
      setLocalWorktrees((items) => mergeWorktrees(items, result.worktrees))
      setLocalQueue((items) => mergeQueue(items, result.queue))
      setRemovedWorktreeDirs((items) =>
        items.filter((directory) => !result.worktrees.some((worktree) => worktree.directory === directory)),
      )
      setDraft("")
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
    if (terminalBusy()) return
    setTerminalBusy("create")
    setTerminalError(undefined)
    try {
      const result = await runTerminalCommand({
        config: runtimeConfig,
        command: "create",
        shellCommand: terminalCommand(),
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
        time: automationTime(),
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

  return (
    <main class="app-shell" data-testid="ax-code-app">
      <a class="skip-link" href="#work-surface">
        Skip to work surface
      </a>
      <aside class="project-rail" aria-label="Projects and sessions">
        <div class="brand-block">
          <div class="brand-mark">AX</div>
          <div>
            <h1>AX Code</h1>
            <p>Command center</p>
          </div>
        </div>

        <section class="rail-section">
          <h2>Project</h2>
          <button class="project-button" type="button">
            <span>ax-code</span>
            <strong>{view().queueSummary.total}</strong>
          </button>
        </section>

        <section class="rail-section">
          <h2>Sessions</h2>
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
                  </div>
                  <div class="queue-controls">
                    <span class="queue-status">{item.status.replaceAll("_", " ")}</span>
                    <button
                      disabled={queueActionBusy() === item.id || index() === 0}
                      onClick={() => runQueueAction(item, "move-up", view().queue)}
                      type="button"
                    >
                      Up
                    </button>
                    <button
                      disabled={queueActionBusy() === item.id || index() === view().queue.length - 1}
                      onClick={() => runQueueAction(item, "move-down", view().queue)}
                      type="button"
                    >
                      Down
                    </button>
                    <button
                      disabled={queueActionBusy() === item.id}
                      onClick={() => runQueueAction(item, "send-now")}
                      type="button"
                    >
                      Send now
                    </button>
                    <Show
                      when={item.status === "paused"}
                      fallback={
                        <button
                          disabled={queueActionBusy() === item.id}
                          onClick={() => runQueueAction(item, "pause")}
                          type="button"
                        >
                          Pause
                        </button>
                      }
                    >
                      <button
                        disabled={queueActionBusy() === item.id}
                        onClick={() => runQueueAction(item, "resume")}
                        type="button"
                      >
                        Resume
                      </button>
                    </Show>
                    <button
                      disabled={queueActionBusy() === item.id}
                      onClick={() => runQueueAction(item, "cancel")}
                      type="button"
                    >
                      Cancel
                    </button>
                    <Show when={item.status === "failed" || item.status === "cancelled"}>
                      <button
                        disabled={queueActionBusy() === item.id}
                        onClick={() => runQueueAction(item, "retry")}
                        type="button"
                      >
                        Retry
                      </button>
                    </Show>
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
        </section>

        <section class="tool-pane" aria-label="Terminal, browser, and file preview">
          <div class="mode-tabs" role="tablist" aria-label="Tool pane">
            <button
              role="tab"
              aria-selected={toolPane() === "terminal"}
              aria-controls="tool-panel-terminal"
              classList={{ active: toolPane() === "terminal" }}
              onClick={() => setToolPane("terminal")}
              type="button"
            >
              Terminal
            </button>
            <button
              role="tab"
              aria-selected={toolPane() === "browser"}
              aria-controls="tool-panel-browser"
              classList={{ active: toolPane() === "browser" }}
              onClick={() => setToolPane("browser")}
              type="button"
            >
              Browser
            </button>
            <button
              role="tab"
              aria-selected={toolPane() === "file"}
              aria-controls="tool-panel-file"
              classList={{ active: toolPane() === "file" }}
              onClick={() => setToolPane("file")}
              type="button"
            >
              File
            </button>
          </div>

          <Show when={toolPane() === "terminal"}>
            <div class="tool-pane-body" id="tool-panel-terminal" role="tabpanel">
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
                        {terminal.command} · {terminal.cwd || "project"}
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

          <Show when={toolPane() === "browser"}>
            <div class="tool-pane-body" id="tool-panel-browser" role="tabpanel">
              <div class="tool-command-row">
                <input
                  aria-label="Browser preview URL"
                  onInput={(event) => setBrowserUrl(event.currentTarget.value)}
                  value={browserUrl()}
                />
              </div>
              <iframe
                class="browser-frame"
                sandbox="allow-forms allow-same-origin allow-scripts"
                src={safePreviewUrl(browserUrl())}
                title="Browser preview"
              />
            </div>
          </Show>

          <Show when={toolPane() === "file"}>
            <div class="tool-pane-body" id="tool-panel-file" role="tabpanel">
              <div class="tool-command-row">
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
          <div class="mode-tabs" role="tablist" aria-label="Composer mode">
            <button
              classList={{ active: composerMode() === "prompt" }}
              onClick={() => setComposerMode("prompt")}
              type="button"
            >
              Prompt
            </button>
            <button
              classList={{ active: composerMode() === "command" }}
              onClick={() => setComposerMode("command")}
              type="button"
            >
              Command
            </button>
            <button
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
            <input aria-label="Draft prompt" onInput={(event) => setDraft(event.currentTarget.value)} value={draft()} />
            <Show when={queueError()}>{(message) => <span class="composer-error">{message()}</span>}</Show>
          </div>
          <button
            class="primary-action"
            disabled={runBusy() || draft().trim().length === 0}
            onClick={runDraft}
            type="button"
          >
            {runBusy() ? "Running" : "Run"}
          </button>
          <button
            class="secondary-action"
            disabled={queueBusy() || draft().trim().length === 0}
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
                  <small>{worktree.directory}</small>
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
              <strong>{selectedModel()?.modelID ?? "default"}</strong> model
            </span>
          </div>
          <Show when={view().catalog.providers.length === 0}>
            <p class="muted">No providers returned by backend</p>
          </Show>
          <For each={view().catalog.providers.slice(0, 5)}>
            {(provider) => (
              <div class="provider-row" data-status={provider.status}>
                <div>
                  <strong>{provider.label}</strong>
                  <small>
                    {provider.source ?? "unknown"} · {provider.modelCount} models
                  </small>
                </div>
                <span>{provider.defaultModelID ?? provider.status.replaceAll("_", " ")}</span>
              </div>
            )}
          </For>
        </section>

        <DiagnosticsPanel
          report={diagnosticsReport()}
          busy={diagnosticsBusy()}
          error={diagnosticsError()}
          logText={diagnosticsLogText()}
          onRefresh={refreshDiagnostics}
          onExportLogs={exportLogs}
        />

        <section>
          <h3>Automations</h3>
          <div class="automation-create">
            <input
              aria-label="Automation title"
              onInput={(event) => setAutomationTitle(event.currentTarget.value)}
              value={automationTitle()}
            />
            <input
              aria-label="Automation time"
              onInput={(event) => setAutomationTime(event.currentTarget.value)}
              value={automationTime()}
            />
            <input
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
                <p>{question.questions[0]?.question}</p>
                <div class="approval-actions">
                  <button
                    disabled={approvalBusy() === question.id}
                    onClick={() => answerQuestion(question.id, question)}
                    type="button"
                  >
                    Answer
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

function queueTargetLabel(item: AppQueueItem, worktrees: AppWorktree[]) {
  const worktree = item.directory ? worktrees.find((candidate) => candidate.directory === item.directory) : undefined
  return worktree?.name ?? item.directory ?? item.project
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

function safePreviewUrl(value: string) {
  try {
    const url = new URL(value)
    if (url.protocol === "http:" || url.protocol === "https:") return url.toString()
  } catch {
    return "about:blank"
  }
  return "about:blank"
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

function formatTime(value: number) {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function defaultQuestionAnswer(question: unknown) {
  if (!question || typeof question !== "object") return {}
  const questions = (question as { questions?: unknown[] }).questions
  const first = Array.isArray(questions) ? questions[0] : undefined
  if (!first || typeof first !== "object") return {}
  const record = first as { id?: unknown; options?: Array<{ label?: unknown; value?: unknown }> }
  if (typeof record.id !== "string") return {}
  const firstOption = Array.isArray(record.options) ? record.options[0] : undefined
  return {
    [record.id]: firstOption?.value ?? firstOption?.label ?? true,
  }
}

function readStoredDraft() {
  try {
    const value = window.localStorage.getItem(DRAFT_STORAGE_KEY)
    return value && value.trim().length > 0 ? value : undefined
  } catch {
    return undefined
  }
}

function writeStoredDraft(value: string) {
  try {
    if (value.trim().length === 0) window.localStorage.removeItem(DRAFT_STORAGE_KEY)
    else window.localStorage.setItem(DRAFT_STORAGE_KEY, value)
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
}
