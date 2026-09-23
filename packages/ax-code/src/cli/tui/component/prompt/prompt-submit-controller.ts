import { english, type Translate, type MessageKey } from "../../i18n"
import { produce } from "solid-js/store"
import type { Session } from "@ax-code/sdk/v2"
import type { TextareaRenderable } from "ax-tui"
import { DiagnosticLog } from "@/debug/diagnostic-log"
import { iife } from "@/util/iife"
import { withTimeout } from "@/util/timeout"
import { WorkMode } from "@/mode/work-mode"
import {
  WORK_MODE_HINT_SEEN_KEY,
  workModeAvailability,
  withWorkModeHintSeen,
  type AvailabilityProvider,
  type WorkModeConfig,
} from "../work-mode-availability"
import { providerModelKey, type ProviderModelKeyInput } from "@/provider/model-key"
import { AX_ENGINE_PROVIDER_ID } from "@/provider/ax-engine/constants"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { directoryRequestHeaders } from "@tui/util/request-headers"
import type { useSDK } from "@tui/context/sdk"
import { blurRenderable } from "@tui/util/renderable-safety"
import { scheduleTuiTimeout } from "@tui/util/timer"
import { upsert } from "../../context/sync-util"
import { axEngineDownloadChip, type AxEngineDownloadJobView } from "../ax-engine-downloads-view-model"
import { isQueueableStatus } from "./follow-up-queue"
import { isSteerableDraft, steerBusySession, type SteerClient } from "./prompt-steer"
import { commandLineLabel, durableFollowUps } from "./durable-follow-up"
import { steerQueuedPrefix } from "./steer-follow-up"
import { assign } from "./part"
import { SESSION_CREATE_TIMEOUT_MS } from "@/constants/session-create"
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

type PromptSubmitComposer = Pick<TextareaRenderable, "clear"> &
  Partial<Pick<TextareaRenderable, "blur" | "isDestroyed">> & {
    extmarks: Pick<TextareaRenderable["extmarks"], "getAllForTypeId" | "clear">
  }

type PromptSubmitSdk = Pick<
  ReturnType<typeof useSDK>,
  "url" | "directory" | "baseDirectory" | "fetch" | "sseConnected"
> & {
  client: {
    session: {
      create: (
        parameters: { id: string; directory?: string },
        options: { signal: AbortSignal },
      ) => Promise<{ data?: Session; error?: unknown }>
    } & Partial<SteerClient>
  }
}

export type PromptSubmitHost = {
  t?: Translate
  conversationSystem?: () => string | undefined
  input: PromptSubmitComposer
  store: PromptSubmitStore
  setStore: <Key extends keyof PromptSubmitStore>(key: Key, value: PromptSubmitStore[Key]) => void
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
  local: {
    model: {
      current: () => ProviderModelKeyInput | undefined
      variant: { current: () => string | undefined }
    }
    agent: { current: () => { name: string } }
  }
  kv: {
    get: (key: string, fallback?: any) => any
    set?: (key: string, value: any) => void
  }
  command: { trySlash: (name: string) => boolean }
  sync: {
    data: {
      command: readonly { name: string }[]
      provider: readonly unknown[]
      provider_loaded: boolean
      provider_failed: boolean
      task_queue: readonly unknown[]
      config?: { modes?: WorkModeConfig } | undefined
    }
    set: (key: "session", update: (sessions: Session[]) => Session[]) => void
  }
  sdk: PromptSubmitSdk
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
  axEngineDownloadJob: () => AxEngineDownloadJobView | undefined
  setSubmitPending: (value: boolean) => void
  submitPending: () => boolean
  setSubmitStage: (value: SubmitStage | undefined) => void
  draftSessionID: () => string | undefined
  setDraftSessionID: (value: string | undefined) => void
  syncInputCursorColor: () => void
}

