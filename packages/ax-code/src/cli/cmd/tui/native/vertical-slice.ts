import type { Args } from "../context/args"
import type { EventSource } from "../context/sdk"
import type { TuiConfig } from "@/config/tui"
import { Agent } from "@/agent/agent"
import { DiagnosticLog } from "@/debug/diagnostic-log"
import { Provider } from "@/provider/provider"
import { resolveCommandKeyDispatch } from "../input/command-dispatch"
import { resolveFocusOwner } from "../input/focus-manager"
import { matchKeymapBinding, parseKeymapBindings, type Keymap } from "../input/keymap"
import {
  dialogSelectClampIndex,
  dialogSelectFlatOptions,
  dialogSelectGroupedOptions,
} from "../ui/dialog-select-view-model"
import { footerPermissionLabel } from "../routes/session/footer-view-model"
import { sessionHeaderWorkspaceLabel } from "../routes/session/header-view-model"
import stripAnsi from "strip-ansi"

type NativePermissionRequest = {
  id: string
  sessionID: string
  permission: string
  patterns?: string[]
  metadata?: Record<string, unknown>
  always?: string[]
}

type NativePermissionPromptState = {
  request: NativePermissionRequest
  editingReject: boolean
  rejectMessage: string
}

type NativeWorkspaceEntry = {
  id: string
  title: string
  directory?: string
}

type NativeWorkspacePromptState = {
  entries: NativeWorkspaceEntry[]
  selection: number
  loading: boolean
  localDirectory?: string
  currentDirectory?: string
}

type NativeQuestionOption = {
  label: string
  description?: string
}

type NativeQuestionInfo = {
  header: string
  question: string
  options: NativeQuestionOption[]
  multiple?: boolean
  custom?: boolean
}

type NativeQuestionRequest = {
  id: string
  sessionID: string
  questions: NativeQuestionInfo[]
}

type NativeQuestionPromptState = {
  request: NativeQuestionRequest
  index: number
  answers: string[][]
  selection: number
  customAnswers: string[]
  editingCustom: boolean
}

type NativePartLike = {
  type: string
  text?: string
  synthetic?: boolean
  ignored?: boolean
  tool?: string
  filename?: string
  url?: string
  state?: {
    status?: string
    input?: unknown
    output?: unknown
    error?: unknown
  }
}

type NativeMessageLike = {
  info?: {
    role?: string
  }
  parts?: NativePartLike[]
}

type NativeSessionInfoLike = {
  id: string
  directory?: string
  title?: string
}

export type NativeTranscriptEntry = {
  role: "assistant" | "system" | "user"
  text: string
}

type NativePromptModel = {
  providerID: string
  modelID: string
}

type NativeCommandID =
  | "dialog.command"
  | "dialog.workspace"
  | "dialog.session"
  | "dialog.agent"
  | "dialog.provider"
  | "dialog.model"
  | "transcript.bottom"

type NativeDialogKind = "command" | "provider" | "model" | "agent" | "session"

type NativeDialogValue =
  | { type: "command"; id: NativeCommandID }
  | { type: "provider"; providerID: string }
  | { type: "model"; providerID: string; modelID: string }
  | { type: "agent"; name: string }
  | { type: "session"; sessionID: string; directory?: string }

type NativeDialogOption = {
  title: string
  value: NativeDialogValue
  category?: string
  description?: string
  disabled?: boolean
  current?: boolean
}

type NativeDialogState = {
  kind: NativeDialogKind
  title: string
  query: string
  selection: number
  options: NativeDialogOption[]
  loading: boolean
}

export type NativeViewport = {
  width: number
  height: number
}

export type NativeInputAction =
  | { type: "key"; name: string; ctrl?: boolean; meta?: boolean; shift?: boolean }
  | { type: "text"; text: string }

export type NativeTuiSliceInput = {
  url: string
  args: Args
  config: TuiConfig.Info
  onSnapshot?: () => Promise<string[]>
  directory?: string
  fetch?: typeof fetch
  headers?: RequestInit["headers"]
  events?: EventSource
}

type NativeTerminalCore = {
  parseInputJson?: (input: string) => string
}

type NativeReadable = {
  isTTY?: boolean
  setRawMode?: (enabled: boolean) => void
  resume?: () => void
  pause?: () => void
  on?: (event: "data", handler: (chunk: Buffer | string) => void) => unknown
  off?: (event: "data", handler: (chunk: Buffer | string) => void) => unknown
}

type NativeWritable = {
  isTTY?: boolean
  columns?: number
  rows?: number
  write: (chunk: string) => unknown
  on?: (event: "resize", handler: () => void) => unknown
  off?: (event: "resize", handler: () => void) => unknown
}

export type NativeTuiIO = {
  stdin?: NativeReadable
  stdout?: NativeWritable
}

