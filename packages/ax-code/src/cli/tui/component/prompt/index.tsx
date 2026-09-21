import { FooterStatusRow } from "./footer-status-row"
import { useLanguage } from "../../context/language"
import { usePromptRef } from "@tui/context/prompt"
import { useContextMenu } from "../../ui/context-menu"
import { createSessionPromptDraftLifecycle, promptDraftKey } from "./session-drafts"
import { useContentDimensions } from "@tui/context/content-dimensions"
import { BoxRenderable, TextareaRenderable, MouseEvent, KeyEvent } from "ax-tui"
import { createEffect, createMemo, onMount, createSignal, onCleanup, on, Show, Switch, Match, For } from "solid-js"
import { providerModelEquals } from "@/provider/model-key"
import { shouldAdoptMessageModelFromHistory } from "@tui/context/local-util"
import { effortDisplay } from "@/provider/effort-label"
import { useLocal } from "@tui/context/local"
import { useTheme } from "@tui/context/theme"
import { EmptyBorder } from "@tui/component/border"
import { Card } from "@tui/ui/primitives/card"
import { useSDK } from "@tui/context/sdk"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { createStore, produce, unwrap } from "solid-js/store"
import { useKeybind } from "@tui/context/keybind"
import { usePromptHistory, type PromptInfo } from "./history"
import { usePromptStash } from "./stash"
import { type AutocompleteRef, Autocomplete } from "./autocomplete"
import { useCommandDialog } from "../dialog-command"
import { useKeyboard, useRenderer } from "ax-tui/solid"
import { scheduleMicrotaskTask } from "@tui/util/microtask"
import { blurRenderable, focusRenderable, isRenderableAlive } from "@tui/util/renderable-safety"
import { scheduleTuiInterval } from "@tui/util/timer"
import { useExit } from "../../context/exit"
import { Clipboard } from "../../util/clipboard"
import { TuiEvent } from "../../event"
import { Locale } from "@/util/locale"
import { formatDuration } from "@/util/format"
import { useDialog } from "@tui/ui/dialog"
import { DialogAlert } from "../../ui/dialog-alert"
import { useToast } from "../../ui/toast"
import { useAxEngineDownloads } from "../../context/ax-engine-downloads"
import { axEngineDownloadChip } from "../ax-engine-downloads-view-model"
import { AX_ENGINE_PROVIDER_ID } from "@/provider/ax-engine/constants"
import { useKV } from "../../context/kv"
import { useTextareaKeybindings } from "../textarea-keybindings"
import { Usage } from "../../routes/session/usage"
import { Log } from "@/util/log"
import {
  hasPromptDraft,
  promptEscapeClearIntent,
  promptEscapeRewindIntent,
  escapeRewindDisarmKey,
  createPromptPasteSubmitGate,
  isUnmodifiedPromptSubmitKey,
  sanitizePromptInput,
  clipboardTextPaste,
} from "./view-model"
import { FooterAnimationSpinner } from "../footer-animation"
import { summarizedPasteViews } from "./paste-view-model"
import {
  footerContextGauge,
  footerSessionStatusView,
  footerSubagentStatusView,
  footerTokenChip,
  hasActiveSubagentInSessionTree,
} from "../../routes/session/footer-view-model"
import { calculateCompactionBudget, effectiveTokenTotal } from "@/session/compaction-budget"
import { Gauge } from "@tui/ui/primitives/gauge"
import { KeyHint } from "@tui/ui/primitives/key-hint"
import { footerHintWidth, promptFooterLayout } from "./footer-layout"
import { computeSessionMainPaneWidth } from "../../routes/session/layout"
import { pendingSubmitKeyIntent, pendingSubmitStatusText, type SubmitStage } from "./submit-state"
import { connectionChipText, footerLivenessIndicator, footerLivenessTextFrame } from "./liveness-view-model"
import {
  endDisplayOffset,
  hasUnfinishedTodosInPromptParts,
  promptPartExtmarkView,
  setPromptPartSourceRange,
} from "./prompt-helpers"
import { PLACEHOLDERS, SHELL_PLACEHOLDERS } from "./prompt-config"
import { promptCommands } from "./prompt-commands"
import { createPromptPaste } from "./prompt-paste"
import { createPromptSubmitController } from "./prompt-submit-controller"
import type { PromptProps, PromptRef } from "./prompt-types"
import { Installation } from "@/installation"
import { useTuiConfig } from "../../context/tui-config"
import { runStatusLineCommand } from "../../util/status-line"
import { DialogRollback } from "../../routes/session/dialog-rollback"
import { SessionRollbackView } from "../../routes/session/rollback"
import { promptState } from "../../routes/session/messages"

export type { PromptProps, PromptRef } from "./prompt-types"

const log = Log.create({ service: "tui.prompt" })
// Upper bound for parts kept around after their extmark disappears (undo);
// enough for any realistic undo depth without letting the map grow unbounded.
const MAX_ORPHANED_PROMPT_PARTS = 50

// Shared copy for the "can't send a prompt yet" states, used by both the submit
// toast and the input placeholder so the two never drift apart.
const MSG_NO_MODEL = "No model available — check your provider configuration"
const MSG_NO_PROVIDER = "No provider configured — connect a provider to send prompts"

export function Prompt(props: PromptProps) {
  const sdk = useSDK()
  return (
    <Show keyed when={promptDraftKey(props.workspaceID ?? sdk.directory ?? sdk.baseDirectory, props.sessionID)}>
      {(draftKey) => <SessionPrompt {...props} draftKey={draftKey} />}
    </Show>
  )
}

