import { produce } from "solid-js/store"
import { DiagnosticLog } from "@/debug/diagnostic-log"
import { iife } from "@/util/iife"
import { withTimeout } from "@/util/timeout"
import { WorkMode } from "@/mode/work-mode"
import { providerModelKey } from "@/provider/model-key"
import { AX_ENGINE_PROVIDER_ID } from "@/provider/ax-engine/constants"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { directoryRequestHeaders } from "@tui/util/request-headers"
import { blurRenderable } from "@tui/util/renderable-safety"
import { scheduleTuiTimeout } from "@tui/util/timer"
import { upsert } from "../../context/sync-util"
import { axEngineDownloadChip } from "../ax-engine-downloads-view-model"
import { isQueueableStatus } from "./follow-up-queue"
import { enqueueFollowUp } from "./follow-up-queue-store"
import { assign } from "./part"
import { SUBMIT_ACCEPT_TIMEOUT_MS } from "./prompt-config"
import { submitPromptRoute } from "./prompt-submit"
import type { AsyncSessionRoute } from "./prompt-types"
import { createSubmitAbortError, isSubmitAbortError, type SubmitStage } from "./submit-state"
import { isPromptExitCommand, promptSubmissionView } from "./view-model"
import type { PromptInfo } from "./history"

type PromptSubmitStore = {
  prompt: PromptInfo
  mode: "normal" | "shell"
  extmarkToPartIndex: Map<number, number>
}

export type PromptSubmitHost = {
  input: any
  store: PromptSubmitStore
  setStore: (...args: any[]) => void
  setExpandedPastes: (value: Set<number>) => void
  promptPartTypeId: () => number
  inputBlocked: () => boolean
  syncPromptInputFromRenderable: () => string
  promptModelWarning: () => void
  clearPromptDraft: () => void
  onSubmit?: () => void
  exit: () => void
  sessionID: () => string | undefined
  workspaceID: () => string | undefined
  autocomplete: { visible?: unknown } | undefined
  local: any
  kv: { get: (key: string, fallback: string) => string }
  command: { trySlash: (name: string) => boolean }
  sync: any
  sdk: any
  route: { navigate: (route: { type: "session"; sessionID: string }) => void }
  history: { append: (entry: PromptInfo & { mode: "normal" | "shell" }) => void }
  toast: {
    show: (input: { message: string; variant: "error" | "warning" | "info" | "success"; duration?: number }) => void
  }
  log: {
    info: (message: string, extra?: Record<string, unknown>) => void
    warn: (message: string, extra?: Record<string, unknown>) => void
    error: (message: string, extra?: Record<string, unknown>) => void
  }
  status: () => { type: string }
  queueModeEnabled: () => boolean
  axEngineDownloadJob: () => any
  setSubmitPending: (value: boolean) => void
  submitPending: () => boolean
  setSubmitStage: (value: SubmitStage | undefined) => void
  draftSessionID: () => string | undefined
  setDraftSessionID: (value: string | undefined) => void
  syncInputCursorColor: () => void
}