export async function runNativeTuiSlice(input: NativeTuiSliceInput, io: NativeTuiIO = process) {
  const stdin = io.stdin
  const stdout = io.stdout
  if (!stdout) return

  const runtimeInput: NativeTuiSliceInput = { ...input }
  const recordDiagnostic = (eventType: string, data: Record<string, unknown> = {}) => {
    DiagnosticLog.recordProcess(eventType, data)
  }
  const applyWorkspace = (directory?: string) => {
    if (runtimeInput.directory === directory) return
    runtimeInput.directory = directory
    input.events?.setWorkspace?.(directory)
    recordDiagnostic("tui.native.workspaceChanged", { directory })
  }

  const core = await loadNativeTerminalCore()
  const initialModel = input.args.model ? Provider.parseModel(input.args.model) : undefined
  let sessionID = input.args.sessionID
  let sessionInfo: NativeSessionInfoLike | undefined = sessionID
    ? { id: sessionID, directory: runtimeInput.directory }
    : undefined
  let transcript: NativeTranscriptEntry[] = []
  let permissionState: NativePermissionPromptState | undefined
  let questionState: NativeQuestionPromptState | undefined
  let workspaceState: NativeWorkspacePromptState | undefined
  let dialogState: NativeDialogState | undefined
  let currentModel: NativePromptModel | undefined =
    initialModel?.providerID && initialModel?.modelID
      ? { providerID: initialModel.providerID, modelID: initialModel.modelID }
      : undefined
  let currentAgent = input.args.agent ?? "build"
  let currentAgentExplicit = Boolean(input.args.agent)
  let prompt = input.args.prompt ?? ""
  let scrollOffset = 0
  let startupPending = true
  let startupGeneration = 0
  let closed = false
  let submitting = false
  let refreshQueued = false
  let refreshInFlight = false
  let requestInFlight = false
  let pollTimer: ReturnType<typeof setTimeout> | undefined
  let eventUnsubscribe: (() => void) | undefined
  let leaderPending = false
  let firstPaintRecorded = false
  const keymap = nativeKeymap(input.config)
  recordDiagnostic("tui.native.started", {
    directory: runtimeInput.directory,
    sessionID,
    hasEventSource: Boolean(input.events),
  })

  return new Promise<void>((resolve) => {
    const viewport = (): NativeViewport => ({
      width: stdout.columns ?? 80,
      height: stdout.rows ?? 24,
    })

    const paint = () => {
      stdout.write(
        renderNativeFrame({
          viewport: viewport(),
          transcript,
          prompt,
          currentAgent,
          currentModel,
          sessionInfo,
          localDirectory: input.directory,
          dialogState,
          scrollOffset,
          permissionState,
          questionState,
          workspaceState,
        }),
      )
      if (!firstPaintRecorded) {
        firstPaintRecorded = true
        recordDiagnostic("tui.native.firstPaint", viewport())
      }
    }

    const bootstrap = async () => {
      const generation = startupGeneration
      try {
        const startupSession = input.events?.setWorkspace
          ? await resolveNativeStartupSession(runtimeInput).catch(() => undefined)
          : undefined
        if (startupSession?.directory) applyWorkspace(startupSession.directory)
        const nextSessionID = startupSession?.id ?? (await resolveNativeSessionID(runtimeInput))
        const nextSessionInfo =
          startupSession ?? (nextSessionID ? { id: nextSessionID, directory: runtimeInput.directory } : undefined)
        const [nextTranscript, nextPermission, nextQuestion, resolvedModel] = await Promise.all([
          loadNativeTranscript(runtimeInput, nextSessionID),
          nextSessionID ? loadNativePermissionRequest(runtimeInput, nextSessionID) : Promise.resolve(undefined),
          nextSessionID ? loadNativeQuestionRequest(runtimeInput, nextSessionID) : Promise.resolve(undefined),
          currentModel ? Promise.resolve(currentModel) : resolveNativePromptModel(runtimeInput),
        ])
        if (closed || generation !== startupGeneration) return
        sessionID = nextSessionID
        sessionInfo = nextSessionInfo
        transcript = nextTranscript
        permissionState = createNativePermissionState(nextPermission)
        questionState = nextSessionID && !permissionState ? createNativeQuestionState(nextQuestion) : undefined
        currentModel = resolvedModel
        recordDiagnostic("tui.native.startupResolved", {
          sessionID,
          directory: runtimeInput.directory,
          hasModel: Boolean(currentModel),
        })
      } catch (error) {
        if (closed || generation !== startupGeneration) return
        recordDiagnostic("tui.native.startupFailed", { error })
        appendSystemNotice(nativeErrorText(error))
      } finally {
        if (generation === startupGeneration) startupPending = false
        paint()
      }
    }

    const stopPolling = () => {
      if (!pollTimer) return
      clearTimeout(pollTimer)
      pollTimer = undefined
    }

    const appendSystemNotice = (message: string) => {
      const text = message.trim()
      if (!text) return
      transcript = [...transcript, { role: "system", text }]
      paint()
    }

    const syncBlockingState = async (activeSessionID?: string) => {
      permissionState = activeSessionID
        ? createNativePermissionState(await loadNativePermissionRequest(runtimeInput, activeSessionID))
        : undefined
      questionState =
        !permissionState && activeSessionID
          ? createNativeQuestionState(await loadNativeQuestionRequest(runtimeInput, activeSessionID))
          : undefined
    }

    const activateSession = async (nextSession: NativeSessionInfoLike | undefined) => {
      sessionInfo = nextSession
      sessionID = nextSession?.id
      applyWorkspace(nextSession?.directory)
      transcript = await loadNativeTranscript(runtimeInput, sessionID)
      await syncBlockingState(sessionID)
      scrollOffset = 0
      recordDiagnostic("tui.native.sessionActivated", {
        sessionID,
        directory: nextSession?.directory,
      })
    }

    const openWorkspacePicker = async () => {
      recordDiagnostic("tui.native.workspacePickerOpened", {
        currentDirectory: runtimeInput.directory,
      })
      dialogState = undefined
      workspaceState = {
        entries: [],
        selection: 0,
        loading: true,
        localDirectory: input.directory,
        currentDirectory: runtimeInput.directory,
      }
      paint()

      try {
        workspaceState = await loadNativeWorkspaceState({
          input: runtimeInput,
          localDirectory: input.directory,
          currentDirectory: runtimeInput.directory,
        })
      } catch (error) {
        workspaceState = undefined
        recordDiagnostic("tui.native.workspacePickerFailed", { error })
        appendSystemNotice(nativeErrorText(error))
      }

      paint()
    }

    const openWorkspace = async (directory?: string) => {
      recordDiagnostic("tui.native.workspaceSelected", { directory })
      workspaceState = workspaceState
        ? {
            ...workspaceState,
            loading: true,
            currentDirectory: directory,
          }
        : undefined
      paint()
      stopPolling()

      try {
        applyWorkspace(directory)
        const session = await loadNativeLatestRootSession(runtimeInput)
        if (session?.id) await activateSession(session)
        else {
          sessionInfo = undefined
          sessionID = undefined
          transcript = []
          await syncBlockingState(undefined)
        }
        workspaceState = undefined
        paint()
      } catch (error) {
        workspaceState = undefined
        recordDiagnostic("tui.native.workspaceSelectionFailed", { directory, error })
        appendSystemNotice(nativeErrorText(error))
      }
    }

    const openDialog = async (kind: NativeDialogKind, providerID?: string) => {
      recordDiagnostic("tui.native.dialogOpened", { kind, providerID })
      workspaceState = undefined
      dialogState = {
        kind,
        title: nativeDialogTitle(kind, providerID),
        query: "",
        selection: 0,
        options: [],
        loading: true,
      }
      paint()

      try {
        dialogState = await loadNativeDialogState({
          input: runtimeInput,
          kind,
          providerID,
          currentAgent,
          currentModel,
          sessionInfo,
        })
      } catch (error) {
        dialogState = undefined
        recordDiagnostic("tui.native.dialogOpenFailed", { kind, providerID, error })
        appendSystemNotice(nativeErrorText(error))
      }

      paint()
    }

    const applyDialogCommand = async (command: NativeCommandID) => {
      if (command === "dialog.workspace") {
        dialogState = undefined
        await openWorkspacePicker()
        return
      }
      if (command === "dialog.command") {
        await openDialog("command")
        return
      }
      if (command === "dialog.session") {
        await openDialog("session")
        return
      }
      if (command === "dialog.agent") {
        await openDialog("agent")
        return
      }
      if (command === "dialog.provider") {
        await openDialog("provider")
        return
      }
      if (command === "dialog.model") {
        await openDialog("model")
        return
      }
      if (command === "transcript.bottom") {
        dialogState = undefined
        scrollOffset = 0
        paint()
      }
    }

    const selectDialogValue = async (value: NativeDialogValue) => {
      if (value.type === "command") {
        await applyDialogCommand(value.id)
        return
      }

      if (value.type === "provider") {
        await openDialog("model", value.providerID)
        return
      }

      dialogState = undefined
      if (value.type === "model") {
        currentModel = {
          providerID: value.providerID,
          modelID: value.modelID,
        }
        recordDiagnostic("tui.native.modelSelected", currentModel)
        paint()
        return
      }

      if (value.type === "agent") {
        currentAgent = value.name
        currentAgentExplicit = true
        recordDiagnostic("tui.native.agentSelected", { agent: currentAgent })
        paint()
        return
      }

      if (value.type === "session") {
        stopPolling()
        recordDiagnostic("tui.native.sessionSelected", { sessionID: value.sessionID, directory: value.directory })
        const nextSession =
          (await loadNativeSessionInfo(runtimeInput, value.sessionID)) ??
          ({
            id: value.sessionID,
            directory: value.directory,
          } satisfies NativeSessionInfoLike)
        await activateSession(nextSession)
        paint()
      }
    }

    const refreshTranscript = async () => {
      if (!sessionID) return
      if (refreshInFlight) {
        refreshQueued = true
        return
      }

      const activeSessionID = sessionID
      refreshInFlight = true
      try {
        const next = await loadNativeTranscript(runtimeInput, activeSessionID)
        if (sessionID !== activeSessionID) return
        transcript = next
        sessionInfo = (await loadNativeSessionInfo(runtimeInput, activeSessionID)) ?? sessionInfo
        await syncBlockingState(activeSessionID)
        paint()
      } finally {
        refreshInFlight = false
        if (refreshQueued) {
          refreshQueued = false
          queueMicrotask(() => {
            void refreshTranscript()
          })
        }
      }
    }

    const startPolling = () => {
      if (input.events || !sessionID || pollTimer || closed) return

      let attempts = 240
      const activeSessionID = sessionID

      const tick = async () => {
        if (closed || sessionID !== activeSessionID) {
          pollTimer = undefined
          return
        }

        await refreshTranscript()
        attempts -= 1
        if (attempts <= 0) {
          pollTimer = undefined
          return
        }

        const busy = await isNativeSessionBusy(runtimeInput, activeSessionID)
        if (!busy) {
          pollTimer = undefined
          return
        }

        pollTimer = setTimeout(() => {
          void tick()
        }, 250)
        pollTimer.unref?.()
      }

      pollTimer = setTimeout(() => {
        void tick()
      }, 0)
      pollTimer.unref?.()
    }

    const submitPrompt = async (text: string) => {
      recordDiagnostic("tui.native.promptSubmitted", {
        sessionID,
        agent: currentAgentExplicit ? currentAgent : undefined,
        model: currentModel ? `${currentModel.providerID}/${currentModel.modelID}` : undefined,
        length: text.length,
      })
      const previousTranscript = transcript
      transcript = [...transcript, { role: "user", text }]
      prompt = ""
      paint()
      submitting = true

      try {
        const result = await sendNativePrompt(runtimeInput, {
          sessionID,
          text,
          model: currentModel,
          agent: currentAgentExplicit ? currentAgent : undefined,
        })
        sessionID = result.sessionID
        applyWorkspace(result.directory)
        sessionInfo = (await loadNativeSessionInfo(runtimeInput, sessionID)) ?? {
          id: sessionID,
          directory: result.directory,
        }
        await syncBlockingState(sessionID)
        scrollOffset = 0
        recordDiagnostic("tui.native.promptAccepted", { sessionID, directory: result.directory })
        void refreshTranscript()
        startPolling()
      } catch (error) {
        transcript = previousTranscript
        recordDiagnostic("tui.native.promptFailed", { error })
        appendSystemNotice(nativeErrorText(error))
      } finally {
        submitting = false
      }
    }

    const onEvent = (event: { type?: string; properties?: any }) => {
      if (!sessionID || !event?.type) return

      if (event.type === "permission.asked") {
        if (event.properties?.sessionID !== sessionID) return
        recordDiagnostic("tui.native.permissionAsked", {
          sessionID,
          requestID: event.properties?.id,
          permission: event.properties?.permission,
        })
        permissionState = createNativePermissionState(normalizeNativePermissionRequest(event.properties))
        questionState = undefined
        dialogState = undefined
        workspaceState = undefined
        paint()
        return
      }

      if (event.type === "permission.replied") {
        if (event.properties?.sessionID !== sessionID) return
        if (permissionState?.request.id === event.properties?.requestID) permissionState = undefined
        void refreshTranscript()
        return
      }

      if (event.type === "question.asked") {
        if (event.properties?.sessionID !== sessionID) return
        if (permissionState) return
        recordDiagnostic("tui.native.questionAsked", {
          sessionID,
          requestID: event.properties?.id,
        })
        questionState = createNativeQuestionState(normalizeNativeQuestionRequest(event.properties))
        dialogState = undefined
        workspaceState = undefined
        paint()
        return
      }

      if (event.type === "question.replied" || event.type === "question.rejected") {
        if (event.properties?.sessionID !== sessionID) return
        if (questionState?.request.id === event.properties?.requestID) questionState = undefined
        void refreshTranscript()
        return
      }

      if (event.type === "session.error") {
        const eventSessionID = event.properties?.sessionID
        if (eventSessionID && eventSessionID !== sessionID) return
        stopPolling()
        recordDiagnostic("tui.native.sessionError", {
          sessionID: eventSessionID ?? sessionID,
          error: event.properties?.error,
        })
        appendSystemNotice(nativeErrorText(event.properties?.error))
        return
      }

      if (event.type === "session.status") {
        if (event.properties?.sessionID !== sessionID) return
        if (event.properties?.status?.type === "idle") stopPolling()
        else startPolling()
        void refreshTranscript()
        return
      }

      if (event.type === "message.updated") {
        if (event.properties?.info?.sessionID !== sessionID) return
        void refreshTranscript()
        return
      }

      if (event.type === "message.part.updated") {
        if (event.properties?.part?.sessionID !== sessionID) return
        void refreshTranscript()
        return
      }

      if (event.type === "message.part.delta") {
        if (event.properties?.sessionID !== sessionID) return
        void refreshTranscript()
        return
      }

      if (event.type === "message.removed" || event.type === "message.part.removed") {
        if (event.properties?.sessionID !== sessionID) return
        void refreshTranscript()
      }
    }

    const close = () => {
      if (closed) return
      closed = true
      recordDiagnostic("tui.native.stopped", { sessionID, directory: runtimeInput.directory })
      process.off("SIGINT", onSignal)
      process.off("SIGTERM", onSignal)
      stdout.off?.("resize", onResize)
      stdin?.off?.("data", onData)
      stopPolling()
      eventUnsubscribe?.()
      if (stdin?.isTTY) stdin.setRawMode?.(false)
      stdin?.pause?.()
      stdout.write("\x1b[?25h\x1b[?1049l")
      resolve()
    }

    const onData = (chunk: Buffer | string) => {
      for (const action of parseNativeInputActions(chunk, core)) {
        if (action.type === "key" && action.ctrl && (action.name === "c" || action.name === "d")) {
          recordDiagnostic("tui.native.interrupted", { key: action.name })
          close()
          return
        }
        if (action.type === "key" && matchKeymapBinding(keymap, "leader", nativeKeyEvent(action))) {
          leaderPending = true
          paint()
          continue
        }
        const leader = leaderPending
        leaderPending = false
        if (permissionState) {
          if (requestInFlight) {
            paint()
            continue
          }
          const next = advanceNativePermissionState(permissionState, action)
          if (!next) {
            paint()
            continue
          }
          if (next.type === "state") {
            permissionState = next.value
            paint()
            continue
          }
          requestInFlight = true
          recordDiagnostic("tui.native.permissionReply", {
            requestID: permissionState.request.id,
            reply: next.reply,
            hasMessage: Boolean(next.message?.trim()),
          })
          void replyNativePermission(runtimeInput, permissionState.request.id, next.reply, next.message)
            .then(() => {
              permissionState = undefined
              requestInFlight = false
              void refreshTranscript()
            })
            .catch((error) => {
              requestInFlight = false
              appendSystemNotice(nativeErrorText(error))
            })
          paint()
          continue
        }
        if (questionState) {
          if (requestInFlight) {
            paint()
            continue
          }
          const next = advanceNativeQuestionState(questionState, action)
          if (!next) {
            paint()
            continue
          }
          if (next.type === "state") {
            questionState = next.value
            paint()
            continue
          }
          requestInFlight = true
          recordDiagnostic("tui.native.questionReply", {
            requestID: questionState.request.id,
            type: next.type,
          })
          const task =
            next.type === "reply"
              ? replyNativeQuestion(runtimeInput, questionState.request.id, next.answers)
              : rejectNativeQuestion(runtimeInput, questionState.request.id)
          void task
            .then(() => {
              questionState = undefined
              requestInFlight = false
              void refreshTranscript()
            })
            .catch((error) => {
              requestInFlight = false
              appendSystemNotice(nativeErrorText(error))
            })
          paint()
          continue
        }
        if (dialogState) {
          const next = advanceNativeDialogState(dialogState, action)
          if (!next) {
            paint()
            continue
          }
          if (next.type === "state") {
            dialogState = next.value
            paint()
            continue
          }
          if (next.type === "reject") {
            dialogState = undefined
            paint()
            continue
          }
          void selectDialogValue(next.value)
          continue
        }
        if (workspaceState) {
          const next = advanceNativeWorkspaceState(workspaceState, action)
          if (!next) {
            paint()
            continue
          }
          if (next.type === "state") {
            workspaceState = next.value
            paint()
            continue
          }
          if (next.type === "reject") {
            workspaceState = undefined
            paint()
            continue
          }
          void openWorkspace(next.entry.directory)
          continue
        }
        if (action.type === "key") {
          const scrollNext = resolveNativeScrollOffset({
            action,
            keymap,
            leader,
            viewport: viewport(),
            transcript,
            scrollOffset,
          })
          if (scrollNext !== undefined) {
            scrollOffset = scrollNext
            recordDiagnostic("tui.native.scrollChanged", { scrollOffset })
            paint()
            continue
          }
          const decision = resolveCommandKeyDispatch({
            owner: nativeFocusOwner({
              dialogState,
              permissionState,
              questionState,
            }),
            event: nativeKeyEvent(action),
            keymap,
            leader,
            entries: nativeCommandEntries(),
          })
          if (decision.type === "palette") {
            void openDialog("command")
            continue
          }
          if (decision.type === "command") {
            void applyDialogCommand(decision.value as NativeCommandID)
            continue
          }
        }
        if (action.type === "key" && action.name === "enter") {
          const text = prompt.trim()
          const slashDialog = nativeSlashDialogKind(text)
          const loadingResume =
            startupPending && Boolean(input.args.continue || input.args.sessionID || input.args.fork)
          if (!text || submitting || loadingResume) {
            paint()
            continue
          }
          if (slashDialog === "workspace") {
            prompt = ""
            void openWorkspacePicker()
            continue
          }
          if (slashDialog) {
            prompt = ""
            void openDialog(slashDialog)
            continue
          }
          if (startupPending) {
            startupPending = false
            startupGeneration += 1
          }
          void submitPrompt(text)
          continue
        }
        prompt = applyNativePromptAction(prompt, action)
      }
      paint()
    }

    const onSignal = () => close()
    const onResize = () => {
      recordDiagnostic("tui.native.resized", viewport())
      paint()
    }

    stdout.write("\x1b[?1049h\x1b[?25l")
    if (stdin?.isTTY) stdin.setRawMode?.(true)
    stdin?.resume?.()
    stdin?.on?.("data", onData)
    eventUnsubscribe = input.events?.on(onEvent)
    stdout.on?.("resize", onResize)
    process.once("SIGINT", onSignal)
    process.once("SIGTERM", onSignal)
    paint()
    void bootstrap()
  })
}