function SessionPrompt(props: PromptProps & { draftKey: string }) {
  const uiText = useLanguage().t

  const language = useLanguage()
  let input: TextareaRenderable
  let anchor: BoxRenderable
  let autocomplete: AutocompleteRef

  const keybind = useKeybind()
  const local = useLocal()
  const sdk = useSDK()
  const route = useRoute()
  const dimensions = useContentDimensions()
  const sync = useSync()
  const dialog = useDialog()
  const toast = useToast()
  const exit = useExit()
  const status = createMemo(() => sync.data.session_status?.[props.sessionID ?? ""] ?? { type: "idle" })
  const history = usePromptHistory()
  const stash = usePromptStash()
  const command = useCommandDialog()
  const renderer = useRenderer()
  const { theme, syntax } = useTheme()
  const kv = useKV()
  const tuiConfig = useTuiConfig()
  const [submitPending, setSubmitPending] = createSignal(false)
  const [submitStage, setSubmitStage] = createSignal<SubmitStage | undefined>()
  const [draftSessionID, setDraftSessionID] = createSignal<string | undefined>()
  const [expandedPastes, setExpandedPastes] = createSignal<Set<number>>(new Set<number>())
  const inputBlocked = createMemo(() => props.disabled || submitPending())

  // Connection health chip for the footer: undefined while the event stream is
  // healthy, a short label while connecting/reconnecting or after a terminal
  // stop — so a silent SSE drop no longer looks like "the model is thinking".
  // Also surfaces the backend-reported stream health (server control events),
  // which covers the dead-backend-behind-a-healthy-socket case.
  const connectionChip = createMemo(() =>
    connectionChipText({
      phase: sdk.connectionStatus?.phase,
      connected: sdk.connectionStatus?.connected,
      streamHealth: sync.data.stream_health,
    }),
  )

  // AX Engine download progress for the footer chip and the submit guard:
  // while the selected model's weights are queued/downloading, show the
  // progress next to the model name and block submits with an explanation
  // instead of letting the turn fail server-side with MODEL_NOT_PREPARED.
  const axEngineDownloads = useAxEngineDownloads()
  const axEngineDownloadJob = createMemo(() => {
    const current = local.model.current()
    if (!current || current.providerID !== AX_ENGINE_PROVIDER_ID) return undefined
    return axEngineDownloads.jobForModel(current.modelID)
  })
  const downloadChip = createMemo(() => {
    const job = axEngineDownloadJob()
    return job ? axEngineDownloadChip(job) : undefined
  })

  // Accepted follow-ups are durable server tasks; this preference controls
  // whether busy-session submissions use the follow-up queue.

  const [queueModeEnabled] = kv.signal("prompt_queue_mode", true)

  const [localStatusTick, setLocalStatusTick] = createSignal(0)
  const statusTick = () => props.statusTick?.() ?? localStatusTick()

  // Custom status line (tui.json `status_line.command`): runs the user's shell
  // command on an interval with a small JSON snapshot on stdin and renders its
  // first stdout line under the prompt. The interval helper already guards
  // against overlapping runs; failures/hangs resolve to undefined (no line).
  const [statusLine, setStatusLine] = createSignal<string | undefined>()
  createEffect(() => {
    const config = tuiConfig.status_line
    const command = config?.command?.trim()
    if (!command) {
      setStatusLine(undefined)
      return
    }
    const intervalMs = Math.max(500, config?.interval_ms ?? 3000)
    let stale = false
    const run = async () => {
      const model = local.model.current()
      const cwd = sdk.directory ?? process.cwd()
      const text = await runStatusLineCommand(
        command,
        {
          model: model ? `${model.providerID}/${model.modelID}` : undefined,
          agent: local.agent.current().name,
          cwd,
          sessionID: props.sessionID,
          version: Installation.VERSION,
        },
        { cwd },
      )
      // Cleanup (unmount, or an effect re-run on model/agent/session switch)
      // cancels the interval but cannot stop an in-flight command — drop its
      // late result so a snapshot for the old session never overwrites the
      // current one.
      if (stale) return
      setStatusLine(text)
    }
    void run()
    const cancel = scheduleTuiInterval(run, { name: "prompt-status-line", delayMs: intervalMs, unref: true })
    onCleanup(() => {
      stale = true
      cancel()
    })
  })
  const pendingCancelHint = createMemo(() => {
    const hints = new Set<string>()
    const sessionInterrupt = keybind.print("session_interrupt")
    const appExit = keybind.print("app_exit")
    if (sessionInterrupt) hints.add(sessionInterrupt)
    if (appExit) hints.add(appExit)
    return [...hints].join("/")
  })
  let lastDraftEscapeAt: number | undefined
  let lastIdleEscapeAt: number | undefined

  // Double-Esc on an idle session opens the rollback dialog (Kimi-style rewind).
  // Mirrors the "View rollback points" command in routes/session/display-commands.ts,
  // including its abort-then-revert select handler.
  function openRollbackDialog() {
    const sessionID = props.sessionID
    if (!sessionID) return
    const rollbackMessages = () =>
      (sync.data.message[sessionID] ?? []).map((item) => ({
        info: item,
        parts: sync.data.part[item.id] ?? [],
      }))
    dialog.replace(() => (
      <DialogRollback
        sessionID={sessionID}
        messages={rollbackMessages()}
        onSelect={async (point) => {
          // The v2 SDK client resolves `{error}` instead of rejecting, so both
          // calls must check the result. Thrown errors are toasted by
          // DialogRollback, which keeps the dialog open for retry.
          const current = sync.data.session_status?.[sessionID]
          if (current && current.type !== "idle") {
            const aborted = await sdk.client.session.abort({ sessionID })
            if (aborted.error) {
              log.warn("session rollback abort failed", { error: aborted.error, sessionID })
              throw new Error("Failed to stop the running session before rollback")
            }
          }
          const result = await sdk.client.session.revert({
            sessionID,
            messageID: point.messageID,
            partID: point.partID,
          })
          if (result.error) {
            log.warn("session rollback revert failed", { error: result.error, sessionID })
            throw new Error("Failed to rollback to selected step")
          }
          const messageID = SessionRollbackView.promptID(rollbackMessages(), point)
          // PromptRef.set replaces one prompt value; it is not Map/Set growth.
          if (messageID) ref.set(promptState(sync.data.part[messageID] ?? [])) // @scan-suppress lifecycle_scan
        }}
      />
    ))
  }

  function syncPromptInputFromRenderable(options: { autocomplete?: boolean } = {}) {
    if (!isRenderableAlive(input)) return store.prompt.input
    const raw = input.plainText
    const value = sanitizePromptInput(raw)
    if (value !== raw) input.setText(value)
    setStore("prompt", "input", value)
    if (options.autocomplete === false) autocomplete?.hide()
    else autocomplete?.onInput(value)
    syncExtmarksWithPromptParts()
    return value
  }

  function requestInputLayoutRefresh(
    options: { gotoBufferEnd?: boolean; syncPromptInput?: boolean; autocomplete?: boolean } = {},
  ) {
    if (options.syncPromptInput !== false) syncPromptInputFromRenderable({ autocomplete: options.autocomplete })
    scheduleMicrotaskTask(
      () => {
        if (!isRenderableAlive(input)) return
        input.getLayoutNode().markDirty()
        if (options.gotoBufferEnd) input.gotoBufferEnd()
        renderer.requestRender()
      },
      {
        name: "prompt-input-layout-refresh",
      },
    )
  }

  function clearPromptDraft() {
    input.clear()
    input.extmarks.clear()
    orphanedExtmarkParts.clear()
    setStore("prompt", {
      input: "",
      parts: [],
    })
    setStore("extmarkToPartIndex", new Map())
    lastDraftEscapeAt = undefined
  }

  function syncInputCursorColor() {
    const color = inputBlocked() ? theme.backgroundElement : theme.text
    scheduleMicrotaskTask(
      () => {
        if (!isRenderableAlive(input)) return
        input.cursorColor = color
      },
      {
        name: "prompt-input-cursor-color-sync",
      },
    )
  }

  const promptContentWidth = createMemo(() => {
    // Trust the parent's signal: the Session route owns the canonical
    // "sidebar reduces width" computation (panel mode only, not the
    // narrow-mode overlay). The fallback used to recompute a partial
    // approximation here, which drifted from the parent and ignored
    // the user's explicit `sidebarOpen()` toggle. Routes without a
    // sidebar (home, etc.) do not pass the prop and naturally fall to
    // false.
    const routeIsChildlessSession = route.data.type === "session" && !sync.session.get(route.data.sessionID)?.parentID
    const sidebarVisible = routeIsChildlessSession ? (props.sidebarVisible?.() ?? false) : false
    return computeSessionMainPaneWidth({
      terminalWidth: dimensions().width,
      sidebarVisible,
      // Match the Session route's canonical computation: without the user's
      // sidebar width preset this drifts from the parent for non-default widths.
      sidebarPreferredWidth: kv.get("sidebar_width"),
    })
  })

  function openProviderDialog() {
    const marker = dialog.stack.at(-1)
    import("../dialog-provider")
      .then(({ DialogProvider }) => {
        if (dialog.stack.at(-1) !== marker) return
        dialog.replace(() => <DialogProvider />)
      })
      .catch((error) => {
        log.warn("failed to load provider dialog", { error })
        toast.show({ message: uiText("ui.failedToOpenProviderDialog"), variant: "error" })
      })
  }

  function promptModelWarning() {
    if (!sync.data.provider_loaded) {
      toast.show({
        variant: "info",
        message: uiText("ui.providersAreStillLoadingPleaseWaitAbout10SecondsAndTryAgain"),
        duration: 4000,
      })
      return
    }
    if (sync.data.provider_failed) {
      toast.show({
        variant: "warning",
        message: uiText("ui.providersFailedToLoadCheckYourConfiguration"),
        duration: 5000,
      })
      // Open provider dialog so the user can reconfigure or retry.
      openProviderDialog()
      return
    }
    const hasProviders = sync.data.provider.length > 0
    toast.show({
      variant: "warning",
      message: hasProviders ? MSG_NO_MODEL : MSG_NO_PROVIDER,
      duration: 5000,
    })
    // Open provider dialog so the user can configure or fix provider access.
    openProviderDialog()
  }

  const textareaKeybindings = useTextareaKeybindings({ submit: false, interceptEnter: true })

  // Returns the submit kind: "steer" delivers into the running turn, "submit"
  // is the ordinary path. Both are truthy so existing `if (isPromptSubmitKey(e))`
  // guards keep working.
  function isPromptSubmitKey(event: KeyEvent) {
    // Explicit newline binding wins over the built-in Enter->submit fallback so
    // a user can rebind Enter to insert a newline instead of submitting.
    if (keybind.match("input_newline", event)) return false
    // Send-now: deliver into the running turn instead of the follow-up queue.
    if (keybind.match("input_submit_steer", event)) return "steer" as const
    if (keybind.match("input_submit", event)) return "submit" as const
    return isUnmodifiedPromptSubmitKey(event) ? ("submit" as const) : false
  }

  let submit = async () => {}
  let submitSteer = async () => {}

  // submit() must never reject unhandled — AX Code TUI dispatches keyboard handlers
  // fire-and-forget, so a dropped rejection lands on the process-level
  // unhandledRejection path. Surface submission failures as a toast instead.
  function submitSafely() {
    if (dialog.stack.length > 0) return
    void submit().catch((error) => {
      log.warn("tui.prompt.submit: rejected", { error })
      toast.show({ variant: "error", message: language.t("error.submit") })
    })
  }

  function steerSafely() {
    if (dialog.stack.length > 0) return
    void submitSteer().catch((error) => {
      log.warn("tui.prompt.steer: rejected", { error })
      toast.show({ variant: "error", message: language.t("error.submit") })
    })
  }

  const pasteSubmitGate = createPromptPasteSubmitGate({ submit: submitSafely })

  useKeyboard((evt) => {
    if (evt.defaultPrevented) return
    if (dialog.stack.length > 0) return
    if (!isRenderableAlive(input) || !input.focused) return
    const submitKind = isPromptSubmitKey(evt)
    if (!submitKind) return
    log.info("tui.prompt.useKeyboard: submit key detected", { keyName: evt.name, kind: submitKind })
    if (pasteSubmitGate.deferSubmitUntilPasteHandled()) {
      evt.preventDefault()
      evt.stopPropagation()
      return
    }
    if (autocomplete?.visible) {
      if (autocomplete.onKeyDown(evt)) return
    }
    evt.preventDefault()
    evt.stopPropagation()
    // Inlined (rather than a shared helper) so this useKeyboard callback stays
    // self-contained: test/cli/tui/revert-history.test.ts slices this exact
    // source range and evaluates it standalone.
    if (submitKind === "steer") steerSafely()
    else submitSafely()
  })

  const fileStyleId = syntax().getStyleId("extmark.file")!
  const agentStyleId = syntax().getStyleId("extmark.agent")!
  const pasteStyleId = syntax().getStyleId("extmark.paste")!
  let promptPartTypeId = 0
  let suppressAutocompleteOnNextContentChange = false

  function suppressAutocompleteForNextContentChange() {
    suppressAutocompleteOnNextContentChange = true
  }

  const unsubPromptAppend = sdk.event.on(TuiEvent.PromptAppend.type, (evt) => {
    if (!isRenderableAlive(input)) return
    input.insertText(evt.properties.text)
    requestInputLayoutRefresh({ gotoBufferEnd: true })
  })
  onCleanup(() => unsubPromptAppend())

  createEffect(() => {
    syncInputCursorColor()
  })

  onMount(() => {
    if (props.statusTick) return
    const cancel = scheduleTuiInterval(
      () => {
        if (status().type === "idle") return
        setLocalStatusTick((value) => value + 1)
      },
      {
        name: "prompt-status-tick",
        delayMs: 1000,
        unref: true,
      },
    )
    onCleanup(cancel)
  })

  const lastUserMessage = createMemo(() => {
    if (!props.sessionID) return undefined
    const messages = sync.data.message[props.sessionID]
    if (!messages) return undefined
    return messages.findLast((m) => m.role === "user")
  })

  const [store, setStore] = createStore<{
    prompt: PromptInfo
    mode: "normal" | "shell"
    extmarkToPartIndex: Map<number, number>
    placeholder: number
  }>({
    placeholder: Math.floor(Math.random() * PLACEHOLDERS.length),
    prompt: {
      input: "",
      parts: [],
    },
    mode: "normal",
    extmarkToPartIndex: new Map(),
  })

  createEffect(
    on(
      () => props.sessionID,
      (sessionID) => {
        if (sessionID) setDraftSessionID(undefined)
      },
      { defer: true },
    ),
  )

  const submitController = createPromptSubmitController({
    conversationSystem: language.system,
    t: language.t,
    get input() {
      return input
    },
    get store() {
      return store
    },
    setStore,
    setExpandedPastes,
    promptPartTypeId: () => promptPartTypeId,
    inputBlocked,
    syncPromptInputFromRenderable,
    promptModelWarning,
    clearPromptDraft,
    onSubmit: () => {
      draftLifecycle.submitted()
      props.onSubmit?.()
    },
    // A typed `exit`/`quit`/`:q` is an explicit quit, so it plays the ending
    // video; ctrl+c reaches the same flourish through the app_exit keybinding.
    exit: () => void exit.flourish(),
    sessionID: () => props.sessionID,
    workspaceID: () => props.workspaceID,
    get autocomplete() {
      return autocomplete
    },
    local,
    kv,
    command,
    sync,
    sdk,
    route,
    history,
    toast,
    log,
    status,
    queueModeEnabled,
    axEngineDownloadJob,
    setSubmitPending,
    submitPending,
    setSubmitStage,
    draftSessionID,
    setDraftSessionID,
    syncInputCursorColor,
  })
  submit = submitController.submit
  submitSteer = submitController.submitSteer

  function cancelPendingSubmit(message = language.t("error.cancelled")) {
    return submitController.cancelPendingSubmit(message)
  }

  // Subagents run in child sessions: while they work the parent reports
  // "idle" and the footer would otherwise render a blank row. Project the
  // most recently active child into the busy row so the spinner and label
  // keep moving until the whole session tree settles.
  // Declared before footerLayout: that memo reads this value at creation time.
  const subagentStatus = createMemo(() => {
    statusTick()
    if (!props.sessionID) return
    if (status().type !== "idle") return
    const self = sync.data.session.find((item) => item.id === props.sessionID)
    return footerSubagentStatusView({
      t: language.t,
      sessions: sync.data.session,
      statuses: sync.data.session_status,
      parentSessionID: self?.parentID ?? props.sessionID,
      now: Date.now(),
    })
  })

  // Mode chips (work mode / run mode / sandbox) live in the session sidebar
  // and, on Home, at the front of this footer's right-side hint row via
  // `props.footerRight` (right-aligned, just before the ctrl+c hint) — no
  // toggle width is reserved for them here.
  // ctrl+c is overloaded: it clears a non-empty draft and exits when the
  // input is empty — the footer hint mirrors whichever action currently applies.
  const footerClearHint = createMemo(() => {
    const hasDraft = hasPromptDraft(store.prompt.input, store.prompt.parts)
    return {
      keys: (hasDraft ? keybind.print("input_clear") : keybind.print("app_exit")) || "ctrl+c",
      label: hasDraft ? uiText("ui.clear2") : uiText("ui.exit"),
    }
  })
  const footerLayout = createMemo(() =>
    promptFooterLayout({
      contentWidth: promptContentWidth(),
      toggleWidth: 0,
      busy: status().type !== "idle" || subagentStatus() !== undefined,
      mode: store.mode,
      variantsWidth:
        local.model.variant.list().length > 0
          ? footerHintWidth(keybind.print("variant_cycle"), uiText("ui.effort"))
          : 0,
      shellWidth: footerHintWidth("esc", uiText("ui.exitShellMode")),
      clearWidth: footerHintWidth(footerClearHint().keys, footerClearHint().label),
    }),
  )

  createEffect(
    on(
      () => props.sessionID,
      () => {
        setStore("placeholder", Math.floor(Math.random() * PLACEHOLDERS.length))
        setExpandedPastes(new Set<number>())
      },
      { defer: true },
    ),
  )

  const pasteViews = createMemo(() => summarizedPasteViews(store.prompt.parts))
  const allPastesExpanded = createMemo(() => {
    const views = pasteViews()
    if (views.length === 0) return false
    const expanded = expandedPastes()
    return views.every((view) => expanded.has(view.partIndex))
  })

  createEffect(() => {
    const valid = new Set<number>(pasteViews().map((view) => view.partIndex))
    setExpandedPastes((current) => {
      const next = new Set<number>([...current].filter((partIndex) => valid.has(partIndex)))
      return next.size === current.size ? current : next
    })
  })

  function togglePastePreview(partIndex: number) {
    setExpandedPastes((current) => {
      const next = new Set<number>(current)
      if (next.has(partIndex)) next.delete(partIndex)
      else next.add(partIndex)
      return next
    })
  }

  function setAllPastePreviews(expanded: boolean) {
    setExpandedPastes(expanded ? new Set<number>(pasteViews().map((view) => view.partIndex)) : new Set<number>())
  }

  // Sync local agent/model/variant from the latest user message:
  // - On session change: pick up the session's last-known agent so the chip
  //   reflects what was active when the session was last used.
  // - On new message in the same session: catch server-generated user messages
  //   that carry a different agent (e.g. plan_exit creates a synthetic user
  //   message with agent="build" to hand off out of plan mode, the router
  //   switches "find the bug" to the debug agent). Without this, the
  //   bottom-left chip stays stale.
  // Restore the message's model only into the session-scoped selection. This
  // keeps an explicit model stable when the server auto-routes the turn to a
  // different agent, without copying that model into the agent's global
  // override and shadowing its config pin in unrelated sessions.
  //
  // Use `on()` so only sessionID, lastUserMessage, model-store readiness, and
  // the available primary-agent names trigger re-runs — reads of the current
  // agent inside don't add dependencies, otherwise a manual Tab-switch would
  // re-fire the effect and revert the user's choice. Waiting for readiness
  // also prevents the async preference load from overwriting a session
  // selection restored during bootstrap. Tracking agent names makes bootstrap
  // retry when messages arrive before the agent catalog.
  let syncedSessionID: string | undefined
  const primaryAgentNames = createMemo(() =>
    local.agent
      .list()
      .map((item) => item.name)
      .join("\u0000"),
  )
  createEffect(
    on(
      [() => props.sessionID, lastUserMessage, () => local.model.ready, primaryAgentNames],
      ([sessionID, msg, modelReady]) => {
        if (!modelReady) return
        const sessionChanged = sessionID !== syncedSessionID
        if (sessionChanged) {
          syncedSessionID = sessionID
          if (!sessionID || !msg) return
        }

        if (!sessionID || !msg?.agent) return

        // Only adopt primary-tier agents — subagent results shouldn't change the picker.
        const isPrimaryAgent = local.agent.list().some((x) => x.name === msg.agent)
        if (isPrimaryAgent) {
          if (msg.model && shouldAdoptMessageModelFromHistory(sessionChanged, local.model.session.has(sessionID))) {
            local.model.session.set(sessionID, msg.model, msg.agent)
          }
          const shouldSyncAgent = sessionChanged || msg.agent !== local.agent.current().name
          if (!shouldSyncAgent) return
          local.agent.set(msg.agent)
          // A variant belongs to the model it was chosen for; only carry it
          // over when the chip now shows that same model. A message without
          // a variant must not clear the stored one — it only means the
          // message predates the variant choice.
          const current = local.model.current()
          if (msg.model && msg.variant !== undefined && current && providerModelEquals(current, msg.model))
            local.model.variant.set(msg.variant)
        }
      },
    ),
  )

  const paste = createPromptPaste({
    get input() {
      return input
    },
    get store() {
      return store
    },
    setStore,
    pasteStyleId,
    promptPartTypeId: () => promptPartTypeId,
    inputBlocked,
    inputFocused: () => input?.focused ?? false,
    disablePasteSummary: () => !!sync.data.config.experimental?.disable_paste_summary,
    suppressAutocompleteForNextContentChange,
    requestInputLayoutRefresh,
    pasteSubmitGate,
    log,
    toast,
  })

  // The right-click context menu routes paste back through this gate-aware
  // path whenever the prompt owns the focused editor.
  const contextMenu = useContextMenu()
  onCleanup(
    contextMenu.registerPromptPaste({
      focused: () => input?.focused ?? false,
      paste: () => void paste.pasteClipboardText(),
    }),
  )

  const ref: PromptRef = {
    get focused() {
      return input.focused
    },
    get current() {
      return store.prompt
    },
    focus() {
      focusRenderable(input, { name: "prompt-ref-focus" })
    },
    blur() {
      blurRenderable(input, { name: "prompt-ref-blur" })
    },
    set(prompt) {
      input.setText(prompt.input)
      setStore("prompt", prompt)
      restoreExtmarksFromParts(prompt.parts)
      input.gotoBufferEnd()
    },
    reset() {
      input.clear()
      input.extmarks.clear()
      orphanedExtmarkParts.clear()
      setStore("prompt", {
        input: "",
        parts: [],
      })
      setStore("extmarkToPartIndex", new Map())
      setExpandedPastes(new Set<number>())
    },
    submit() {
      submit()
    },
  }

  createEffect(() => {
    if (props.visible !== false) focusRenderable(input, { name: "prompt-visible-focus" })
    if (props.visible === false) blurRenderable(input, { name: "prompt-hidden-blur" })
  })

  function restoreExtmarksFromParts(parts: PromptInfo["parts"]) {
    input.extmarks.clear()
    orphanedExtmarkParts.clear()
    setStore("extmarkToPartIndex", new Map())

    parts.forEach((part, partIndex) => {
      const view = promptPartExtmarkView(part, { fileStyleId, pasteStyleId, agentStyleId })

      if (view?.virtualText) {
        const extmarkId = input.extmarks.create({
          start: view.start,
          end: view.end,
          virtual: true,
          styleId: view.styleId,
          typeId: promptPartTypeId,
        })
        setStore("extmarkToPartIndex", (map: Map<number, number>) => {
          const newMap = new Map(map)
          newMap.set(extmarkId, partIndex)
          return newMap
        })
      }
    })
  }

  // Parts whose extmark vanished mid-edit (undo) are stashed here instead of
  // discarded, so the same extmark id reappearing (redo) re-links the part —
  // otherwise submit would send the literal "[Pasted ~N lines]" placeholder
  // with no part attached. Cleared whenever the composer content is replaced
  // wholesale (reset, draft clear, restoreExtmarksFromParts).
  const orphanedExtmarkParts = new Map<number, PromptInfo["parts"][number]>()

  function syncExtmarksWithPromptParts() {
    const allExtmarks = input.extmarks.getAllForTypeId(promptPartTypeId)
    setStore(
      produce((draft) => {
        const newMap = new Map<number, number>()
        const newParts: typeof draft.prompt.parts = []

        for (const extmark of allExtmarks) {
          const partIndex = draft.extmarkToPartIndex.get(extmark.id)
          if (partIndex !== undefined) {
            const part = draft.prompt.parts[partIndex]
            if (part) {
              setPromptPartSourceRange(part, extmark.start, extmark.end)
              newMap.set(extmark.id, newParts.length)
              newParts.push(part)
            }
            continue
          }
          // An unmapped extmark id we orphaned earlier means undo removed it
          // and redo brought it back — re-link the stashed part.
          const orphan = orphanedExtmarkParts.get(extmark.id)
          if (orphan) {
            orphanedExtmarkParts.delete(extmark.id)
            setPromptPartSourceRange(orphan, extmark.start, extmark.end)
            newMap.set(extmark.id, newParts.length)
            newParts.push(orphan)
          }
        }

        for (const [extmarkId, partIndex] of draft.extmarkToPartIndex) {
          if (newMap.has(extmarkId)) continue
          const part = draft.prompt.parts[partIndex]
          if (!part) continue
          orphanedExtmarkParts.set(extmarkId, unwrap(part))
        }
        while (orphanedExtmarkParts.size > MAX_ORPHANED_PROMPT_PARTS) {
          const oldest = orphanedExtmarkParts.keys().next().value
          if (oldest === undefined) break
          orphanedExtmarkParts.delete(oldest)
        }

        draft.extmarkToPartIndex = newMap
        draft.prompt.parts = newParts
      }),
    )
  }

  command.register(() =>
    promptCommands({
      t: language.t,
      input: () => input,
      store,
      setStore,
      setExpandedPastes,
      submit,
      pasteClipboardImage: paste.pasteClipboardImage,
      autocompleteVisible: () => !!autocomplete.visible,
      sessionID: () => props.sessionID,
      statusType: () => status().type,
      sdk,
      log,
      toast,
      renderer,
      restoreExtmarksFromParts,
      allPastesExpanded,
      pasteViewsLength: () => pasteViews().length,
      setAllPastePreviews,
      dialog,
      stash,
    }),
  )

  const draftLifecycle = createSessionPromptDraftLifecycle({
    drafts: usePromptRef().drafts,
    key: props.draftKey,
    read: () => ({
      prompt: unwrap(store.prompt),
      mode: store.mode,
      cursor: isRenderableAlive(input) ? input.cursorOffset : 0,
      expandedPastes: [...expandedPastes()],
    }),
    restore: (draft) => {
      // setText can emit synchronously; install attachments only after it has
      // completed, then recreate native marks from their saved source ranges.
      suppressAutocompleteForNextContentChange()
      input.setText(draft.prompt.input)
      setStore("prompt", draft.prompt)
      setStore("mode", draft.mode)
      restoreExtmarksFromParts(draft.prompt.parts)
      setExpandedPastes(new Set(draft.expandedPastes))
      input.cursorOffset = Math.min(draft.cursor, endDisplayOffset(draft.prompt.input))
    },
  })

  onCleanup(() => {
    draftLifecycle.dispose()
    paste.dispose()
    submitController.dispose()
  })

  const highlight = createMemo(() => {
    if (keybind.leader) return theme.border
    if (store.mode === "shell") return theme.primary
    return local.agent.color(local.agent.current().name)
  })

  // Show effort when the model exposes variants. Auto (no override) is still
  // visible so users know the knob exists and can cycle/open /effort.
  const showVariant = createMemo(() => local.model.variant.list().length > 0)

  const effortChipLabel = createMemo(() => effortDisplay(local.model.variant.current()))

  const placeholderText = createMemo(() => {
    if (props.sessionID) return undefined
    if (store.mode === "shell") {
      const example = SHELL_PLACEHOLDERS[store.placeholder % SHELL_PLACEHOLDERS.length]
      return uiText("ui.runACommandExample", { example })
    }
    if (!sync.data.provider_loaded || !local.model.ready) {
      return uiText("ui.providersAreLoadingPleaseWait")
    }
    if (!local.model.current()) {
      return sync.data.provider.length > 0 ? MSG_NO_MODEL : MSG_NO_PROVIDER
    }
    return uiText("ui.askAnythingExample", { example: uiText(PLACEHOLDERS[store.placeholder % PLACEHOLDERS.length]) })
  })

  // Footer busy indicator: two animal emoji picked at random from a large pool
  // and reshuffled every three seconds. They replace the old braille pixel art
  // in the footer, while the tab keeps its own A/X dot-matrix morph. Only
  // astral-plane emoji are used: this renderer gives those a fixed two-cell
  // width, whereas a base symbol plus U+FE0F measures one cell and would
  // misalign the row.

  // Context-window usage for the footer gauge (ADR-086). Undefined — and
  // therefore not rendered — unless auto-compaction is disabled: those
  // users manage the window by hand and the gauge tells them when to
  // /compact. Anchored on the most recent assistant message with usage
  // data; denominator is the raw input cap (budget.cap, falling back to
  // the advertised context limit).
  const contextGauge = createMemo(() => {
    if (!props.sessionID) return
    const msgs = sync.data.message[props.sessionID]
    if (!msgs) return
    const last = Usage.last(msgs) as any
    if (!last?.tokens) return
    const model = sync.data.provider.find((x: any) => x.id === last.providerID)?.models?.[last.modelID]
    const budget = model ? calculateCompactionBudget(model, sync.data.config.compaction?.reserved) : undefined
    return footerContextGauge({
      // The compactor compares the LATEST step's usage against the budget,
      // not the turn-cumulative message totals (which grow with every step
      // and would pin the gauge near 100% on any multi-step turn).
      totalTokens: effectiveTokenTotal(Usage.lastStepTokens(sync.data.part[last.id] ?? []) ?? last.tokens),
      budget,
      compactionAuto: sync.data.config.compaction?.auto,
      contextLimit: model?.limit?.context,
    })
  })

  // Number of compaction markers in the synced window. Surfaced next to
  // the gauge so the bar dropping after an auto-compaction reads as
  // information ("context was compacted") instead of a glitch.
  const compactionCount = createMemo(() => {
    if (!props.sessionID) return 0
    const msgs = sync.data.message[props.sessionID]
    if (!msgs) return 0
    let count = 0
    for (const msg of msgs) {
      for (const part of sync.data.part[msg.id] ?? []) {
        if (part.type === "compaction") count++
      }
    }
    return count
  })

  const busyStatus = createMemo(() => {
    statusTick()
    const current = status()
    if (current.type !== "busy") return subagentStatus()
    return footerSessionStatusView({
      t: language.t,
      status: current,
      messages: props.sessionID ? sync.data.message[props.sessionID] : undefined,
      now: Date.now(),
    })
  })
  // Live token totals + t/s rate for the prompt's busy row. Anchored on
  // the last assistant message that has tokens, paired with that
  // message's own time.created so the rate window matches the count.
  const tokenChipView = createMemo(() => {
    statusTick()
    if (!props.sessionID) return undefined
    const messages = sync.data.message[props.sessionID] ?? []
    const last = messages.findLast(
      (m): m is Extract<typeof m, { role: "assistant" }> =>
        m.role === "assistant" && (m.tokens.input > 0 || m.tokens.output > 0),
    )
    if (!last) return undefined
    const completed = last.time.completed
    const now = completed ?? Date.now()
    return footerTokenChip({
      tokens: last.tokens,
      startedAt: last.time.created,
      now,
      parts: sync.data.part[last.id] ?? [],
    })
  })
  const livenessIndicator = createMemo(() =>
    footerLivenessIndicator({
      tick: statusTick(),
      userEnabled: kv.get("animations_enabled", true),
    }),
  )

  const finishedStatus = createMemo(() => {
    if (!props.sessionID) return false
    if (status().type !== "idle") return false
    if (submitPending()) return false

    // /goal planning and task subagents run in child sessions: the parent
    // stays "idle" while they work, so suppress "Finished" until the whole
    // session tree has settled.
    const self = sync.data.session.find((item) => item.id === props.sessionID)
    if (
      hasActiveSubagentInSessionTree({
        sessions: sync.data.session,
        statuses: sync.data.session_status,
        parentSessionID: self?.parentID ?? props.sessionID,
      })
    )
      return false

    const msgs = sync.data.message[props.sessionID]
    const lastMessage = msgs?.at(-1)
    if (hasUnfinishedTodosInPromptParts(msgs, sync.data.part)) return false
    return lastMessage?.role === "assistant" && !lastMessage.error && Boolean(lastMessage.time?.completed)
  })

  return (
    <>
      <Autocomplete
        sessionID={props.sessionID}
        ref={(r) => (autocomplete = r)}
        anchor={() => anchor}
        input={() => input}
        setPrompt={(cb) => {
          setStore("prompt", produce(cb))
        }}
        clearPrompt={clearPromptDraft}
        setExtmark={(partIndex, extmarkId) => {
          setStore("extmarkToPartIndex", (map: Map<number, number>) => {
            const newMap = new Map(map)
            newMap.set(extmarkId, partIndex)
            return newMap
          })
        }}
        value={store.prompt.input}
        fileStyleId={fileStyleId}
        agentStyleId={agentStyleId}
        promptPartTypeId={() => promptPartTypeId}
      />
      <box ref={(r: BoxRenderable) => (anchor = r)} visible={props.visible !== false}>
        <Card accentColor={highlight()}>
          <box paddingLeft={2} paddingRight={2} flexShrink={0} backgroundColor={theme.backgroundElement} flexGrow={1}>
            <textarea
              placeholder={placeholderText()}
              textColor={keybind.leader ? theme.textMuted : theme.text}
              focusedTextColor={keybind.leader ? theme.textMuted : theme.text}
              minHeight={1}
              maxHeight={6}
              onContentChange={() => {
                draftLifecycle.edited()
                const suppressAutocomplete = suppressAutocompleteOnNextContentChange
                suppressAutocompleteOnNextContentChange = false
                syncPromptInputFromRenderable({ autocomplete: suppressAutocomplete ? false : undefined })
              }}
              keyBindings={textareaKeybindings()}
              onKeyDown={async (e: KeyEvent) => {
                // Disarm the double-Esc rewind window on any non-escape key up
                // front — keys consumed by early returns below (submit, paste,
                // mode switches, autocomplete) never reach the escape-intent
                // chain and would otherwise leave a stale arm behind.
                if (escapeRewindDisarmKey(e.name)) lastIdleEscapeAt = undefined
                const pendingIntent = pendingSubmitKeyIntent({
                  pending: submitPending() || submitController.submitInFlight,
                  appExit: keybind.match("app_exit", e),
                  sessionInterrupt: keybind.match("session_interrupt", e),
                })
                if (pendingIntent === "cancel") {
                  e.preventDefault()
                  e.stopPropagation()
                  cancelPendingSubmit()
                  return
                }
                if (pendingIntent === "block" || props.disabled) {
                  e.preventDefault()
                  e.stopPropagation()
                  return
                }
                if (isPromptSubmitKey(e) && pasteSubmitGate.deferSubmitUntilPasteHandled()) {
                  e.preventDefault()
                  e.stopPropagation()
                  return
                }
                if (isPromptSubmitKey(e)) {
                  if (autocomplete?.visible) {
                    if (autocomplete.onKeyDown(e)) return
                  }
                  e.preventDefault()
                  e.stopPropagation()
                  if (isPromptSubmitKey(e) === "steer") steerSafely()
                  else submitSafely()
                  return
                }
                // Handle clipboard paste (Ctrl+V) - check for images first on Windows
                // This is needed because Windows terminal doesn't properly send image data
                // through bracketed paste, so we need to intercept the keypress and
                // directly read from clipboard before the terminal handles it
                if (keybind.match("input_paste", e)) {
                  pasteSubmitGate.beginPasteHandling()
                  let handledPaste = false
                  try {
                    const content = await Clipboard.read()
                    if (!paste.canPaste()) {
                      e.preventDefault()
                      return
                    }
                    if (content?.mime.startsWith("image/")) {
                      e.preventDefault()
                      await paste.pasteImage({
                        filename: "clipboard",
                        mime: content.mime,
                        content: content.data,
                      })
                      handledPaste = true
                      return
                    }
                    // Text paste via clipboard read stays Windows-only here:
                    // other platforms deliver text through the terminal's
                    // bracketed paste event, and inserting directly would
                    // double-paste. The right-click context menu pastes on all
                    // platforms through paste.pasteClipboardText.
                    const text = process.platform === "win32" ? clipboardTextPaste({ content }) : undefined
                    if (text) {
                      e.preventDefault()
                      suppressAutocompleteForNextContentChange()
                      input.insertText(text)
                      requestInputLayoutRefresh({ autocomplete: false })
                      handledPaste = true
                      return
                    }
                  } catch (error) {
                    // This handler is async and AX Code TUI invokes it fire-and-forget —
                    // a clipboard failure must not become an unhandled rejection.
                    log.warn("tui.prompt.onKeyDown: clipboard paste failed", { error })
                    if (paste.canPaste()) toast.show({ variant: "error", message: uiText("ui.failedToReadClipboard") })
                  } finally {
                    pasteSubmitGate.finishPasteHandling({ submitDeferred: handledPaste && paste.canPaste() })
                  }
                  // If no supported clipboard fallback applies, let the default paste behavior continue.
                }
                if (keybind.match("input_clear", e) && hasPromptDraft(store.prompt.input, store.prompt.parts)) {
                  clearPromptDraft()
                  return
                }
                if (keybind.match("app_exit", e)) {
                  if (!hasPromptDraft(store.prompt.input, store.prompt.parts)) {
                    // preventDefault must happen synchronously — after the
                    // await the event has already been dispatched to the
                    // textarea's own handlers.
                    e.preventDefault()
                    try {
                      // An explicit ctrl+c exit plays the ending video before
                      // the renderer tears down; pressing it again skips it.
                      await exit.flourish()
                    } catch (error) {
                      log.warn("tui.prompt.onKeyDown: exit failed", { error })
                    }
                    return
                  }
                }
                if (e.name === "!" && input.visualCursor.offset === 0) {
                  setStore("placeholder", Math.floor(Math.random() * SHELL_PLACEHOLDERS.length))
                  setStore("mode", "shell")
                  e.preventDefault()
                  return
                }
                if (store.mode === "shell") {
                  if ((e.name === "backspace" && input.visualCursor.offset === 0) || e.name === "escape") {
                    setStore("mode", "normal")
                    e.preventDefault()
                    return
                  }
                }
                // Always feed keys to autocomplete when its dropdown is
                // visible — otherwise up/down/enter/tab would fall through
                // to the textarea's own keybindings (move-up/move-down,
                // submit) and the user can't navigate the dropdown. The
                // mode-gate still applies for the *initial* triggers
                // (`/`, `@`) which only make sense in normal mode.
                if (autocomplete?.visible) {
                  if (autocomplete.onKeyDown(e)) return
                } else if (store.mode === "normal") {
                  autocomplete?.onKeyDown(e)
                }
                const escapeIntent = promptEscapeClearIntent({
                  keyName: e.name,
                  hasDraft: hasPromptDraft(store.prompt.input, store.prompt.parts),
                  previousEscapeAt: lastDraftEscapeAt,
                  now: Date.now(),
                })
                lastDraftEscapeAt = escapeIntent.nextEscapeAt
                if (escapeIntent.action === "arm") {
                  e.preventDefault()
                  return
                }
                if (escapeIntent.action === "clear") {
                  clearPromptDraft()
                  e.preventDefault()
                  return
                }
                // Double-Esc with no draft on an idle session opens the rollback
                // dialog. The first Esc only arms the window and falls through
                // unconsumed, so dialog-close/selection-clear escape behavior
                // elsewhere keeps working.
                const rewindIntent = promptEscapeRewindIntent({
                  keyName: e.name,
                  hasDraft: hasPromptDraft(store.prompt.input, store.prompt.parts),
                  onSessionRoute: route.data.type === "session" && !!props.sessionID,
                  sessionIdle: status().type === "idle",
                  previousIdleEscapeAt: lastIdleEscapeAt,
                  now: Date.now(),
                })
                lastIdleEscapeAt = rewindIntent.nextIdleEscapeAt
                if (rewindIntent.action === "rewind") {
                  e.preventDefault()
                  openRollbackDialog()
                  return
                }
                if (!autocomplete?.visible) {
                  if (
                    (keybind.match("history_previous", e) && input.cursorOffset === 0) ||
                    (keybind.match("history_next", e) && input.cursorOffset === endDisplayOffset(input.plainText))
                  ) {
                    const direction = keybind.match("history_previous", e) ? -1 : 1
                    const item = history.move(direction, input.plainText)

                    if (item) {
                      input.setText(item.input)
                      setStore("prompt", item)
                      setStore("mode", item.mode ?? "normal")
                      restoreExtmarksFromParts(item.parts)
                      e.preventDefault()
                      if (direction === -1) input.cursorOffset = 0
                      if (direction === 1) input.cursorOffset = endDisplayOffset(input.plainText)
                    }
                    return
                  }

                  if (keybind.match("history_previous", e) && input.visualCursor.visualRow === 0) input.cursorOffset = 0
                  if (keybind.match("history_next", e) && input.visualCursor.visualRow === input.height - 1)
                    input.cursorOffset = endDisplayOffset(input.plainText)
                }
              }}
              onPaste={paste.handleTerminalPaste}
              ref={(r: TextareaRenderable) => {
                input = r
                if (promptPartTypeId === 0) {
                  promptPartTypeId = input.extmarks.registerType("prompt-part")
                }
                draftLifecycle.restore()
                props.ref?.(ref)
                syncInputCursorColor()
              }}
              onMouseDown={(r: MouseEvent) => {
                focusRenderable(r.target, { name: "prompt-mouse-target-focus" })
                // Right-click stays unconsumed so the app-level context menu
                // (copy/paste) opens; its paste routes back through
                // pasteClipboardText via the context-menu registration below.
              }}
              focusedBackgroundColor={theme.backgroundElement}
              cursorColor={theme.text}
              syntaxStyle={syntax()}
            />
            <box flexDirection={dimensions().width < 60 ? "column" : "row"} flexShrink={0} paddingTop={1} gap={1}>
              <text fg={highlight()}>
                {store.mode === "shell"
                  ? "Shell"
                  : local.agent.icon(local.agent.current().name) +
                    " " +
                    (local.agent.current().displayName ?? Locale.titlecase(local.agent.current().name))}{" "}
              </text>
              <Show when={store.mode === "normal"}>
                <box flexDirection="row" gap={1}>
                  {/* Clicking the model name opens the model picker — the same
                      registered-command path as the model_list keybind and the
                      /model slash command. The handler lives on the wrapping
                      box, never on <text>: clicks on text nested in a flex row
                      are unreliable (see ModeChips). Connection/download/effort
                      chips stay outside on purpose — they are status, not the
                      model identity. */}
                  <box flexDirection="row" gap={1} flexShrink={0} onMouseUp={() => command.trigger("model.list")}>
                    <text flexShrink={0} fg={keybind.leader ? theme.textMuted : theme.text}>
                      {local.model.parsed().model}
                    </text>
                    <Show when={dimensions().width >= 60}>
                      <text fg={theme.textMuted}>{local.model.parsed().provider}</text>
                    </Show>
                  </box>
                  <Show when={connectionChip()}>
                    {(chip) => (
                      <>
                        {/* ASCII separator: U+00B7 middle dot is East Asian
                            Ambiguous width and shifted following chips on
                            CJK terminals (overlap bug class, see gauge). */}
                        <text fg={theme.textMuted}>-</text>
                        <text flexShrink={0} fg={theme.warning}>
                          {chip()}
                        </text>
                      </>
                    )}
                  </Show>
                  <Show when={downloadChip()}>
                    {(chip) => (
                      <>
                        <text fg={theme.textMuted}>-</text>
                        <text flexShrink={0} fg={theme.warning}>
                          {chip()}
                        </text>
                      </>
                    )}
                  </Show>
                  <Show when={showVariant()}>
                    <text fg={theme.textMuted}>-</text>
                    <text>
                      <span style={{ fg: theme.textMuted }}>{uiText("ui.effort2")} </span>
                      <span
                        style={{
                          fg: local.model.variant.current() ? theme.warning : theme.textMuted,
                          bold: !!local.model.variant.current(),
                        }}
                      >
                        {effortChipLabel()}
                      </span>
                    </text>
                  </Show>
                </box>
              </Show>
            </box>
            <Show when={keybind.leader}>
              <box
                flexDirection="row"
                flexShrink={0}
                paddingTop={1}
                paddingBottom={0}
                gap={1}
                backgroundColor={theme.backgroundElement}
              >
                <text>
                  <span style={{ fg: theme.warning, bold: true }}>{uiText("ui.leaderActive")}</span>
                </text>
                <text fg={theme.textMuted}>{uiText("ui.pressShortcutKeyOrWaitToCancel")}</text>
              </box>
            </Show>
            <Show when={pasteViews().length > 0}>
              <box flexDirection="column" gap={1} paddingTop={1}>
                <For each={pasteViews()}>
                  {(view) => {
                    const expanded = createMemo(() => expandedPastes().has(view.partIndex))
                    const previewText = createMemo(() => {
                      if (expanded()) return view.text
                      const lines = [...view.previewLines]
                      if (view.hiddenLineCount > 0) {
                        lines.push(uiText("ui.countMoreLines", { count: view.hiddenLineCount }))
                      }
                      return lines.join("\n")
                    })

                    // Click-vs-drag detection: the previous impl checked
                    // renderer.getSelection() at mouseUp, which blocked the
                    // toggle whenever ANY selection existed anywhere on
                    // screen — including stale selections from prior clicks
                    // (Selection.copy clears the selection asynchronously)
                    // and zero-width phantom selections created by a click
                    // itself. Track mousedown coordinates and only toggle
                    // when mouseup lands on (roughly) the same cell.
                    let downX: number | undefined
                    let downY: number | undefined

                    return (
                      <box
                        border={["left"]}
                        borderColor={theme.warning}
                        customBorderChars={EmptyBorder}
                        backgroundColor={theme.backgroundPanel}
                        onMouseDown={(evt: MouseEvent) => {
                          downX = evt.x
                          downY = evt.y
                        }}
                        onMouseUp={(evt: MouseEvent) => {
                          const sx = downX
                          const sy = downY
                          downX = undefined
                          downY = undefined
                          if (sx === undefined || sy === undefined) return
                          // Treat anything beyond a ±1 cell tolerance as a
                          // drag (text selection); otherwise it's a click.
                          if (Math.abs(evt.x - sx) > 1 || Math.abs(evt.y - sy) > 1) return
                          togglePastePreview(view.partIndex)
                        }}
                      >
                        <box paddingLeft={2} paddingRight={1} paddingTop={1} paddingBottom={1}>
                          <text fg={theme.text}>
                            {/* ASCII marker: U+25A3 is East Asian Ambiguous
                                width and shifted the label on CJK terminals
                                (overlap bug class, see gauge). */}
                            <span style={{ fg: theme.warning }}>&gt; </span>
                            {view.label}
                          </text>
                          <text fg={theme.textMuted}>{previewText()}</text>
                          <text fg={theme.textMuted}>
                            {expanded() ? uiText("ui.clickToCollapse") : uiText("ui.clickToExpand")}
                          </text>
                        </box>
                      </box>
                    )
                  }}
                </For>
              </box>
            </Show>
          </box>
        </Card>
        <Show when={statusLine()}>
          {(line) => (
            <box flexShrink={0}>
              <text fg={theme.textMuted}>{line()}</text>
            </box>
          )}
        </Show>
        <box
          flexDirection={footerLayout().stacked ? "column" : "row"}
          justifyContent={footerLayout().stacked ? "flex-start" : "space-between"}
          gap={footerLayout().stacked ? 1 : 0}
        >
          <Show
            when={status().type !== "idle" || subagentStatus() !== undefined}
            fallback={
              <Show
                when={submitPending()}
                fallback={
                  <Show when={finishedStatus()} fallback={<text />}>
                    <text fg={theme.success}>{uiText("ui.finished")}</text>
                  </Show>
                }
              >
                <text fg={theme.warning}>
                  {pendingSubmitStatusText(submitStage())}
                  {pendingCancelHint() ? " " + uiText("ui.keysToCancel", { keys: pendingCancelHint() ?? "" }) : ""}
                </text>
              </Show>
            }
          >
            {/* Only the active parent can be interrupted, even when its subagent keeps this row visible. */}
            <FooterStatusRow
              width={promptContentWidth()}
              interrupt={status().type !== "idle" ? uiText("ui.interrupt") : undefined}
            >
              <box flexShrink={0} flexDirection="row" gap={1}>
                <box marginLeft={1} flexDirection="row" gap={1}>
                  <Show
                    when={livenessIndicator().type === "native-spinner"}
                    fallback={
                      <text fg={busyStatus()?.stale ? theme.warning : theme.textMuted}>
                        {footerLivenessTextFrame(livenessIndicator())}
                      </text>
                    }
                  >
                    <FooterAnimationSpinner />
                  </Show>
                  <Show when={busyStatus()?.stale}>
                    <text fg={theme.warning}>!</text>
                  </Show>
                </box>
                <box flexDirection="row" gap={1} flexShrink={0}>
                  <Show when={busyStatus()?.label}>
                    <text fg={busyStatus()?.tone === "warning" ? theme.warning : theme.textMuted}>
                      {busyStatus()?.label}
                    </text>
                  </Show>
                  <Show when={tokenChipView()} keyed>
                    {(chip) => (
                      <text fg={theme.textMuted}>
                        {uiText("ui.inputTokens")} {chip.input} {uiText("ui.outputTokens")} {chip.output}
                        <Show when={chip.rate}>
                          <span style={{ fg: theme.textMuted }}> - {chip.rate}</span>
                        </Show>
                      </text>
                    )}
                  </Show>
                  {(() => {
                    const retry = createMemo(() => {
                      const s = status()
                      if (s.type !== "retry") return
                      return s
                    })
                    const message = createMemo(() => {
                      const r = retry()
                      if (!r) return
                      if (r.message.includes("exceeded your current quota") && r.message.includes("gemini"))
                        return "Gemini API quota exceeded"
                      if (r.message.length > 120) return r.message.slice(0, 120) + "..."
                      return r.message
                    })
                    const isTruncated = createMemo(() => {
                      const r = retry()
                      if (!r) return false
                      return r.message.length > 120
                    })
                    const [seconds, setSeconds] = createSignal(0)
                    onMount(() => {
                      const cancel = scheduleTuiInterval(
                        () => {
                          const next = retry()?.next
                          if (next) setSeconds(Math.round((next - Date.now()) / 1000))
                        },
                        {
                          name: "prompt-retry-countdown",
                          delayMs: 1000,
                          unref: true,
                        },
                      )

                      onCleanup(cancel)
                    })
                    const handleMessageClick = () => {
                      const r = retry()
                      if (!r) return
                      if (r.message) {
                        DialogAlert.show(dialog, "Retry Error", r.message)
                      }
                    }

                    const retryText = () => {
                      const r = retry()
                      if (!r) return ""
                      const baseMessage = message()
                      const truncatedHint = isTruncated() ? " (click to expand)" : ""
                      const duration = formatDuration(seconds())
                      const retryInfo = ` [retrying ${duration ? `in ${duration} ` : ""}attempt #${r.attempt}]`
                      return baseMessage + truncatedHint + retryInfo
                    }

                    return (
                      <Show when={retry()}>
                        <box onMouseUp={handleMessageClick}>
                          <text fg={theme.error} wrapMode="none">
                            {retryText()}
                          </text>
                        </box>
                      </Show>
                    )
                  })()}
                </box>
              </box>
            </FooterStatusRow>
          </Show>
          <Show when={status().type !== "retry"}>
            <box
              gap={footerLayout().stacked ? 0 : 1}
              flexDirection={footerLayout().stacked ? "column" : "row"}
              flexShrink={0}
            >
              <Show when={contextGauge()}>
                <box flexDirection="row" flexShrink={0} paddingRight={1}>
                  <Gauge
                    view={contextGauge()}
                    label={
                      compactionCount() > 0 ? uiText("ui.compactedXCount", { count: compactionCount() }) : undefined
                    }
                  />
                </box>
              </Show>
              <Show
                when={
                  props.footerRight ||
                  footerLayout().showVariants ||
                  footerLayout().showShellHint ||
                  footerLayout().showClearHint
                }
              >
                <box gap={2} flexDirection="row" flexShrink={0}>
                  {props.footerRight}
                  <Switch>
                    <Match when={store.mode === "normal"}>
                      <Show when={footerLayout().showClearHint}>
                        <KeyHint keys={footerClearHint().keys} label={footerClearHint().label} />
                      </Show>
                      <Show when={footerLayout().showVariants}>
                        <KeyHint keys={keybind.print("variant_cycle")} label={uiText("ui.effort")} />
                      </Show>
                    </Match>
                    <Match when={store.mode === "shell"}>
                      <Show when={footerLayout().showShellHint}>
                        <KeyHint keys="esc" label={uiText("ui.exitShellMode")} />
                      </Show>
                    </Match>
                  </Switch>
                </box>
              </Show>
            </box>
          </Show>
        </box>
      </box>
    </>
  )
}