export function createPromptSubmitController(host: PromptSubmitHost) {
  const t = host.t ?? english
  let submitAbort: AbortController | undefined
  let submitRunID = 0
  let submitInFlight = false
  let cancelRouteHandoff: (() => void) | undefined
  let retrySubmission: { fingerprint: string; messageID: MessageID; followup: boolean } | undefined

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
    followup?: boolean
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
      message: t("error.request", {
        action: t(
          (
            {
              "Prompt submission": "error.promptAction",
              "Command submission": "error.commandAction",
              "Shell command submission": "error.shellAction",
              "Session creation": "error.sessionAction",
            } as Record<string, MessageKey>
          )[action] ?? "error.promptAction",
        ),
        message,
      }),
      variant: "error",
    })
  }

  function upsertSessionInStore(session: Session) {
    host.sync.set(
      "session",
      produce((draft: Session[]) => {
        upsert(draft, session)
      }),
    )
  }

  function cancelPendingSubmit(message = t("error.cancelled")) {
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

  // Send-now requests arrive through submitSteer(), which arms this flag for
  // exactly one submit() so the ordinary keyboard path stays unchanged.
  let steerRequested = false

  async function submitSteer() {
    // An empty composer over a busy session promotes the steerable prefix of
    // the saved follow-up queue into the running turn. A non-empty draft keeps
    // the ordinary steer path: the gesture always names exactly one explicit
    // target and never bundles the queue with a draft.
    const sessionID = host.sessionID()
    if (
      !host.syncPromptInputFromRenderable() &&
      sessionID &&
      host.store.mode === "normal" &&
      host.queueModeEnabled() &&
      isQueueableStatus(host.status().type)
    ) {
      await steerSavedFollowUps(sessionID)
      return
    }
    steerRequested = true
    try {
      return await submit()
    } finally {
      steerRequested = false
    }
  }

  async function steerSavedFollowUps(sessionID: string) {
    const rows = durableFollowUps(host.sync.data.task_queue, sessionID)
    if (rows.length === 0) {
      host.toast.show({ variant: "info", message: t("ui.steerQueueEmpty"), duration: 2500 })
      return
    }
    const outcome = await steerQueuedPrefix(host.sdk, rows)
    host.log.info("tui.prompt.submitSteer: queue promotion finished", {
      sessionID,
      steered: outcome.steered.length,
      queuedNext: outcome.queuedNext.length,
      remaining: outcome.remaining,
      failed: outcome.failed,
      barrier: outcome.barrier ? `${outcome.barrier.reason} (${outcome.barrier.item.id})` : undefined,
    })
    if (outcome.failed && outcome.steered.length === 0 && outcome.queuedNext.length === 0) {
      host.toast.show({ variant: "error", message: t("ui.steerFailed", { message: outcome.failed }) })
      return
    }
    if (outcome.steered.length === 0 && outcome.queuedNext.length === 0) {
      host.toast.show({ variant: "info", message: t("ui.steerNothingSteerable"), duration: 3000 })
      return
    }
    if (outcome.steered.length === 0) {
      host.toast.show({ variant: "info", message: t("ui.steerQueuedNext"), duration: 3000 })
      return
    }
    if (outcome.remaining > 0) {
      host.toast.show({
        variant: outcome.failed ? "warning" : "info",
        message: t("ui.steeredFollowUpsPartial", { count: outcome.steered.length, remaining: outcome.remaining }),
        duration: 3500,
      })
      return
    }
    host.toast.show({
      variant: "info",
      message: t("ui.steeredFollowUps", { count: outcome.steered.length }),
      duration: 3000,
    })
  }

  async function submit() {
    const options = { steer: steerRequested }
    steerRequested = false
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
    if (submitInFlight || cancelRouteHandoff) {
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
    // ADR-097 blocks unavailable council/arena *submits*, not local slash
    // commands (`/model`, `/help`) that routeInput keeps as prompts.
    if (currentMode !== "shell" && activeWorkMode !== WorkMode.DEFAULT && workRouted.kind === "command") {
      // Never silently degrade multi-model intent: an unavailable mode blocks
      // the submit with the reason and the fix, and the draft is preserved
      // (ADR-097). The selected mode is kept, not force-reverted.
      const availability = workModeAvailability({
        t,
        mode: activeWorkMode,
        providers: sync.data.provider as readonly AvailabilityProvider[],
        providerLoaded: sync.data.provider_loaded,
        config: sync.data.config?.modes,
      })
      if (availability.state !== "available") {
        toast.show({
          message:
            availability.state === "checking"
              ? `${WorkMode.label(activeWorkMode)} · ${t("mode.checking")}`
              : t("mode.notSent", { detail: availability.detail ?? t("mode.unavailable") }),
          variant: "warning",
        })
        log.info("tui.prompt.submit: work mode unavailable", {
          mode: activeWorkMode,
          reason: availability.reason ?? "checking",
        })
        return
      }
      kv.set?.(WORK_MODE_HINT_SEEN_KEY, withWorkModeHintSeen(kv.get(WORK_MODE_HINT_SEEN_KEY), activeWorkMode))
    }
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
    const variant = local.model.variant.current()
    const conversationSystem = currentMode === "shell" ? undefined : host.conversationSystem?.()
    const fingerprint = JSON.stringify({
      sessionID,
      text: submitText,
      parts: nonTextParts,
      model: { providerID: selectedModel.providerID, modelID: selectedModel.modelID },
      agent: local.agent.current().name,
      variant,
      mode: currentMode,
      system: conversationSystem,
    })
    const retry = retrySubmission?.fingerprint === fingerprint ? retrySubmission : undefined
    const messageID = retry?.messageID ?? MessageID.ascending()
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
      blurRenderable(input, { name: "prompt-route-handoff-blur" })
      cancelRouteHandoff?.()
      cancelRouteHandoff = scheduleTuiTimeout(
        () => {
          cancelRouteHandoff = undefined
          if (submitRunID !== runID) return
          DiagnosticLog.recordProcess("tui.promptSubmitRouteNavigateStarted", {
            sessionID: nextSessionID,
          })
          setDraftSessionID(undefined)
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

    // Accepted follow-ups are durable server work; the composer stays intact until acknowledgement.
    const isKnownSlashCommand =
      workRouted.kind === "command" ||
      (slashName != null && sync.data.command.some((x: { name: string }) => x.name === slashName))
    const followup =
      retry?.followup ??
      Boolean(
        queueModeEnabled() &&
          currentMode === "normal" &&
          !isKnownSlashCommand &&
          props.sessionID &&
          isQueueableStatus(status().type),
      )
    retrySubmission = { fingerprint, messageID, followup }

    // Send-now (steer): admit the text into the running generation at its
    // next step boundary instead of queueing it until the turn ends. Text
    // only, normal mode only, never a slash command. When the turn has
    // already ended the ordinary path below takes over so nothing is lost.
    const steerClient = sdk.client.session
    if (options?.steer && sessionID && !startingNewSession && steerClient.steering && steerClient.steer) {
      const steerable =
        workRouted.kind === "prompt" &&
        !isKnownSlashCommand &&
        isSteerableDraft({
          mode: currentMode,
          statusType: status().type,
          hasAttachments: nonTextParts.length > 0,
        })
      if (!steerable) {
        if (nonTextParts.length > 0 && isQueueableStatus(status().type)) {
          toast.show({
            variant: "info",
            message: "Attachments cannot steer a running turn; sent as a follow-up instead",
            duration: 3000,
          })
        }
        log.info("tui.prompt.submit: steer requested but draft is not steerable", {
          mode: currentMode,
          status: status().type,
          attachments: nonTextParts.length,
        })
      } else {
        submitAction = "Steering submission"
        setSubmitStage("dispatching")
        const outcome = await steerBusySession(steerClient as SteerClient, {
          sessionID,
          clientID: messageID,
          text: submitText,
          signal: nextSubmitAbort.signal,
        })
        if (nextSubmitAbort.signal.aborted) return
        if (outcome.kind === "delivered") {
          finishPendingSubmit()
          retrySubmission = undefined
          settlePromptLocally({ clearPrompt: true })
          toast.show({
            variant: "info",
            message: "Sent into the running turn; it applies at the next step",
            duration: 2500,
          })
          log.info("tui.prompt.submit: steered into the running turn", { sessionID, status: outcome.status })
          return
        }
        if (outcome.kind === "failed") {
          finishPendingSubmit()
          toast.show({ variant: "error", message: `Steering failed: ${outcome.message}` })
          log.warn("tui.prompt.submit: steering failed; draft kept", { sessionID, message: outcome.message })
          return
        }
        log.info("tui.prompt.submit: steering fell back to the ordinary path", { sessionID, reason: outcome.reason })
      }
    }

    try {
      if (startingNewSession) {
        if (!sessionID) throw new Error("Session id allocation failed")
        submitAction = "Session creation"
        setSubmitStage("creating-session")

        const res = await withTimeout(
          sdk.client.session.create(
            { id: sessionID, directory: props.workspaceID ?? sdk.baseDirectory },
            { signal: nextSubmitAbort.signal },
          ),
          SESSION_CREATE_TIMEOUT_MS,
          `Session creation timed out after ${SESSION_CREATE_TIMEOUT_MS}ms. The local database may be busy; check other AX Code processes before retrying.`,
        )
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
        // A busy session leaves the command row waiting_for_idle with no user
        // message until it executes; detect that from the same queueable
        // condition the follow-up path uses so the acceptance can say where it
        // landed instead of silently vanishing from the transcript.
        const queuedBehindTurn = isQueueableStatus(status().type)
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
            system: conversationSystem,
            parts: nonTextParts
              .filter((x: PromptInfo["parts"][number]) => x.type === "file")
              .map((x) => ({
                id: PartID.ascending(),
                ...x,
              })),
          },
        })
        const queuedCommandLine = commandLineLabel(commandId, args)
        if (queuedBehindTurn && queuedCommandLine) {
          log.info("tui.prompt.submit: command queued behind the running turn", { sessionID, command: commandId })
          toast.show({
            variant: "info",
            message: t("ui.queuedCommandBehindTurn", { command: queuedCommandLine }),
            duration: 4000,
          })
        }
      } else {
        submitAction = "Prompt submission"
        await submitAsyncRoute({
          sessionID,
          path: "prompt_async",
          followup,
          action: submitAction,
          signal: nextSubmitAbort.signal,
          body: {
            ...selectedModel,
            messageID,
            agent: local.agent.current().name,
            model: selectedModel,
            variant,
            system: conversationSystem,
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
      if (nextSubmitAbort.signal.aborted || isSubmitAbortError(error)) return
      reportSubmitFailure(submitAction, error)
      return
    } finally {
      finishPendingSubmit()
    }

    if (nextSubmitAbort.signal.aborted) return

    retrySubmission = undefined
    settlePromptLocally({ clearPrompt: !startingNewSession })
    routeToSession(sessionID)
  }

  function dispose() {
    cancelRouteHandoff?.()
    submitAbort?.abort(createSubmitAbortError())
  }

  return {
    submit,
    submitSteer,
    cancelPendingSubmit,
    dispose,
    get submitInFlight() {
      return submitInFlight
    },
  }
}