export async function loadNativeTranscript(
  input: NativeTuiSliceInput,
  sessionID?: string,
): Promise<NativeTranscriptEntry[]> {
  const resolvedSessionID = sessionID ?? (await resolveNativeSessionID(input))
  if (!resolvedSessionID) return []

  try {
    const response = await nativeFetch(
      input,
      nativeUrl(input, `/session/${encodeURIComponent(resolvedSessionID)}/message`, {
        limit: "20",
      }),
    )
    if (!response.ok) return [{ role: "system", text: `Unable to load session ${resolvedSessionID}` }]

    const data = await response.json()
    return Array.isArray(data) ? projectNativeTranscript(data) : []
  } catch {
    return [{ role: "system", text: `Unable to load session ${resolvedSessionID}` }]
  }
}

async function resolveNativeSessionID(input: NativeTuiSliceInput) {
  let sessionID = input.args.sessionID

  if (!sessionID && input.args.continue) {
    try {
      const response = await nativeFetch(input, nativeUrl(input, "/session", { limit: "1" }))
      if (!response.ok) return undefined
      const data = await response.json()
      sessionID = Array.isArray(data) && typeof data[0]?.id === "string" ? data[0].id : undefined
    } catch {
      return undefined
    }
  }

  if (!sessionID) return undefined
  if (!input.args.fork) return sessionID

  try {
    const response = await nativeFetch(input, nativeUrl(input, `/session/${encodeURIComponent(sessionID)}/fork`), {
      method: "POST",
      headers: nativeJsonHeaders(input),
      body: "{}",
    })
    if (!response.ok) return sessionID
    const data = await response.json()
    return typeof data?.id === "string" ? data.id : sessionID
  } catch {
    return sessionID
  }
}

async function resolveNativeStartupSession(input: NativeTuiSliceInput): Promise<NativeSessionInfoLike | undefined> {
  let session = input.args.sessionID ? await loadNativeSessionInfo(input, input.args.sessionID) : undefined

  if (!session && input.args.continue) {
    try {
      const response = await nativeFetch(input, nativeUrl(input, "/session", { limit: "1" }))
      if (!response.ok) return undefined
      const data = await response.json()
      const first = Array.isArray(data) ? data[0] : undefined
      session = normalizeNativeSessionInfo(first)
    } catch {
      return undefined
    }
  }

  if (!session?.id) return undefined
  if (!input.args.fork) return session

  try {
    const response = await nativeFetch(input, nativeUrl(input, `/session/${encodeURIComponent(session.id)}/fork`), {
      method: "POST",
      headers: nativeJsonHeaders(input),
      body: "{}",
    })
    if (!response.ok) return session
    return normalizeNativeSessionInfo(await response.json()) ?? session
  } catch {
    return session
  }
}

async function loadNativeSessionInfo(
  input: NativeTuiSliceInput,
  sessionID: string,
): Promise<NativeSessionInfoLike | undefined> {
  try {
    const response = await nativeFetch(input, nativeUrl(input, `/session/${encodeURIComponent(sessionID)}`))
    if (!response.ok) return { id: sessionID }
    return normalizeNativeSessionInfo(await response.json()) ?? { id: sessionID }
  } catch {
    return { id: sessionID }
  }
}

async function loadNativeLatestRootSession(input: NativeTuiSliceInput): Promise<NativeSessionInfoLike | undefined> {
  try {
    const response = await nativeFetch(input, nativeUrl(input, "/session", { roots: "true", limit: "1" }))
    if (!response.ok) return undefined
    const data = await response.json()
    return normalizeNativeSessionInfo(Array.isArray(data) ? data[0] : undefined)
  } catch {
    return undefined
  }
}

export function projectNativeTranscript(messages: NativeMessageLike[]): NativeTranscriptEntry[] {
  return messages.flatMap((message) => {
    const role = nativeRole(message.info?.role)
    const text = nativeMessageText(message.parts ?? [])
    if (!text) return []
    return [{ role, text }]
  })
}