export function createPromptSubmitController(host: PromptSubmitHost) {
  let submitAbort: AbortController | undefined
  let submitRunID = 0
  let submitInFlight = false
  let cancelRouteHandoff: (() => void) | undefined

  function requestHeaders() {
    return directoryRequestHeaders({
      directory: host.sdk.directory,
      accept: "application/json",
      contentType: "application/json",
    })
  }

  async function submitAsyncRoute(input: {
    sessionID: string
    path: AsyncSessionRoute
    body: unknown
    action: string
    signal: AbortSignal
  }) {
    await submitPromptRoute({
      ...input,
      url: host.sdk.url,
      headers: requestHeaders(),
      fetch: host.sdk.fetch,
    })
  }

  function errorMessage(error: unknown) {
    if (error instanceof Error) return error.message
    if (typeof error === "string") return error
    return "Unknown error"
  }

  function reportSubmitFailure(action: string, error: unknown) {
    const message = errorMessage(error)
    host.log.error(`${action} failed`, { error })
    host.toast.show({
      message: `${action} failed: ${message}`,
      variant: "error",
    })
  }

  function upsertSessionInStore(session: { id: string }) {
    host.sync.set(
      "session",
      produce((draft: any) => {
        upsert(draft, session)
      }),
    )
  }

  function cancelPendingSubmit(message = "Prompt submission cancelled") {
    if (!host.submitPending() && !submitInFlight) return false
    submitRunID++
    if (cancelRouteHandoff) {
      cancelRouteHandoff()
      cancelRouteHandoff = undefined
    }
    const abort = submitAbort
    submitAbort = undefined
    submitInFlight = false
    host.setSubmitPending(false)
    host.setSubmitStage(undefined)
    abort?.abort(createSubmitAbortError(message))
    host.toast.show({
      message,
      variant: "info",
      duration: 2000,
    })
    host.syncInputCursorColor()
    return true
  }

  async function submit() {
    const input = host.input
    const store = host.store
    const sdk = host.sdk
    const sync = host.sync
    const local = host.local
    const log = host.log
    const command = host.command
    const kv = host.kv
    const toast = host.toast
    const history = host.history
    const route = host.route
    const setStore = host.setStore
    const setExpandedPastes = host.setExpandedPastes
    const inputBlocked = host.inputBlocked
    const autocomplete = host.autocomplete
    const exit = host.exit
    const promptModelWarning = host.promptModelWarning
    const clearPromptDraft = host.clearPromptDraft
    const syncPromptInputFromRenderable = host.syncPromptInputFromRenderable
    const promptPartTypeId = host.promptPartTypeId()
    const status = host.status
    const queueModeEnabled = host.queueModeEnabled
    const axEngineDownloadJob = host.axEngineDownloadJob
    const setSubmitPending = host.setSubmitPending
    const setSubmitStage = host.setSubmitStage
    const draftSessionID = host.draftSessionID
    const setDraftSessionID = host.setDraftSessionID
    const props = {
      get sessionID() {
        return host.sessionID()
      },
      get workspaceID() {
        return host.workspaceID()
      },
      onSubmit: host.onSubmit,
    }

    if (inputBlocked()) {
      log.info("tui.prompt.submit: blocked", { inputBlocked: inputBlocked(), submitInFlight })
      return
    }
    if (submitInFlight) {
      log.info("tui.prompt.submit: already in flight")
      return
    }
    const promptInput = syncPromptInputFromRenderable()
    if (!promptInput) {
      // Honor the "press Enter to connect" placeholder: with no model configured,
      // an empty Enter should open the provider dialog rather than silently
      // no-op. promptModelWarning() opens the provider dialog (or a "still
      // loading"/"failed" toast) exactly like the no-model submit path below.
      if (!local.model.current()) {
        promptModelWarning()
      }
      log.info("tui.prompt.submit: empty prompt input")
      return
    }
    if (isPromptExitCommand(promptInput)) {
      exit()
      return
    }
    const submission = promptSubmissionView({
      text: promptInput,
      parts: store.prompt.parts,
      extmarks: input.extmarks.getAllForTypeId(promptPartTypeId),
      extmarkToPartIndex: store.extmarkToPartIndex,
    })
    const inputText = submission.text
    const nonTextParts = submission.parts

    // Capture mode before it gets reset
    const currentMode = store.mode
    // Work modes remap normal prompts to slash commands; shell input must stay literal.
    const activeWorkMode = WorkMode.parse(kv.get("work_mode", WorkMode.DEFAULT))
    const workRouted: WorkMode.Routed =
      currentMode === "shell" ? { kind: "prompt", text: inputText } : WorkMode.routeInput(activeWorkMode, inputText)
    const routedText =
      workRouted.kind === "command" ? `/${workRouted.command} ${workRouted.arguments}`.trimEnd() : workRouted.text
    const firstLine = routedText.split("\n")[0]
    const slashToken = routedText.startsWith("/") ? firstLine.split(" ")[0] : undefined
    const slashName = slashToken?.slice(1)
    const slashHasArguments = slashToken ? routedText.trim() !== slashToken : false
    if (
      currentMode === "normal" &&
      workRouted.kind === "prompt" &&
      slashName &&
      !slashHasArguments &&
      command.trySlash(slashName)
    ) {
      // Local slash commands dispatch through the command dialog instead of
      // the async message path below, so settle the draft here as well.
      clearPromptDraft()
      props.onSubmit?.()
      log.info("tui.prompt.submit: slash command dispatched", { command: slashName })
      return
    }
    // From here on, use routedText for network submission (inputText kept for local settle).
    const submitText = routedText

    if (autocomplete?.visible) {
      log.info("tui.prompt.submit: autocomplete visible, skipping")
      return
    }

    const selectedModel = local.model.current()
    if (!selectedModel) {
      log.info("tui.prompt.submit: no model available", {
        providerLoaded: sync.data.provider_loaded,
        providerFailed: sync.data.provider_failed,
        providerCount: sync.data.provider.length,
      })
      promptModelWarning()
      return
    }
    log.info("tui.prompt.submit: proceeding", {
      model: providerModelKey(selectedModel),
      sessionID: props.sessionID ?? draftSessionID() ?? "new",
    })

    // Managed AX Engine weights still downloading: the request would fail
    // server-side with MODEL_NOT_PREPARED. Keep the draft intact and explain.
    const pendingDownload = selectedModel.providerID === AX_ENGINE_PROVIDER_ID ? axEngineDownloadJob() : undefined
    if (pendingDownload) {
      toast.show({
        variant: "warning",
        message: `${selectedModel.modelID} is not ready yet (${axEngineDownloadChip(pendingDownload)}) — send again when the download completes`,
      })
      log.info("tui.prompt.submit: blocked, ax-engine model downloading", {
        model: providerModelKey(selectedModel),
      })
      return
    }

    const runID = ++submitRunID
    let sessionID = props.sessionID ?? draftSessionID()
    const startingNewSession = sessionID == null
    if (startingNewSession) sessionID = SessionID.descending()
    submitInFlight = true
    setSubmitPending(true)
    const messageID = MessageID.ascending()
    const variant = local.model.variant.current()
    let submitAction = "Prompt submission"
    const nextSubmitAbort = new AbortController()
    submitAbort = nextSubmitAbort
    let promptSettledLocally = false
    let routedToSession = false

    function finishPendingSubmit() {
      if (submitRunID !== runID) return
      DiagnosticLog.recordProcess("tui.promptSubmitFinishPendingStarted", {
        sessionID,
        startingNewSession,
      })
      if (submitAbort === nextSubmitAbort) submitAbort = undefined
      submitInFlight = false
      setSubmitPending(false)
      setSubmitStage(undefined)
      DiagnosticLog.recordProcess("tui.promptSubmitFinishPendingFinished", {
        sessionID,
        startingNewSession,
      })
    }

    function settlePromptLocally(options: { clearPrompt: boolean }) {
      if (promptSettledLocally) return
      promptSettledLocally = true
      DiagnosticLog.recordProcess("tui.promptSubmitLocalSettleStarted", {
        sessionID,
        startingNewSession,
        clearPrompt: options.clearPrompt,
      })
      history.append({
        ...store.prompt,
        mode: currentMode,
      })
      if (!options.clearPrompt) {
        props.onSubmit?.()
        DiagnosticLog.recordProcess("tui.promptSubmitLocalSettleFinished", {
          sessionID,
          startingNewSession,
          clearPrompt: options.clearPrompt,
        })
        return
      }
      input.extmarks.clear()
      setStore("prompt", {
        input: "",
        parts: [],
      })
      setStore("extmarkToPartIndex", new Map())
      setExpandedPastes(new Set<number>())
      props.onSubmit?.()
      input.clear()
      DiagnosticLog.recordProcess("tui.promptSubmitLocalSettleFinished", {
        sessionID,
        startingNewSession,
        clearPrompt: options.clearPrompt,
      })
    }

    function routeToSession(nextSessionID: string) {
      if (props.sessionID || routedToSession) return
      routedToSession = true
      DiagnosticLog.recordProcess("tui.promptSubmitRouteHandoffStarted", {
        sessionID: nextSessionID,
      })
      setDraftSessionID(undefined)
      blurRenderable(input, { name: "prompt-route-handoff-blur" })
      cancelRouteHandoff?.()
      cancelRouteHandoff = scheduleTuiTimeout(
        () => {
          cancelRouteHandoff = undefined
          if (submitRunID !== runID) return
          DiagnosticLog.recordProcess("tui.promptSubmitRouteNavigateStarted", {
            sessionID: nextSessionID,
          })
          route.navigate({
            type: "session",
            sessionID: nextSessionID,
          })
          DiagnosticLog.recordProcess("tui.promptSubmitRouteNavigateDispatched", {
            sessionID: nextSessionID,
          })
        },
        {
          name: "prompt-route-handoff",
          delayMs: 0,
        },
      )
    }

    // ADR-028: while the session is busy, buffer plain follow-up prompts in the
    // client-owned queue and let the drain effect replay them when idle. Slash
    // commands and shell input keep the existing async routes; new sessions and
    // idle sessions dispatch immediately below.
    const isKnownSlashCommand =
      workRouted.kind === "command" ||
      (slashName != null && sync.data.command.some((x: { name: string }) => x.name === slashName))
    if (
      queueModeEnabled() &&
      currentMode === "normal" &&
      !isKnownSlashCommand &&
      props.sessionID &&
      isQueueableStatus(status().type)
    ) {
      enqueueFollowUp(props.sessionID, {
        parts: [
          {
            id: PartID.ascending(),
            type: "text",
            text: submitText,
          },
          ...nonTextParts.map(assign),
        ],
        agent: local.agent.current().name,
        model: selectedModel,
        variant,
      })
      settlePromptLocally({ clearPrompt: true })
      finishPendingSubmit()
      return
    }

    try {
      if (startingNewSession) {
        if (!sessionID) throw new Error("Session id allocation failed")
        submitAction = "Session creation"

        const res = (await withTimeout(
          sdk.client.session.create(
            { id: sessionID, directory: props.workspaceID ?? sdk.baseDirectory },
            { signal: nextSubmitAbort.signal },
          ),
          SUBMIT_ACCEPT_TIMEOUT_MS,
          `Session creation timed out after ${SUBMIT_ACCEPT_TIMEOUT_MS}ms`,
        )) as { error?: unknown; data?: { id: string } }
        if (res.error) throw new Error(errorMessage(res.error))
        if (!res.data?.id) throw new Error("Session creation returned no data")

        const createdSession = res.data
        sessionID = res.data.id
        if (nextSubmitAbort.signal.aborted) return
        upsertSessionInStore(createdSession)
        // Pin the new session as the draft: until routeToSession navigates and
        // props.sessionID catches up, a second Enter would otherwise take the
        // startingNewSession branch again and allocate a duplicate session.
        setDraftSessionID(res.data.id)
      }
      if (!sessionID) throw new Error("Session id allocation failed")

      setSubmitStage("dispatching")
      if (currentMode === "shell") {
        submitAction = "Shell command submission"
        await submitAsyncRoute({
          sessionID,
          path: "shell_async",
          action: submitAction,
          signal: nextSubmitAbort.signal,
          body: {
            agent: local.agent.current().name,
            model: {
              providerID: selectedModel.providerID,
              modelID: selectedModel.modelID,
            },
            command: submitText,
          },
        })
        setStore("mode", "normal")
      } else if (
        workRouted.kind === "command" ||
        (submitText.startsWith("/") &&
          iife(() => {
            const command = firstLine.split(" ")[0].slice(1)
            return sync.data.command.some((x: { name: string }) => x.name === command)
          }))
      ) {
        // Parse command from first line, preserve multi-line content in arguments
        const firstLineEnd = submitText.indexOf("\n")
        const commandLine = firstLineEnd === -1 ? submitText : submitText.slice(0, firstLineEnd)
        const [commandName, ...firstLineArgs] = commandLine.split(" ")
        const restOfInput = firstLineEnd === -1 ? "" : submitText.slice(firstLineEnd + 1)
        const args =
          workRouted.kind === "command"
            ? workRouted.arguments
            : firstLineArgs.join(" ") + (restOfInput ? "\n" + restOfInput : "")
        const commandId = workRouted.kind === "command" ? workRouted.command : commandName.slice(1)

        submitAction = "Command submission"
        await submitAsyncRoute({
          sessionID,
          path: "command_async",
          action: submitAction,
          signal: nextSubmitAbort.signal,
          body: {
            command: commandId,
            arguments: args,
            agent: local.agent.current().name,
            model: providerModelKey(selectedModel),
            messageID,
            variant,
            parts: nonTextParts
              .filter((x: PromptInfo["parts"][number]) => x.type === "file")
              .map((x) => ({
                id: PartID.ascending(),
                ...x,
              })),
          },
        })
      } else {
        submitAction = "Prompt submission"
        await submitAsyncRoute({
          sessionID,
          path: "prompt_async",
          action: submitAction,
          signal: nextSubmitAbort.signal,
          body: {
            ...selectedModel,
            messageID,
            agent: local.agent.current().name,
            model: selectedModel,
            variant,
            parts: [
              {
                id: PartID.ascending(),
                type: "text",
                text: submitText,
              },
              ...nonTextParts.map(assign),
            ],
          },
        })
      }
    } catch (error) {
      if (isSubmitAbortError(error)) return
      reportSubmitFailure(submitAction, error)
      return
    } finally {
      finishPendingSubmit()
    }

    if (nextSubmitAbort.signal.aborted) return

    settlePromptLocally({ clearPrompt: !startingNewSession })
    routeToSession(sessionID)
  }

  function dispose() {
    cancelRouteHandoff?.()
    submitAbort?.abort(createSubmitAbortError())
  }

  return {
    submit,
    cancelPendingSubmit,
    dispose,
    get submitInFlight() {
      return submitInFlight
    },
  }
}