export function nativeFrameLines(input: {
  viewport: NativeViewport
  transcript: NativeTranscriptEntry[]
  prompt: string
  currentAgent?: string
  currentModel?: NativePromptModel
  sessionInfo?: NativeSessionInfoLike
  localDirectory?: string
  dialogState?: NativeDialogState
  scrollOffset?: number
  permissionState?: NativePermissionPromptState
  questionState?: NativeQuestionPromptState
  workspaceState?: NativeWorkspacePromptState
}) {
  const width = viewportDimension(input.viewport.width, 80, 1, 240)
  const height = viewportDimension(input.viewport.height, 24, 1, 200)
  const header = fitLine(nativeHeaderLine({ ...input, width, height }), width)
  const divider = "-".repeat(width)
  const prompt = fitLine(nativePromptLine(input), width)
  if (height === 1) return [prompt]
  if (height === 2) return [header, prompt]
  const footer = fitLine(nativeFooterLine({ ...input, width }), width)
  if (height === 3) return [header, footer, prompt]
  if (height === 4) return [header, divider, footer, prompt]

  const bodyHeight = height - 5
  const transcript = nativeTranscriptLines(input.transcript, width)
  const overlay = nativeOverlayLines(input, width)
  const visible =
    overlay.length > 0
      ? [...transcript.slice(-Math.max(0, bodyHeight - overlay.length)), ...overlay].slice(0, bodyHeight)
      : nativeVisibleBody(transcript, bodyHeight, input.scrollOffset ?? 0)

  while (visible.length < bodyHeight) visible.unshift("")
  return [header, divider, ...visible, divider, footer, prompt]
}

export function renderNativeFrame(input: {
  viewport: NativeViewport
  transcript: NativeTranscriptEntry[]
  prompt: string
  currentAgent?: string
  currentModel?: NativePromptModel
  sessionInfo?: NativeSessionInfoLike
  localDirectory?: string
  dialogState?: NativeDialogState
  scrollOffset?: number
  permissionState?: NativePermissionPromptState
  questionState?: NativeQuestionPromptState
  workspaceState?: NativeWorkspacePromptState
}) {
  const lines = nativeFrameLines(input)
  return `\x1b[H\x1b[2J${lines.join("\r\n")}`
}

export function parseNativeInputActions(input: Buffer | string, core?: NativeTerminalCore): NativeInputAction[] {
  const text = Buffer.isBuffer(input) ? input.toString("utf8") : input
  const parsed = parseWithNativeCore(text, core)
  if (parsed) return parsed
  return parseFallbackInput(text)
}

export function applyNativePromptAction(prompt: string, action: NativeInputAction) {
  if (action.type === "text") return prompt + action.text
  if (action.type === "key" && action.name === "backspace") return Array.from(prompt).slice(0, -1).join("")
  return prompt
}

async function loadNativeTerminalCore(): Promise<NativeTerminalCore | undefined> {
  try {
    const dynamicImport = new Function("specifier", "return import(specifier)") as (
      specifier: string,
    ) => Promise<NativeTerminalCore>
    return await dynamicImport("@ax-code/terminal")
  } catch {
    return undefined
  }
}

function parseWithNativeCore(input: string, core?: NativeTerminalCore): NativeInputAction[] | undefined {
  if (!core?.parseInputJson) return undefined
  try {
    const events = JSON.parse(core.parseInputJson(input))
    if (!Array.isArray(events)) return undefined
    return events.flatMap(mapNativeInputEvent)
  } catch {
    return undefined
  }
}

function mapNativeInputEvent(event: unknown): NativeInputAction[] {
  if (!event || typeof event !== "object") return []
  if ("type" in event && typeof event.type === "string") {
    const tagged = event as {
      type: string
      name?: unknown
      text?: unknown
      ctrl?: unknown
      alt?: unknown
      meta?: unknown
      shift?: unknown
    }
    if ((tagged.type === "text" || tagged.type === "paste") && typeof tagged.text === "string") {
      return [{ type: "text", text: tagged.text }]
    }
    if (tagged.type === "key" && typeof tagged.name === "string") {
      return [
        {
          type: "key",
          name: tagged.name,
          ctrl: Boolean(tagged.ctrl),
          meta: Boolean(tagged.meta ?? tagged.alt),
          shift: Boolean(tagged.shift),
        },
      ]
    }
    return []
  }
  if ("Text" in event && typeof event.Text === "string") return [{ type: "text", text: event.Text }]
  if ("Paste" in event && typeof event.Paste === "string") return [{ type: "text", text: event.Paste }]
  if ("Key" in event && event.Key && typeof event.Key === "object") {
    const key = event.Key as { name?: unknown; ctrl?: unknown; alt?: unknown; meta?: unknown; shift?: unknown }
    if (typeof key.name !== "string") return []
    return [
      {
        type: "key",
        name: key.name,
        ctrl: Boolean(key.ctrl),
        meta: Boolean(key.meta ?? key.alt),
        shift: Boolean(key.shift),
      },
    ]
  }
  return []
}

function parseFallbackInput(input: string): NativeInputAction[] {
  const actions: NativeInputAction[] = []
  let text = ""

  const flush = () => {
    if (!text) return
    actions.push({ type: "text", text })
    text = ""
  }

  for (let index = 0; index < input.length; index += 1) {
    const ch = input[index]!
    if (ch === "\u001b") {
      flush()
      const sequence = parseNativeEscapeSequence(input, index)
      if (sequence) {
        actions.push(sequence.action)
        index = sequence.nextIndex
        continue
      }
      actions.push({ type: "key", name: "escape" })
      continue
    }
    if (ch === "\r" || ch === "\n") {
      flush()
      actions.push({ type: "key", name: "enter" })
      continue
    }
    if (ch === "\u007f" || ch === "\b") {
      flush()
      actions.push({ type: "key", name: "backspace" })
      continue
    }
    if (ch === "\t") {
      flush()
      actions.push({ type: "key", name: "tab" })
      continue
    }
    const code = ch.charCodeAt(0)
    if (code >= 1 && code <= 26) {
      flush()
      actions.push({ type: "key", name: String.fromCharCode(code + 96), ctrl: true })
      continue
    }
    if (ch >= " ") text += ch
  }

  flush()
  return actions
}

function parseNativeEscapeSequence(input: string, index: number) {
  const rest = input.slice(index)
  const patterns = [
    ["\u001b[A", { type: "key", name: "up" }],
    ["\u001b[B", { type: "key", name: "down" }],
    ["\u001b[C", { type: "key", name: "right" }],
    ["\u001b[D", { type: "key", name: "left" }],
    ["\u001b[H", { type: "key", name: "home" }],
    ["\u001b[F", { type: "key", name: "end" }],
    ["\u001b[5~", { type: "key", name: "pageup" }],
    ["\u001b[6~", { type: "key", name: "pagedown" }],
    ["\u001b[Z", { type: "key", name: "tab", shift: true }],
    ["\u001bOA", { type: "key", name: "up" }],
    ["\u001bOB", { type: "key", name: "down" }],
    ["\u001bOC", { type: "key", name: "right" }],
    ["\u001bOD", { type: "key", name: "left" }],
  ] as const

  for (const [pattern, action] of patterns) {
    if (!rest.startsWith(pattern)) continue
    return {
      action,
      nextIndex: index + pattern.length - 1,
    }
  }
  return undefined
}

function nativeRole(role?: string): NativeTranscriptEntry["role"] {
  if (role === "assistant" || role === "user") return role
  return "system"
}

function nativeMessageText(parts: NativePartLike[]) {
  return parts.map(nativePartText).filter(Boolean).join("\n").trim()
}

function nativePromptLine(input: {
  prompt: string
  dialogState?: NativeDialogState
  permissionState?: NativePermissionPromptState
  questionState?: NativeQuestionPromptState
  workspaceState?: NativeWorkspacePromptState
}) {
  if (input.permissionState) return nativePermissionPromptLine(input.permissionState)
  if (input.questionState) return nativeQuestionPromptLine(input.questionState)
  if (input.dialogState) return nativeDialogPromptLine(input.dialogState)
  if (input.workspaceState) return nativeWorkspacePromptLine(input.workspaceState)
  return `> ${input.prompt}`
}

function nativePermissionPromptLine(state: NativePermissionPromptState) {
  if (state.editingReject) return "> type reject note, Enter to reject, Backspace to edit, Esc to cancel"
  return "> permission pending (y=once, a=always, n=reject, m=note)"
}

function nativeQuestionPromptLine(state: NativeQuestionPromptState) {
  const question = state.request.questions[state.index]
  if (!question) return "> question pending"
  const custom = question.custom !== false
  if (state.editingCustom) return "> type answer, Enter to save, Backspace to edit, Esc to cancel"
  if (question.multiple)
    return custom ? "> toggle 1-9, 0 custom, Enter next, x to reject" : "> toggle 1-9, Enter next, x to reject"
  return custom
    ? "> select 1-9, 0 custom, Enter to confirm, x to reject"
    : "> select 1-9, Enter to confirm, x to reject"
}

function nativeWorkspacePromptLine(state: NativeWorkspacePromptState) {
  if (state.loading) return "> loading workspaces..."
  if (state.entries.length === 0) return "> no workspaces found, x to cancel"
  return "> select 1-9, Enter to open, x to cancel"
}

function nativeOverlayLines(
  input: {
    dialogState?: NativeDialogState
    permissionState?: NativePermissionPromptState
    questionState?: NativeQuestionPromptState
    workspaceState?: NativeWorkspacePromptState
  },
  width: number,
) {
  if (input.permissionState) {
    const patterns = input.permissionState.request.patterns?.filter(Boolean).slice(0, 2) ?? []
    const rejectMessage = input.permissionState.rejectMessage.trim()
    const lines = [
      `permission: ${input.permissionState.request.permission}`,
      ...patterns.map((pattern) => `pattern: ${pattern}`),
      ...(input.permissionState.editingReject
        ? [`note: ${rejectMessage || "(empty)"}`, "reply: Enter reject, Esc cancel"]
        : ["reply: y once, a always, n reject, m note"]),
    ]
    return lines.flatMap((line) => wrapNativeLine(`! ${line}`, width))
  }

  if (input.questionState) {
    const questionState = input.questionState
    const current = questionState.request.questions[questionState.index]
    if (!current) return []
    const total = questionState.request.questions.length
    const visibleOptions = current.options.slice(0, 9)
    const selected = new Set(questionState.answers[questionState.index] ?? [])
    const customValue = currentCustomAnswer(questionState).trim()
    const customSelected = customValue ? selected.has(customValue) : false
    const lines = [
      `question ${questionState.index + 1}/${total}: ${current.header}`,
      current.question,
      ...visibleOptions.map((option, index) => {
        const prefix = index === questionState.selection ? "*" : " "
        const chosen = current.multiple ? `[${selected.has(option.label) ? "x" : " "}] ` : ""
        return `${prefix} ${index + 1}. ${chosen}${option.label}${option.description ? ` - ${option.description}` : ""}`
      }),
      ...(current.custom !== false
        ? [
            `${questionState.selection === visibleOptions.length ? "*" : " "} 0. ${
              current.multiple ? `[${customSelected ? "x" : " "}] ` : ""
            }Type your own answer${customValue ? ` - ${customValue}` : ""}`,
          ]
        : []),
      ...(questionState.editingCustom && customValue ? [`custom: ${customValue}`] : []),
    ]
    return lines.flatMap((line) => wrapNativeLine(`? ${line}`, width))
  }

  if (input.dialogState) {
    return nativeDialogOverlayLines(input.dialogState, width)
  }

  if (input.workspaceState) {
    const workspaceState = input.workspaceState
    const visibleEntries = workspaceState.entries.slice(0, 9)
    const lines = workspaceState.loading
      ? ["workspace: loading..."]
      : [
          "workspace: select target",
          ...visibleEntries.map((entry, index) => {
            const prefix = index === workspaceState.selection ? "*" : " "
            const current = isNativeCurrentWorkspace(workspaceState, entry) ? " (current)" : ""
            return `${prefix} ${index + 1}. ${entry.title}${entry.directory ? ` - ${entry.directory}` : ""}${current}`
          }),
          ...(visibleEntries.length === 0 ? ["no workspaces found"] : []),
          ...(workspaceState.entries.length > visibleEntries.length
            ? [`${workspaceState.entries.length - visibleEntries.length} more hidden`]
            : []),
        ]
    return lines.flatMap((line) => wrapNativeLine(`# ${line}`, width))
  }

  return []
}

function nativePartText(part: NativePartLike) {
  if (part.type === "text") {
    if (part.synthetic || part.ignored) return ""
    return normalizeNativeText(part.text ?? "")
  }
  if (part.type === "reasoning") return normalizeNativeText(part.text ?? "")
  if (part.type === "tool") return nativeToolText(part)
  if (part.type === "file") return `[file] ${normalizeNativeText(part.filename ?? part.url ?? "attachment")}`
  if (part.type === "compaction") return "[compaction]"
  return ""
}

function wrapNativeLine(input: string, width: number) {
  const normalized = normalizeNativeText(input)
  const lines: string[] = []
  for (const raw of normalized.split(/\r?\n/)) {
    if (!raw) {
      lines.push("")
      continue
    }
    let current = ""
    for (const char of Array.from(raw)) {
      if (!current) {
        current = char
        continue
      }
      if (nativeDisplayWidth(current + char) > width) {
        lines.push(current)
        current = char
        continue
      }
      current += char
    }
    if (current) lines.push(current)
  }
  return lines
}

function fitLine(input: string, width: number) {
  let out = ""
  for (const char of Array.from(normalizeNativeText(input))) {
    if (nativeDisplayWidth(out + char) > width) break
    out += char
  }
  const padding = Math.max(0, width - nativeDisplayWidth(out))
  return out + " ".repeat(padding)
}

function nativeToolText(part: NativePartLike) {
  const status = part.state?.status ?? "pending"
  const lines = [`[tool:${part.tool ?? "unknown"}] ${status}`]
  const input = formatNativeStructured(part.state?.input)
  const output = formatNativeStructured(part.state?.output)
  const error = formatNativeStructured(part.state?.error)
  if (input) lines.push(`input: ${input}`)
  if (output) lines.push(`output: ${output}`)
  if (error) lines.push(`error: ${error}`)
  return lines.join("\n")
}

function formatNativeStructured(value: unknown) {
  if (value === undefined || value === null || value === "") return ""
  if (typeof value === "string") return normalizeNativeText(value)
  try {
    return normalizeNativeText(JSON.stringify(value, null, 2))
  } catch {
    return normalizeNativeText(String(value))
  }
}

function normalizeNativeText(input: string) {
  return stripAnsi(input).replaceAll("\t", "  ")
}

function nativeDisplayWidth(input: string) {
  return Bun.stringWidth(normalizeNativeText(input))
}

function label(role: NativeTranscriptEntry["role"]) {
  if (role === "assistant") return "assistant"
  if (role === "user") return "you"
  return "system"
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function viewportDimension(value: number, fallback: number, min: number, max: number) {
  return clamp(Number.isFinite(value) ? Math.floor(value) : fallback, min, max)
}

function nativeHeaderLine(input: {
  width: number
  height: number
  sessionInfo?: NativeSessionInfoLike
  currentModel?: NativePromptModel
  currentAgent?: string
  localDirectory?: string
}) {
  const parts = [`AX Code native (${input.width}x${input.height})`]
  parts.push(
    sessionHeaderWorkspaceLabel({
      sessionDirectory: input.sessionInfo?.directory,
      localDirectory: input.localDirectory ?? input.sessionInfo?.directory ?? "",
      workspaceName:
        input.sessionInfo?.directory && input.sessionInfo.directory !== input.localDirectory
          ? nativeWorkspaceTitle(input.sessionInfo.directory)
          : undefined,
    }),
  )
  if (input.sessionInfo?.title) parts.push(input.sessionInfo.title)
  else if (input.sessionInfo?.id) parts.push(`Session ${input.sessionInfo.id}`)
  return parts.join(" | ")
}

function nativeFooterLine(input: {
  width: number
  currentAgent?: string
  currentModel?: NativePromptModel
  sessionInfo?: NativeSessionInfoLike
  scrollOffset?: number
  dialogState?: NativeDialogState
  permissionState?: NativePermissionPromptState
  questionState?: NativeQuestionPromptState
  workspaceState?: NativeWorkspacePromptState
}) {
  const parts = [] as string[]
  if (input.currentAgent) parts.push(`Agent ${input.currentAgent}`)
  if (input.currentModel) parts.push(`Model ${input.currentModel.providerID}/${input.currentModel.modelID}`)
  const permission = footerPermissionLabel(input.permissionState ? 1 : 0)
  if (permission) parts.push(permission)
  if (input.questionState) parts.push("1 Question")
  if (input.dialogState) parts.push(input.dialogState.title)
  if (input.workspaceState) parts.push("Workspace picker")
  parts.push(input.scrollOffset && input.scrollOffset > 0 ? `Scroll -${input.scrollOffset}` : "Live")
  return parts.join(" | ")
}

function nativeTranscriptLines(transcript: NativeTranscriptEntry[], width: number) {
  return transcript.flatMap((entry) => wrapNativeLine(`${label(entry.role)}: ${entry.text}`, width))
}

function nativeVisibleBody(body: string[], bodyHeight: number, scrollOffset: number) {
  if (bodyHeight <= 0) return []
  const bounded = Math.max(0, scrollOffset)
  const end = Math.max(body.length - bounded, 0)
  const start = Math.max(end - bodyHeight, 0)
  return body.slice(start, end)
}

function nativeBodyHeight(height: number) {
  return height >= 5 ? height - 5 : 0
}

function nativeDialogTitle(kind: NativeDialogKind, providerID?: string) {
  if (kind === "command") return "Commands"
  if (kind === "provider") return "Providers"
  if (kind === "model") return providerID ? `Select model (${providerID})` : "Select model"
  if (kind === "agent") return "Select agent"
  return "Sessions"
}

function nativeDialogPromptLine(state: NativeDialogState) {
  if (state.loading) return "> loading options..."
  return "> type to filter, Up/Down move, Enter open, Backspace edit, Esc cancel"
}

function nativeDialogGroups(state: NativeDialogState) {
  return dialogSelectGroupedOptions({
    options: state.options,
    query: state.query,
    flat: true,
  })
}

function nativeDialogVisibleOptions(state: NativeDialogState) {
  return dialogSelectFlatOptions(nativeDialogGroups(state)) as NativeDialogOption[]
}

function nativeCurrentDialogSelection(options: NativeDialogOption[]) {
  const index = options.findIndex((option) => option.current)
  return index >= 0 ? index : 0
}

function nativeDialogOverlayLines(state: NativeDialogState, width: number) {
  const lines = [`dialog: ${state.title}${state.query ? ` [${state.query}]` : ""}`]
  if (state.loading) return lines.flatMap((line) => wrapNativeLine(`$ ${line}`, width))

  const groups = nativeDialogGroups(state)
  const visible = nativeDialogVisibleOptions(state)
  const shown = visible.slice(0, 9)
  let flatIndex = 0
  for (const [category, options] of groups) {
    const available = (options as NativeDialogOption[])
      .filter((option) => visible.includes(option))
      .slice(0, Math.max(0, 9 - flatIndex))
    if (available.length === 0) continue
    if (category) lines.push(`category: ${category}`)
    for (const option of available) {
      const index = flatIndex
      flatIndex += 1
      const prefix = index === state.selection ? "*" : " "
      const current = option.current ? " (current)" : ""
      lines.push(
        `${prefix} ${index + 1}. ${option.title}${option.description ? ` - ${option.description}` : ""}${current}`,
      )
    }
    if (flatIndex >= 9) break
  }
  if (shown.length === 0) lines.push("no matching options")
  if (visible.length > shown.length) lines.push(`${visible.length - shown.length} more hidden`)
  return lines.flatMap((line) => wrapNativeLine(`$ ${line}`, width))
}

function advanceNativeDialogState(state: NativeDialogState, action: NativeInputAction) {
  if (state.loading) {
    if (action.type === "key" && action.name === "escape") return { type: "reject" as const }
    return undefined
  }

  const visible = nativeDialogVisibleOptions(state)
  const currentCount = visible.length
  if (action.type === "key" && action.name === "escape") return { type: "reject" as const }
  if (action.type === "key" && action.name === "enter") {
    const option = visible[state.selection]
    if (!option || option.disabled) return undefined
    return { type: "select" as const, value: option.value }
  }
  if (action.type === "key" && action.name === "up") {
    return {
      type: "state" as const,
      value: {
        ...state,
        selection: dialogSelectClampIndex(state.selection - 1, currentCount),
      },
    }
  }
  if (action.type === "key" && action.name === "down") {
    return {
      type: "state" as const,
      value: {
        ...state,
        selection: dialogSelectClampIndex(state.selection + 1, currentCount),
      },
    }
  }
  if (action.type === "key" && action.name === "home") {
    return {
      type: "state" as const,
      value: {
        ...state,
        selection: 0,
      },
    }
  }
  if (action.type === "key" && action.name === "end") {
    return {
      type: "state" as const,
      value: {
        ...state,
        selection: dialogSelectClampIndex(currentCount - 1, currentCount),
      },
    }
  }
  if (action.type === "key" && action.name === "backspace") {
    const query = Array.from(state.query).slice(0, -1).join("")
    const count = nativeDialogVisibleOptions({ ...state, query }).length
    return {
      type: "state" as const,
      value: {
        ...state,
        query,
        selection: dialogSelectClampIndex(state.selection, count),
      },
    }
  }
  if (action.type !== "text") return undefined

  let next = state
  for (const char of Array.from(action.text)) {
    const numeric = Number.parseInt(char, 10)
    if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 9) {
      next = {
        ...next,
        selection: dialogSelectClampIndex(numeric - 1, nativeDialogVisibleOptions(next).length),
      }
      continue
    }
    next = {
      ...next,
      query: next.query + char,
    }
    next = {
      ...next,
      selection: dialogSelectClampIndex(next.selection, nativeDialogVisibleOptions(next).length),
    }
  }
  return next === state ? undefined : { type: "state" as const, value: next }
}

async function loadNativeDialogState(input: {
  input: NativeTuiSliceInput
  kind: NativeDialogKind
  providerID?: string
  currentAgent?: string
  currentModel?: NativePromptModel
  sessionInfo?: NativeSessionInfoLike
}): Promise<NativeDialogState> {
  if (input.kind === "command") {
    const options = [
      {
        title: "Switch workspace",
        value: { type: "command", id: "dialog.workspace" },
        category: "Navigate",
      },
      {
        title: "Open session",
        value: { type: "command", id: "dialog.session" },
        category: "Navigate",
      },
      {
        title: "Switch agent",
        value: { type: "command", id: "dialog.agent" },
        category: "Settings",
      },
      {
        title: "Switch provider",
        value: { type: "command", id: "dialog.provider" },
        category: "Settings",
      },
      {
        title: "Switch model",
        value: { type: "command", id: "dialog.model" },
        category: "Settings",
      },
      {
        title: "Jump to latest output",
        value: { type: "command", id: "transcript.bottom" },
        category: "Transcript",
      },
    ] satisfies NativeDialogOption[]
    return {
      kind: "command",
      title: nativeDialogTitle("command"),
      query: "",
      selection: 0,
      loading: false,
      options,
    }
  }

  if (input.kind === "provider" || input.kind === "model") {
    const response = await nativeFetch(input.input, nativeUrl(input.input, "/provider"))
    if (!response.ok) throw new Error(await nativeResponseError(response))
    const data = await response.json()
    const providers = Array.isArray(data?.all) ? data.all : []
    const connected = new Set(
      Array.isArray(data?.connected) ? data.connected.filter((item: unknown) => typeof item === "string") : [],
    )
    if (input.kind === "provider") {
      const options = providers.map((provider: any) => ({
        title: String(provider?.name ?? provider?.id ?? "provider"),
        value: { type: "provider", providerID: String(provider?.id ?? "") },
        category: connected.has(String(provider?.id ?? "")) ? "Connected" : "Available",
        description: connected.has(String(provider?.id ?? "")) ? "Connected" : undefined,
        current: input.currentModel?.providerID === provider?.id,
      })) satisfies NativeDialogOption[]
      return {
        kind: "provider",
        title: nativeDialogTitle("provider"),
        query: "",
        selection: nativeCurrentDialogSelection(options),
        loading: false,
        options,
      }
    }

    const options = providers.flatMap((provider: any) => {
      const providerID = String(provider?.id ?? "")
      if (!providerID || (input.providerID && providerID !== input.providerID)) return []
      return Object.entries(provider?.models ?? {}).flatMap(([modelID, info]) => {
        const model = info as Record<string, any>
        if (model?.status === "deprecated") return []
        return [
          {
            title: String(model?.name ?? modelID),
            value: { type: "model", providerID, modelID } satisfies NativeDialogValue,
            category: String(provider?.name ?? providerID),
            description: connected.has(providerID) ? undefined : "Provider not connected",
            current: input.currentModel?.providerID === providerID && input.currentModel?.modelID === modelID,
          },
        ]
      })
    })
    return {
      kind: "model",
      title: nativeDialogTitle("model", input.providerID),
      query: "",
      selection: nativeCurrentDialogSelection(options),
      loading: false,
      options,
    }
  }

  if (input.kind === "agent") {
    const response = await nativeFetch(input.input, nativeUrl(input.input, "/agent"))
    if (!response.ok) throw new Error(await nativeResponseError(response))
    const data = await response.json()
    const agents = Array.isArray(data) ? data : []
    const options = agents.flatMap((item: any) => {
      const name = typeof item?.name === "string" ? item.name : undefined
      if (!name) return []
      const tier = Agent.resolveTier(item)
      return [
        {
          title: String(item?.displayName ?? name),
          value: { type: "agent", name } satisfies NativeDialogValue,
          category: tier === "core" ? "Core" : "Specialist",
          description: typeof item?.description === "string" ? item.description : undefined,
          current: input.currentAgent === name,
        },
      ]
    }) satisfies NativeDialogOption[]
    return {
      kind: "agent",
      title: nativeDialogTitle("agent"),
      query: "",
      selection: nativeCurrentDialogSelection(options),
      loading: false,
      options,
    }
  }

  const response = await nativeFetch(input.input, nativeUrl(input.input, "/session", { roots: "true", limit: "30" }))
  if (!response.ok) throw new Error(await nativeResponseError(response))
  const data = await response.json()
  const sessions = Array.isArray(data) ? data : []
  const today = new Date().toDateString()
  const options = sessions.flatMap((item: any) => {
    const session = normalizeNativeSessionInfo(item)
    if (!session?.id) return []
    const updated = typeof item?.time?.updated === "number" ? item.time.updated : undefined
    const category = updated
      ? new Date(updated).toDateString() === today
        ? "Today"
        : new Date(updated).toDateString()
      : ""
    return [
      {
        title: session.title ?? session.id,
        value: { type: "session", sessionID: session.id, directory: session.directory } satisfies NativeDialogValue,
        category,
        description: session.directory,
        current: input.sessionInfo?.id === session.id,
      },
    ]
  }) satisfies NativeDialogOption[]
  return {
    kind: "session",
    title: nativeDialogTitle("session"),
    query: "",
    selection: nativeCurrentDialogSelection(options),
    loading: false,
    options,
  }
}

function nativeFocusOwner(input: {
  dialogState?: NativeDialogState
  permissionState?: NativePermissionPromptState
  questionState?: NativeQuestionPromptState
}) {
  return resolveFocusOwner({
    prompt: {
      visible: true,
      disabled: Boolean(input.dialogState || input.permissionState || input.questionState),
    },
    dialog: input.dialogState?.kind,
    permissionSessionID: input.permissionState?.request.sessionID,
    questionSessionID: input.questionState?.request.sessionID,
  })
}

function nativeCommandEntries() {
  return [
    {
      value: "dialog.model",
      keybind: "model_list",
      owners: ["prompt", "app"] as const,
    },
    {
      value: "dialog.agent",
      keybind: "agent_list",
      owners: ["prompt", "app"] as const,
    },
  ]
}

function nativeSlashDialogKind(text: string): NativeDialogKind | "workspace" | undefined {
  const normalized = text.trim().toLowerCase()
  if (normalized === "/workspace" || normalized === "/workspaces") return "workspace"
  if (normalized === "/session" || normalized === "/sessions") return "session"
  if (normalized === "/agent" || normalized === "/agents") return "agent"
  if (normalized === "/provider" || normalized === "/providers") return "provider"
  if (normalized === "/model" || normalized === "/models") return "model"
  if (normalized === "/command" || normalized === "/commands") return "command"
  return undefined
}

function nativeKeymap(config: TuiConfig.Info): Keymap {
  return parseKeymapBindings(
    Object.fromEntries(
      Object.entries(config.keybinds ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    ),
  )
}

function nativeKeyEvent(action: Extract<NativeInputAction, { type: "key" }>) {
  return {
    name: action.name,
    ctrl: Boolean(action.ctrl),
    meta: Boolean(action.meta),
    shift: Boolean(action.shift),
  }
}

function resolveNativeScrollOffset(input: {
  action: Extract<NativeInputAction, { type: "key" }>
  keymap: Keymap
  leader: boolean
  viewport: NativeViewport
  transcript: NativeTranscriptEntry[]
  scrollOffset: number
}) {
  const width = viewportDimension(input.viewport.width, 80, 1, 240)
  const bodyHeight = nativeBodyHeight(viewportDimension(input.viewport.height, 24, 1, 200))
  if (bodyHeight <= 0) return undefined
  const totalLines = nativeTranscriptLines(input.transcript, width).length
  const maxOffset = Math.max(0, totalLines - bodyHeight)
  const event = nativeKeyEvent(input.action)
  const lineUp = input.action.name === "up" || matchKeymapBinding(input.keymap, "messages_line_up", event, input.leader)
  const lineDown =
    input.action.name === "down" || matchKeymapBinding(input.keymap, "messages_line_down", event, input.leader)
  const pageUp =
    input.action.name === "pageup" || matchKeymapBinding(input.keymap, "messages_page_up", event, input.leader)
  const pageDown =
    input.action.name === "pagedown" || matchKeymapBinding(input.keymap, "messages_page_down", event, input.leader)
  const first = input.action.name === "home" || matchKeymapBinding(input.keymap, "messages_first", event, input.leader)
  const last = input.action.name === "end" || matchKeymapBinding(input.keymap, "messages_last", event, input.leader)

  if (first) return maxOffset
  if (last) return 0
  if (pageUp) return clamp(input.scrollOffset + bodyHeight, 0, maxOffset)
  if (pageDown) return clamp(input.scrollOffset - bodyHeight, 0, maxOffset)
  if (lineUp) return clamp(input.scrollOffset + 1, 0, maxOffset)
  if (lineDown) return clamp(input.scrollOffset - 1, 0, maxOffset)
  return undefined
}

async function sendNativePrompt(
  input: NativeTuiSliceInput,
  submit: {
    sessionID?: string
    text: string
    model?: NativePromptModel
    agent?: string
  },
) {
  const session = submit.sessionID ? { id: submit.sessionID } : await createNativeSession(input)
  const sessionID = session.id
  const response = await nativeFetch(
    input,
    nativeUrl(input, `/session/${encodeURIComponent(sessionID)}/prompt_async`),
    {
      method: "POST",
      headers: nativeJsonHeaders(input),
      body: JSON.stringify({
        ...(submit.model ? { model: submit.model } : {}),
        ...(submit.agent ? { agent: submit.agent, userSelectedAgent: true } : {}),
        parts: [{ type: "text", text: submit.text }],
      }),
    },
  )

  if (!response.ok) throw new Error(await nativeResponseError(response))
  return { sessionID, directory: session.directory }
}

async function createNativeSession(input: NativeTuiSliceInput) {
  const response = await nativeFetch(input, nativeUrl(input, "/session"), {
    method: "POST",
    headers: nativeJsonHeaders(input),
    body: "{}",
  })

  if (!response.ok) throw new Error(await nativeResponseError(response))
  const data = await response.json()
  const session = normalizeNativeSessionInfo(data)
  if (!session?.id) throw new Error("Creating a session returned no session id")
  return session
}

async function loadNativePermissionRequest(input: NativeTuiSliceInput, sessionID: string) {
  try {
    const response = await nativeFetch(input, nativeUrl(input, "/permission"))
    if (!response.ok) return undefined
    const data = await response.json()
    if (!Array.isArray(data)) return undefined
    return data.map(normalizeNativePermissionRequest).find((request) => request.sessionID === sessionID)
  } catch {
    return undefined
  }
}

async function loadNativeQuestionRequest(input: NativeTuiSliceInput, sessionID: string) {
  try {
    const response = await nativeFetch(input, nativeUrl(input, "/question"))
    if (!response.ok) return undefined
    const data = await response.json()
    if (!Array.isArray(data)) return undefined
    return data.map(normalizeNativeQuestionRequest).find((request) => request.sessionID === sessionID)
  } catch {
    return undefined
  }
}

async function replyNativePermission(
  input: NativeTuiSliceInput,
  requestID: string,
  reply: "once" | "always" | "reject",
  message?: string,
) {
  const response = await nativeFetch(input, nativeUrl(input, `/permission/${encodeURIComponent(requestID)}/reply`), {
    method: "POST",
    headers: nativeJsonHeaders(input),
    body: JSON.stringify({
      reply,
      ...(message ? { message } : {}),
    }),
  })
  if (!response.ok) throw new Error(await nativeResponseError(response))
}

async function replyNativeQuestion(input: NativeTuiSliceInput, requestID: string, answers: string[][]) {
  const response = await nativeFetch(input, nativeUrl(input, `/question/${encodeURIComponent(requestID)}/reply`), {
    method: "POST",
    headers: nativeJsonHeaders(input),
    body: JSON.stringify({ answers }),
  })
  if (!response.ok) throw new Error(await nativeResponseError(response))
}

async function rejectNativeQuestion(input: NativeTuiSliceInput, requestID: string) {
  const response = await nativeFetch(input, nativeUrl(input, `/question/${encodeURIComponent(requestID)}/reject`), {
    method: "POST",
    headers: nativeJsonHeaders(input),
    body: "{}",
  })
  if (!response.ok) throw new Error(await nativeResponseError(response))
}

function normalizeNativePermissionRequest(input: any): NativePermissionRequest {
  return {
    id: String(input?.id ?? ""),
    sessionID: String(input?.sessionID ?? ""),
    permission: String(input?.permission ?? "unknown"),
    patterns: Array.isArray(input?.patterns) ? input.patterns.filter((item: unknown) => typeof item === "string") : [],
    metadata: input?.metadata && typeof input.metadata === "object" ? input.metadata : {},
    always: Array.isArray(input?.always) ? input.always.filter((item: unknown) => typeof item === "string") : [],
  }
}

function normalizeNativeSessionInfo(input: any): NativeSessionInfoLike | undefined {
  const id = typeof input?.id === "string" ? input.id : undefined
  if (!id) return undefined
  return {
    id,
    directory: typeof input?.directory === "string" ? input.directory : undefined,
    title: typeof input?.title === "string" ? input.title : undefined,
  }
}

function normalizeNativeQuestionRequest(input: any): NativeQuestionRequest {
  return {
    id: String(input?.id ?? ""),
    sessionID: String(input?.sessionID ?? ""),
    questions: Array.isArray(input?.questions)
      ? input.questions.map((question: any) => ({
          header: String(question?.header ?? ""),
          question: String(question?.question ?? ""),
          options: Array.isArray(question?.options)
            ? question.options
                .filter((option: any) => option && typeof option.label === "string")
                .map((option: any) => ({
                  label: option.label,
                  description: typeof option.description === "string" ? option.description : undefined,
                }))
            : [],
          multiple: question?.multiple === true,
          custom: question?.custom !== false,
        }))
      : [],
  }
}

function createNativeQuestionState(request?: NativeQuestionRequest): NativeQuestionPromptState | undefined {
  if (!request || request.questions.length === 0) return undefined
  const answers: string[][] = request.questions.map(() => [])
  return {
    request,
    index: 0,
    answers,
    selection: 0,
    customAnswers: request.questions.map(() => ""),
    editingCustom: false,
  } satisfies NativeQuestionPromptState
}

function createNativePermissionState(request?: NativePermissionRequest): NativePermissionPromptState | undefined {
  if (!request) return undefined
  return {
    request,
    editingReject: false,
    rejectMessage: "",
  } satisfies NativePermissionPromptState
}

async function loadNativeWorkspaceState(input: {
  input: NativeTuiSliceInput
  localDirectory?: string
  currentDirectory?: string
}): Promise<NativeWorkspacePromptState> {
  const response = await nativeFetch(input.input, nativeUrl(input.input, "/worktree"))
  if (!response.ok) throw new Error(await nativeResponseError(response))
  const data = await response.json()
  const directories = Array.isArray(data) ? data.filter((item): item is string => typeof item === "string") : []
  const entries = [
    {
      id: "local",
      title: "Local workspace",
      directory: input.localDirectory,
    },
    ...dedupeNativeWorkspaces(directories)
      .filter((directory) => directory !== input.localDirectory)
      .map((directory) => ({
        id: directory,
        title: nativeWorkspaceTitle(directory),
        directory,
      })),
  ]
  return {
    entries,
    selection: selectNativeWorkspace(entries, input.currentDirectory, input.localDirectory),
    loading: false,
    localDirectory: input.localDirectory,
    currentDirectory: input.currentDirectory,
  }
}

function advanceNativePermissionState(state: NativePermissionPromptState, action: NativeInputAction) {
  if (state.editingReject) {
    if (action.type === "text") {
      return {
        type: "state" as const,
        value: {
          ...state,
          rejectMessage: state.rejectMessage + action.text,
        },
      }
    }

    if (action.type === "key" && action.name === "backspace") {
      return {
        type: "state" as const,
        value: {
          ...state,
          rejectMessage: Array.from(state.rejectMessage).slice(0, -1).join(""),
        },
      }
    }

    if (action.type === "key" && action.name === "escape") {
      return {
        type: "state" as const,
        value: {
          ...state,
          editingReject: false,
          rejectMessage: "",
        },
      }
    }

    if (action.type === "key" && action.name === "enter") {
      const message = state.rejectMessage.trim()
      return {
        type: "reply" as const,
        reply: "reject" as const,
        message: message || undefined,
      }
    }

    return undefined
  }

  if (action.type !== "text") return undefined

  let next = state
  for (const char of Array.from(action.text)) {
    const lower = char.toLowerCase()
    if (lower === "y") return { type: "reply" as const, reply: "once" as const }
    if (lower === "a") return { type: "reply" as const, reply: "always" as const }
    if (lower === "n") return { type: "reply" as const, reply: "reject" as const }
    if (lower === "m") {
      next = {
        ...next,
        editingReject: true,
        rejectMessage: "",
      }
      continue
    }
    if (!next.editingReject) continue
    next = {
      ...next,
      rejectMessage: next.rejectMessage + char,
    }
  }

  return next === state ? undefined : { type: "state" as const, value: next }
}

function advanceNativeWorkspaceState(state: NativeWorkspacePromptState, action: NativeInputAction) {
  if (state.loading) {
    if (action.type === "key" && action.name === "escape") return { type: "reject" as const }
    if (action.type === "text" && nativeActionChars(action).includes("x")) return { type: "reject" as const }
    return undefined
  }

  const visibleEntries = state.entries.slice(0, 9)
  if (action.type === "text") {
    let next = state
    for (const char of Array.from(action.text)) {
      const lower = char.toLowerCase()
      if (lower === "x") return { type: "reject" as const }
      const numeric = Number.parseInt(char, 10)
      if (!Number.isInteger(numeric) || numeric < 1 || numeric > visibleEntries.length) continue
      next = {
        ...next,
        selection: numeric - 1,
      }
    }
    return next === state ? undefined : { type: "state" as const, value: next }
  }

  if (action.type === "key" && action.name === "escape") return { type: "reject" as const }
  if (action.type !== "key" || action.name !== "enter") return undefined

  const entry = visibleEntries[state.selection]
  if (!entry) return undefined
  return {
    type: "select" as const,
    entry,
  }
}

function isNativeWorkspaceCommand(text: string) {
  const normalized = text.trim().toLowerCase()
  return normalized === "/workspace" || normalized === "/workspaces"
}

function nativeActionChars(action: NativeInputAction) {
  if (action.type !== "text") return []
  return Array.from(action.text.toLowerCase())
}

function nativeWorkspaceTitle(directory: string) {
  const parts = directory.split(/[\\/]/).filter(Boolean)
  return parts.at(-1) ?? directory
}

function dedupeNativeWorkspaces(directories: string[]) {
  const seen = new Set<string>()
  return directories.filter((directory) => {
    if (seen.has(directory)) return false
    seen.add(directory)
    return true
  })
}

function selectNativeWorkspace(entries: NativeWorkspaceEntry[], currentDirectory?: string, localDirectory?: string) {
  if (!currentDirectory || currentDirectory === localDirectory) return 0
  const found = entries.findIndex((entry) => entry.directory === currentDirectory)
  return found >= 0 ? found : 0
}

function isNativeCurrentWorkspace(state: NativeWorkspacePromptState, entry: NativeWorkspaceEntry) {
  if (entry.id === "local") return !state.currentDirectory || state.currentDirectory === state.localDirectory
  return Boolean(entry.directory && state.currentDirectory === entry.directory)
}

function cloneNativeQuestionAnswers(state: NativeQuestionPromptState) {
  return state.answers.map((answer) => [...answer])
}

function cloneNativeQuestionCustomAnswers(state: NativeQuestionPromptState) {
  return [...(state.customAnswers ?? state.request.questions.map(() => ""))]
}

function currentCustomAnswer(state: NativeQuestionPromptState) {
  return state.customAnswers?.[state.index] ?? ""
}

function nextNativeQuestionState(
  state: NativeQuestionPromptState,
  updates: Partial<Pick<NativeQuestionPromptState, "answers" | "customAnswers" | "editingCustom" | "selection">>,
) {
  return {
    ...state,
    ...updates,
  }
}

function completeNativeQuestion(
  state: NativeQuestionPromptState,
  answers: string[][],
  customAnswers: string[] = cloneNativeQuestionCustomAnswers(state),
) {
  if (state.index >= state.request.questions.length - 1) {
    return {
      type: "reply" as const,
      answers,
    }
  }

  return {
    type: "state" as const,
    value: {
      ...state,
      answers,
      customAnswers,
      index: state.index + 1,
      selection: 0,
      editingCustom: false,
    },
  }
}

function advanceNativeQuestionState(state: NativeQuestionPromptState, action: NativeInputAction) {
  const question = state.request.questions[state.index]
  if (!question) return undefined
  const visibleOptions = question.options.slice(0, 9)
  const customEnabled = question.custom !== false
  const customIndex = customEnabled ? visibleOptions.length : -1

  if (state.editingCustom) {
    if (action.type === "text") {
      const customAnswers = cloneNativeQuestionCustomAnswers(state)
      customAnswers[state.index] = `${customAnswers[state.index] ?? ""}${action.text}`
      return {
        type: "state" as const,
        value: nextNativeQuestionState(state, { customAnswers }),
      }
    }

    if (action.type === "key" && action.name === "backspace") {
      const customAnswers = cloneNativeQuestionCustomAnswers(state)
      customAnswers[state.index] = Array.from(customAnswers[state.index] ?? "")
        .slice(0, -1)
        .join("")
      return {
        type: "state" as const,
        value: nextNativeQuestionState(state, { customAnswers }),
      }
    }

    if (action.type === "key" && action.name === "escape") {
      return {
        type: "state" as const,
        value: nextNativeQuestionState(state, { editingCustom: false }),
      }
    }

    if (action.type !== "key" || action.name !== "enter") return undefined

    const answers = cloneNativeQuestionAnswers(state)
    const customAnswers = cloneNativeQuestionCustomAnswers(state)
    const previous = currentCustomAnswer(state)
    const value = previous.trim()
    customAnswers[state.index] = value
    answers[state.index] = (answers[state.index] ?? []).filter((item) => item !== previous)

    if (!value) {
      return {
        type: "state" as const,
        value: nextNativeQuestionState(state, {
          answers,
          customAnswers,
          editingCustom: false,
        }),
      }
    }

    if (question.multiple) {
      answers[state.index] = [...answers[state.index], value]
      return {
        type: "state" as const,
        value: nextNativeQuestionState(state, {
          answers,
          customAnswers,
          editingCustom: false,
          selection: customIndex >= 0 ? customIndex : state.selection,
        }),
      }
    }

    answers[state.index] = [value]
    return completeNativeQuestion(state, answers, customAnswers)
  }

  if (action.type === "text") {
    let next = state
    for (const char of Array.from(action.text)) {
      const lower = char.toLowerCase()
      if (lower === "x") return { type: "reject" as const }
      if (lower === "0" && customEnabled) {
        next = nextNativeQuestionState(next, {
          selection: customIndex,
          editingCustom: true,
        })
        continue
      }
      const numeric = Number.parseInt(char, 10)
      if (!Number.isInteger(numeric) || numeric < 1 || numeric > visibleOptions.length) continue
      const index = numeric - 1
      if (!question.multiple) {
        next = nextNativeQuestionState(next, { selection: index })
        continue
      }
      const answers = cloneNativeQuestionAnswers(next)
      const selected = visibleOptions[index]?.label
      if (!selected) continue
      const currentAnswers = answers[next.index] ?? []
      answers[next.index] = currentAnswers.includes(selected)
        ? currentAnswers.filter((item) => item !== selected)
        : [...currentAnswers, selected]
      next = nextNativeQuestionState(next, { answers, selection: index })
    }
    return next === state ? undefined : { type: "state" as const, value: next }
  }

  if (action.type === "key" && action.name === "escape") return { type: "reject" as const }
  if (action.type !== "key" || action.name !== "enter") return undefined
  if (question.multiple) {
    const answers = cloneNativeQuestionAnswers(state)
    if ((answers[state.index] ?? []).length === 0) return undefined
    return completeNativeQuestion(state, answers)
  }

  if (customEnabled && state.selection === customIndex) {
    return {
      type: "state" as const,
      value: nextNativeQuestionState(state, { editingCustom: true }),
    }
  }

  const selected = visibleOptions[state.selection]?.label
  if (!selected) {
    if (visibleOptions.length === 0) return customEnabled ? undefined : { type: "reject" as const }
    return undefined
  }
  const answers = cloneNativeQuestionAnswers(state)
  answers[state.index] = [selected]
  return completeNativeQuestion(state, answers)
}

async function resolveNativePromptModel(input: NativeTuiSliceInput) {
  if (input.args.model) {
    const { providerID, modelID } = Provider.parseModel(input.args.model)
    if (providerID && modelID) return { providerID, modelID }
  }

  const config = await nativeFetch(input, nativeUrl(input, "/config"))
    .then((response) => (response.ok ? response.json() : undefined))
    .catch(() => undefined)

  const configuredModel = typeof config?.model === "string" ? Provider.parseModel(config.model) : undefined
  if (configuredModel?.providerID && configuredModel?.modelID) {
    return configuredModel
  }

  const providers = await nativeFetch(input, nativeUrl(input, "/config/providers"))
    .then((response) => (response.ok ? response.json() : undefined))
    .catch(() => undefined)

  const firstProvider = Array.isArray(providers?.providers) ? providers.providers[0] : undefined
  const providerID = typeof firstProvider?.id === "string" ? firstProvider.id : undefined
  const defaultModel =
    providerID && typeof providers?.default?.[providerID] === "string"
      ? providers.default[providerID]
      : Object.keys(firstProvider?.models ?? {})[0]

  if (!providerID || !defaultModel) return undefined
  return {
    providerID,
    modelID: defaultModel,
  }
}

async function isNativeSessionBusy(input: NativeTuiSliceInput, sessionID: string) {
  try {
    const response = await nativeFetch(input, nativeUrl(input, "/session/status"))
    if (!response.ok) return true
    const data = (await response.json()) as Record<string, { type?: string } | undefined>
    return data[sessionID]?.type !== "idle"
  } catch {
    return true
  }
}

function nativeUrl(input: NativeTuiSliceInput, pathname: string, query?: Record<string, string>) {
  const url = new URL(pathname, input.url)
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value)
  }
  if (input.directory) url.searchParams.set("directory", input.directory)
  return url
}

function nativeJsonHeaders(input: NativeTuiSliceInput) {
  return {
    "content-type": "application/json",
    ...normalizeHeaders(input.headers),
  }
}

function recordNativeHttpDiagnostic(
  eventType: "tui.native.httpError" | "tui.native.httpException",
  url: URL,
  init: RequestInit | undefined,
  extra: Record<string, unknown> = {},
) {
  DiagnosticLog.recordProcess(eventType, {
    method: init?.method ?? "GET",
    pathname: url.pathname,
    ...extra,
  })
}

function nativeFetch(input: NativeTuiSliceInput, url: URL, init?: RequestInit) {
  return (input.fetch ?? fetch)(url, {
    ...init,
    headers: {
      ...normalizeHeaders(input.headers),
      ...normalizeHeaders(init?.headers),
    },
  })
    .then((response) => {
      if (!response.ok) {
        recordNativeHttpDiagnostic("tui.native.httpError", url, init, {
          status: response.status,
        })
      }
      return response
    })
    .catch((error) => {
      recordNativeHttpDiagnostic("tui.native.httpException", url, init, { error })
      throw error
    })
}

function normalizeHeaders(headers: HeadersInit | undefined) {
  if (!headers) return {}
  return Object.fromEntries(new Headers(headers).entries())
}

async function nativeResponseError(response: Response) {
  const text = await response.text().catch(() => "")
  if (!text) return `Request failed with ${response.status}`

  try {
    const parsed = JSON.parse(text)
    return nativeErrorText(parsed?.error ?? parsed?.message ?? parsed)
  } catch {
    return `${response.status}: ${text}`
  }
}

function nativeErrorText(error: unknown) {
  if (!error) return "Unknown error"
  if (typeof error === "string") return error
  if (error instanceof Error) return error.message
  if (typeof error === "object") {
    const record = error as Record<string, any>
    return record.data?.message ?? record.message ?? record.error?.message ?? record.error ?? JSON.stringify(error)
  }
  return String(error)
}
