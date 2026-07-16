import {
  BoxRenderable,
  TextareaRenderable,
  MouseEvent,
  PasteEvent,
  KeyEvent,
  MouseButton,
  decodePasteBytes,
  RGBA,
} from "@ax-code/opentui-core"
import {
  createEffect,
  createMemo,
  onMount,
  createSignal,
  onCleanup,
  on,
  untrack,
  Show,
  Switch,
  Match,
  For,
} from "solid-js"
import path from "path"
import { Filesystem } from "@/util/filesystem"
import { providerModelKey } from "@/provider/model-key"
import { useLocal } from "@tui/context/local"
import { useTheme } from "@tui/context/theme"
import { EmptyBorder } from "@tui/component/border"
import { Card } from "@tui/ui/primitives/card"
import { useSDK } from "@tui/context/sdk"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { isQueueableStatus } from "./follow-up-queue"
import {
  clearFollowUpEdit,
  enqueueFollowUp,
  followUpEditRequest,
  forgetFollowUpSession,
  markFollowUpAbort,
  reconcileFollowUpDrain,
  removeQueuedFollowUp,
} from "./follow-up-queue-store"
import { createStore, produce, unwrap } from "solid-js/store"
import { useKeybind } from "@tui/context/keybind"
import { usePromptHistory, type PromptInfo } from "./history"
import { assign } from "./part"
import { usePromptStash } from "./stash"
import { type AutocompleteRef, Autocomplete } from "./autocomplete"
import { useCommandDialog } from "../dialog-command"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@ax-code/opentui-solid"
import { Editor } from "@tui/util/editor"
import { scheduleMicrotaskTask } from "@tui/util/microtask"
import { blurRenderable, focusRenderable, isRenderableAlive } from "@tui/util/renderable-safety"
import { scheduleTuiInterval, scheduleTuiTimeout } from "@tui/util/timer"
import { useExit } from "../../context/exit"
import { Clipboard } from "../../util/clipboard"
import type { FilePart } from "@ax-code/sdk/v2"
import { TuiEvent } from "../../event"
import { iife } from "@/util/iife"
import { Locale } from "@/util/locale"
import { formatDuration } from "@/util/format"
import { createColors, createFrames } from "../../ui/spinner.ts"
import { useDialog } from "@tui/ui/dialog"
import { DialogAlert } from "../../ui/dialog-alert"
import { useToast } from "../../ui/toast"
import { useKV } from "../../context/kv"
import { useTextareaKeybindings } from "../textarea-keybindings"
import { Usage } from "../../routes/session/usage"
import { Log } from "@/util/log"
import { DiagnosticLog } from "@/debug/diagnostic-log"
import {
  promptEscapeClearIntent,
  createPromptPasteSubmitGate,
  isPromptExitCommand,
  isUnmodifiedPromptSubmitKey,
  promptSubmissionView,
  sanitizePromptInput,
  windowsClipboardTextPaste,
} from "./view-model"
import { OpenTuiSpinner } from "../spinner"
import { upsert } from "../../context/sync-util"
import { summarizedPasteViews } from "./paste-view-model"
import { withTimeout } from "@/util/timeout"
import { footerContextGauge, footerSessionStatusView, footerTokenChip } from "../../routes/session/footer-view-model"
import { runMode, runModeLabel } from "./run-mode-view-model"
import { Gauge } from "@tui/ui/primitives/gauge"
import { KeyHint } from "@tui/ui/primitives/key-hint"
import { selectedForeground } from "@tui/context/theme"
import { footerToggleLabel } from "./footer-toggle"
import { footerHintWidth, promptFooterLayout } from "./footer-layout"
import { WorkMode } from "@/mode/work-mode"
import { computeSessionMainPaneWidth } from "../../routes/session/layout"
import { directoryRequestHeaders } from "@tui/util/request-headers"
import {
  createSubmitAbortError,
  isSubmitAbortError,
  pendingSubmitKeyIntent,
  pendingSubmitStatusText,
  type SubmitStage,
} from "./submit-state"
import { footerLivenessIndicator, footerLivenessTextFrame } from "./liveness-view-model"
import { parsePastedFilePath } from "./prompt-filepath"
import { responseErrorMessage } from "@tui/util/error-message"
import {
  endDisplayOffset,
  expandPromptTextParts,
  hasUnfinishedTodosInPromptParts,
  promptPartExtmarkView,
  relocatePromptPartAfterEditor,
  setPromptPartSourceRange,
} from "./prompt-helpers"
import { PLACEHOLDERS, SHELL_PLACEHOLDERS, SUBMIT_ACCEPT_TIMEOUT_MS } from "./prompt-config"
import type { AsyncSessionRoute, PromptProps, PromptRef } from "./prompt-types"

export type { PromptProps, PromptRef } from "./prompt-types"

const log = Log.create({ service: "tui.prompt" })
const SUPER_LONG_PINK = RGBA.fromHex("#ff4db8")
/** Work-mode chip backgrounds — fixed green/blue/purple (not theme tokens). */
const WORK_MODE_CHIP_BG: Record<WorkMode.Id, RGBA> = {
  agent: RGBA.fromHex(WorkMode.chipColorHex("agent")),
  council: RGBA.fromHex(WorkMode.chipColorHex("council")),
  arena: RGBA.fromHex(WorkMode.chipColorHex("arena")),
}
// Upper bound for parts kept around after their extmark disappears (undo);
// enough for any realistic undo depth without letting the map grow unbounded.
const MAX_ORPHANED_PROMPT_PARTS = 50

// Shared copy for the "can't send a prompt yet" states, used by both the submit
// toast and the input placeholder so the two never drift apart.
const MSG_NO_MODEL = "No model available — check your provider configuration"
const MSG_NO_PROVIDER = "No provider configured — connect a provider to send prompts"

export function Prompt(props: PromptProps) {
  let input: TextareaRenderable
  let anchor: BoxRenderable
  let autocomplete: AutocompleteRef

  const keybind = useKeybind()
  const local = useLocal()
  const sdk = useSDK()
  const route = useRoute()
  const dimensions = useTerminalDimensions()
  const sync = useSync()
  const dialog = useDialog()
  const toast = useToast()
  const status = createMemo(() => sync.data.session_status?.[props.sessionID ?? ""] ?? { type: "idle" })
  const history = usePromptHistory()
  const stash = usePromptStash()
  const command = useCommandDialog()
  const renderer = useRenderer()
  const { theme, syntax } = useTheme()
  const kv = useKV()
  const [submitPending, setSubmitPending] = createSignal(false)
  const [submitStage, setSubmitStage] = createSignal<SubmitStage | undefined>()
  const [draftSessionID, setDraftSessionID] = createSignal<string | undefined>()
  const [expandedPastes, setExpandedPastes] = createSignal<Set<number>>(new Set<number>())
  const inputBlocked = createMemo(() => props.disabled || submitPending())

  // ADR-028: interactive follow-up queueing. While the session is busy, plain
  // prompts are buffered client-side and replayed when the session goes idle,
  // instead of parking durable `waiting_for_idle` task-queue rows. Default on;
  // disabling falls back to immediate async send.
  const [queueModeEnabled] = kv.signal("prompt_queue_mode", true)

  // Drain the client follow-up queue when any session transitions busy/retry ->
  // idle. This watches every session's status (not just the one on screen) so a
  // background session's queue still replays when it finishes — matching the
  // desktop auto-send hook. The store dedupes across the multiple mounted Prompt
  // instances, so running this effect in each is safe.
  createEffect(() => {
    const record = sync.data.session_status ?? {}
    const snapshot: Array<readonly [string, string]> = []
    for (const id of Object.keys(record)) {
      snapshot.push([id, (record[id] as { type?: string } | undefined)?.type ?? "idle"] as const)
    }
    untrack(() => {
      reconcileFollowUpDrain(sdk, snapshot, (sessionID, error) => {
        log.warn("follow-up queue drain failed", {
          command: "tui.prompt.queue.drain",
          status: "error",
          sessionID,
          error,
        })
        // Keep the item queued (it stays visible with send-now/edit) and let the
        // user know the auto-send did not go through.
        toast.show({ message: "Failed to send queued message", variant: "error" })
      })
    })
  })
  const [localStatusTick, setLocalStatusTick] = createSignal(0)
  const statusTick = () => props.statusTick?.() ?? localStatusTick()
  const pendingCancelHint = createMemo(() => {
    const hints = new Set<string>()
    const sessionInterrupt = keybind.print("session_interrupt")
    const appExit = keybind.print("app_exit")
    if (sessionInterrupt) hints.add(sessionInterrupt)
    if (appExit) hints.add(appExit)
    return [...hints].join("/")
  })
  let submitAbort: AbortController | undefined
  let submitRunID = 0
  let submitInFlight = false
  let cancelRouteHandoff: (() => void) | undefined
  let lastDraftEscapeAt: number | undefined

  function upsertSessionInStore(session: (typeof sync.data.session)[number]) {
    sync.set(
      "session",
      produce((draft) => {
        upsert(draft, session)
      }),
    )
  }

  function footerToggleChip(input: {
    label: string
    active: boolean
    activeFg: unknown
    inactiveFg: unknown
    background?: unknown
    onMouseUp: () => void
  }) {
    const fg = input.active
      ? input.background
        ? selectedForeground(theme, input.background as any)
        : input.activeFg
      : input.inactiveFg

    // onMouseUp lives on the wrapping <box>, not the inner <text>: text
    // elements in OpenTUI primarily handle text selection, and click events
    // on them are unreliable when nested inside a flex box. The pattern that
    // actually works is the same one header.tsx / dialog-confirm.tsx use —
    // a <box> with onMouseUp that contains the <text> for rendering.
    return (
      <box flexShrink={0} onMouseUp={input.onMouseUp}>
        <text>
          <span
            style={{
              fg: fg as any,
              bg: input.active ? (input.background as any) : undefined,
              bold: input.active,
            }}
          >
            {footerToggleLabel(input.label, input.active)}
          </span>
        </text>
      </box>
    )
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
        toast.show({ message: "Failed to open provider dialog", variant: "error" })
      })
  }

  function promptModelWarning() {
    if (!sync.data.provider_loaded) {
      toast.show({
        variant: "info",
        message: "Providers are still loading. Please wait about 10 seconds and try again.",
        duration: 4000,
      })
      return
    }
    if (sync.data.provider_failed) {
      toast.show({
        variant: "warning",
        message: "Providers failed to load — check your configuration",
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

  function errorMessage(error: unknown) {
    if (error instanceof Error) return error.message
    if (typeof error === "string") return error
    return "Unknown error"
  }

  function reportSubmitFailure(action: string, error: unknown) {
    const message = errorMessage(error)
    log.error(`${action} failed`, { error })
    toast.show({
      message: `${action} failed: ${message}`,
      variant: "error",
    })
  }

  const textareaKeybindings = useTextareaKeybindings({ submit: false, interceptEnter: true })

  function isPromptSubmitKey(event: KeyEvent) {
    // Explicit newline binding wins over the built-in Enter->submit fallback so
    // a user can rebind Enter to insert a newline instead of submitting.
    if (keybind.match("input_newline", event)) return false
    if (keybind.match("input_submit", event)) return true
    return isUnmodifiedPromptSubmitKey(event)
  }

  const pasteSubmitGate = createPromptPasteSubmitGate({ submit: () => void submit() })

  useKeyboard((evt) => {
    if (!isRenderableAlive(input) || !input.focused) return
    if (!isPromptSubmitKey(evt)) return
    log.info("tui.prompt.useKeyboard: submit key detected", { keyName: evt.name })
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
    void submit()
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

  // ADR-028: edit a queued follow-up — the sidebar removes it from the queue and
  // requests its text here so the user can revise and resubmit it.
  createEffect(() => {
    const request = followUpEditRequest()
    if (!request) return
    untrack(() => {
      // Several Prompt instances are mounted at once (session, permission,
      // home). Only the instance the request targets consumes it — otherwise a
      // non-matching instance could clear the request before the right one
      // applies it, silently dropping the user's edited text.
      if (request.sessionID !== props.sessionID) return
      // Remove from the queue only once the text actually lands in the composer,
      // so a request that arrives while the input is unavailable doesn't lose
      // the message (it stays queued and can be edited again).
      if (isRenderableAlive(input)) {
        input.insertText(request.text)
        requestInputLayoutRefresh({ gotoBufferEnd: true })
        removeQueuedFollowUp(request.sessionID, request.id)
      }
      clearFollowUpEdit()
    })
  })

  // Forget client follow-up state for sessions that no longer exist so queues,
  // drain baselines, and abort marks don't leak (and a recreated id can't
  // inherit a stale baseline). Runs in every Prompt instance; forget is
  // idempotent. Skip pruning when the list is empty — that is almost always a
  // transient bootstrap/reconnect blip, and forgetting then would drop live
  // queues for sessions that are about to reappear.
  let knownFollowUpSessions = new Set<string>()
  createEffect(() => {
    const current = new Set((sync.data.session ?? []).map((s) => s.id))
    untrack(() => {
      if (current.size === 0) return
      for (const id of knownFollowUpSessions) {
        if (!current.has(id)) forgetFollowUpSession(id)
      }
      knownFollowUpSessions = current
    })
  })

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
    interrupt: number
    placeholder: number
  }>({
    placeholder: Math.floor(Math.random() * PLACEHOLDERS.length),
    prompt: {
      input: "",
      parts: [],
    },
    mode: "normal",
    extmarkToPartIndex: new Map(),
    interrupt: 0,
  })
  let cancelInterruptTimer: (() => void) | undefined

  createEffect(
    on(
      () => props.sessionID,
      (sessionID) => {
        if (sessionID) setDraftSessionID(undefined)
      },
      { defer: true },
    ),
  )

  function cancelPendingSubmit(message = "Prompt submission cancelled") {
    if (!submitPending() && !submitInFlight) return false
    submitRunID++
    if (cancelRouteHandoff) {
      cancelRouteHandoff()
      cancelRouteHandoff = undefined
    }
    const abort = submitAbort
    submitAbort = undefined
    submitInFlight = false
    setSubmitPending(false)
    setSubmitStage(undefined)
    abort?.abort(createSubmitAbortError(message))
    toast.show({
      message,
      variant: "info",
      duration: 2000,
    })
    syncInputCursorColor()
    return true
  }

  const footerRunMode = createMemo(() => runMode({ autonomous: sync.data.autonomous, superLong: sync.data.superLong }))

  // Single active mode only (click cycles Agent → Council → Arena), same pattern as run mode.
  const footerWorkMode = createMemo(() => WorkMode.parse(kv.get("work_mode", WorkMode.DEFAULT)))
  const footerWorkModeLabel = createMemo(() => WorkMode.label(footerWorkMode()))
  const footerLayout = createMemo(() =>
    promptFooterLayout({
      contentWidth: promptContentWidth(),
      toggleWidth:
        footerToggleLabel(footerWorkModeLabel(), true).length +
        footerToggleLabel(runModeLabel(footerRunMode()), footerRunMode() !== "none").length +
        footerToggleLabel("Sandbox", sync.data.isolation.mode !== "full-access").length,
      mode: store.mode,
      variantsWidth:
        local.model.variant.list().length > 0 ? footerHintWidth(keybind.print("variant_cycle"), "variants") : 0,
      shellWidth: footerHintWidth("esc", "exit shell mode"),
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
  //   message with agent="build" to hand off out of plan mode). Without this,
  //   the bottom-left chip stays stale.
  //
  // Use `on()` so only sessionID and lastUserMessage trigger re-runs — reads
  // of local.agent inside don't add dependencies, otherwise a manual Tab-
  // switch would re-fire the effect and revert the user's choice.
  let syncedSessionID: string | undefined
  createEffect(
    on([() => props.sessionID, lastUserMessage], ([sessionID, msg]) => {
      const sessionChanged = sessionID !== syncedSessionID
      if (sessionChanged) {
        syncedSessionID = sessionID
        if (!sessionID || !msg) return
      } else {
        // Same session: only sync when the message agent actually differs
        // from what the chip shows (e.g. plan_exit just handed off to build).
        if (!msg?.agent || msg.agent === local.agent.current().name) return
      }

      // Only adopt primary-tier agents — subagent results shouldn't change the picker.
      const isPrimaryAgent = local.agent.list().some((x) => x.name === msg.agent)
      if (msg.agent && isPrimaryAgent) {
        local.agent.set(msg.agent)
        if (!sessionChanged && msg.model) local.model.set(msg.model)
        if (msg.variant) local.model.variant.set(msg.variant)
      }
    }),
  )

  command.register(() => {
    return [
      {
        title: "Clear prompt",
        value: "prompt.clear",
        category: "Prompt",
        hidden: true,
        onSelect: (dialog) => {
          input.extmarks.clear()
          input.clear()
          setStore("prompt", {
            input: "",
            parts: [],
          })
          setStore("extmarkToPartIndex", new Map())
          setExpandedPastes(new Set<number>())
          dialog.clear()
        },
      },
      {
        title: "Submit prompt",
        value: "prompt.submit",
        keybind: "input_submit",
        category: "Prompt",
        hidden: true,
        onSelect: (dialog) => {
          if (!input.focused) return
          submit()
          dialog.clear()
        },
      },
      {
        title: "Paste",
        value: "prompt.paste",
        keybind: "input_paste",
        category: "Prompt",
        hidden: true,
        onSelect: async () => {
          await pasteClipboardImage()
        },
      },
      {
        title: "Exit shell mode",
        value: "shell.exit",
        keybind: "session_interrupt",
        category: "Session",
        hidden: true,
        enabled: store.mode === "shell",
        onSelect: (dialog) => {
          if (autocomplete.visible) return
          if (!input.focused) return
          setStore("mode", "normal")
          dialog.clear()
        },
      },
      {
        title: "Interrupt session",
        value: "session.interrupt",
        keybind: "session_interrupt",
        category: "Session",
        hidden: true,
        enabled: status().type !== "idle" && store.mode !== "shell",
        onSelect: (dialog) => {
          if (autocomplete.visible) return
          if (!input.focused) return
          if (!props.sessionID) return

          const nextInterrupt = store.interrupt + 1
          setStore("interrupt", nextInterrupt)

          if (cancelInterruptTimer) {
            cancelInterruptTimer()
            cancelInterruptTimer = undefined
          }

          if (nextInterrupt >= 2) {
            // Suppress auto-draining the follow-up queue right after a manual
            // interrupt so we don't immediately resend on the busy -> idle edge.
            markFollowUpAbort(props.sessionID)
            void sdk.client.session
              .abort({
                sessionID: props.sessionID,
              })
              .catch((error) => {
                log.warn("prompt session interrupt failed", {
                  error,
                  sessionID: props.sessionID,
                })
                toast.show({
                  message: error instanceof Error ? error.message : "Failed to interrupt session",
                  variant: "error",
                })
              })
            setStore("interrupt", 0)
          } else {
            cancelInterruptTimer = scheduleTuiTimeout(
              () => {
                cancelInterruptTimer = undefined
                setStore("interrupt", 0)
              },
              {
                name: "prompt-interrupt-reset",
                delayMs: 5000,
                unref: true,
              },
            )
          }
          dialog.clear()
        },
      },
      {
        title: "Open editor",
        category: "Session",
        keybind: "editor_open",
        value: "prompt.editor",
        slash: {
          name: "editor",
        },
        onSelect: async (dialog) => {
          dialog.clear()

          const text = expandPromptTextParts(store.prompt.input, store.prompt.parts)

          const nonTextParts = store.prompt.parts.filter((p) => p.type !== "text")

          const value = text
          const result = await Editor.open({ value, renderer })
          if (result.status === "missing-editor") {
            toast.show({
              message: "No editor configured. Set VISUAL or EDITOR to use /editor.",
              variant: "warning",
            })
            return
          }
          if (result.status === "cancelled") return
          const content = result.content

          input.setText(content)

          // Update positions for nonTextParts based on their location in new content
          // Filter out parts whose virtual text was deleted
          // this handles a case where the user edits the text in the editor
          // such that the virtual text moves around or is deleted
          const updatedNonTextParts = nonTextParts
            .map((part) => relocatePromptPartAfterEditor(part, content))
            .filter((part) => part !== null)

          setStore("prompt", {
            input: content,
            // keep only the non-text parts because the text parts were
            // already expanded inline
            parts: updatedNonTextParts,
          })
          restoreExtmarksFromParts(updatedNonTextParts)
          input.cursorOffset = endDisplayOffset(content)
        },
      },
      {
        title: allPastesExpanded() ? "Collapse pasted previews" : "Expand pasted previews",
        value: "prompt.paste.preview.toggle",
        category: "Prompt",
        enabled: pasteViews().length > 0,
        onSelect: (dialog) => {
          setAllPastePreviews(!allPastesExpanded())
          dialog.clear()
        },
      },
      {
        title: "Skills",
        value: "prompt.skills",
        category: "Prompt",
        slash: {
          name: "skills",
        },
        onSelect: () => {
          const marker = dialog.stack.at(-1)
          import("../dialog-skill")
            .then(({ DialogSkill }) => {
              if (dialog.stack.at(-1) !== marker) return
              dialog.replace(() => (
                <DialogSkill
                  onSelect={(skill) => {
                    input.setText(`/${skill} `)
                    setStore("prompt", {
                      input: `/${skill} `,
                      parts: [],
                    })
                    input.gotoBufferEnd()
                  }}
                />
              ))
            })
            .catch((error) => {
              log.warn("failed to load skill dialog", { error })
              toast.show({ message: "Failed to open skills", variant: "error" })
            })
        },
      },
    ]
  })

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

  command.register(() => [
    {
      title: "Stash prompt",
      value: "prompt.stash",
      category: "Prompt",
      enabled: !!store.prompt.input,
      onSelect: (dialog) => {
        if (!store.prompt.input) return
        stash.push({
          input: store.prompt.input,
          parts: store.prompt.parts,
        })
        input.extmarks.clear()
        input.clear()
        setStore("prompt", { input: "", parts: [] })
        setStore("extmarkToPartIndex", new Map())
        setExpandedPastes(new Set<number>())
        dialog.clear()
      },
    },
    {
      title: "Stash pop",
      value: "prompt.stash.pop",
      category: "Prompt",
      enabled: stash.list().length > 0,
      onSelect: (dialog) => {
        const entry = stash.pop()
        if (entry) {
          input.setText(entry.input)
          setStore("prompt", { input: entry.input, parts: entry.parts })
          restoreExtmarksFromParts(entry.parts)
          setExpandedPastes(new Set<number>())
          input.gotoBufferEnd()
        }
        dialog.clear()
      },
    },
    {
      title: "Stash list",
      value: "prompt.stash.list",
      category: "Prompt",
      enabled: stash.list().length > 0,
      onSelect: (dialog) => {
        const marker = dialog.stack.at(-1)
        import("../dialog-stash")
          .then(({ DialogStash }) => {
            if (dialog.stack.at(-1) !== marker) return
            dialog.replace(() => (
              <DialogStash
                onSelect={(entry) => {
                  input.setText(entry.input)
                  setStore("prompt", { input: entry.input, parts: entry.parts })
                  restoreExtmarksFromParts(entry.parts)
                  setExpandedPastes(new Set<number>())
                  input.gotoBufferEnd()
                }}
              />
            ))
          })
          .catch((error) => {
            log.warn("failed to load stash dialog", { error })
            toast.show({ message: "Failed to open stash", variant: "error" })
          })
      },
    },
  ])

  function requestHeaders() {
    return directoryRequestHeaders({
      directory: sdk.directory,
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
    const startedAt = performance.now()
    DiagnosticLog.recordProcess("tui.promptSubmitAcceptStarted", {
      sessionID: input.sessionID,
      path: input.path,
      action: input.action,
    })
    const response = await withTimeout(
      sdk.fetch(`${sdk.url}/session/${encodeURIComponent(input.sessionID)}/${input.path}`, {
        method: "POST",
        headers: requestHeaders(),
        body: JSON.stringify(input.body),
        signal: input.signal,
      }),
      SUBMIT_ACCEPT_TIMEOUT_MS,
      `${input.action} acceptance timed out after ${SUBMIT_ACCEPT_TIMEOUT_MS}ms`,
    ).catch((error) => {
      DiagnosticLog.recordProcess("tui.promptSubmitAcceptFailed", {
        sessionID: input.sessionID,
        path: input.path,
        action: input.action,
        elapsedMs: Math.round(performance.now() - startedAt),
        error,
      })
      throw error
    })

    if (response.status === 202 || response.ok) {
      DiagnosticLog.recordProcess("tui.promptSubmitAccepted", {
        sessionID: input.sessionID,
        path: input.path,
        action: input.action,
        status: response.status,
        elapsedMs: Math.round(performance.now() - startedAt),
      })
      return
    }
    const message = await responseErrorMessage(response)
    DiagnosticLog.recordProcess("tui.promptSubmitRejected", {
      sessionID: input.sessionID,
      path: input.path,
      action: input.action,
      status: response.status,
      elapsedMs: Math.round(performance.now() - startedAt),
      message,
    })
    throw new Error(message)
  }

  async function submit() {
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
    // Work mode (Agent | Council | Arena): remap free-text to slash command routes.
    const activeWorkMode = WorkMode.parse(kv.get("work_mode", WorkMode.DEFAULT))
    const workRouted = WorkMode.routeInput(activeWorkMode, inputText)
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
      workRouted.kind === "command" || (slashName != null && sync.data.command.some((x) => x.name === slashName))
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

        const res = await withTimeout(
          sdk.client.session.create(
            { id: sessionID, directory: props.workspaceID ?? sdk.baseDirectory },
            { signal: nextSubmitAbort.signal },
          ),
          SUBMIT_ACCEPT_TIMEOUT_MS,
          `Session creation timed out after ${SUBMIT_ACCEPT_TIMEOUT_MS}ms`,
        )
        if (res.error) throw new Error(errorMessage(res.error))
        if (!res.data?.id) throw new Error("Session creation returned no data")

        const createdSession = res.data as (typeof sync.data.session)[number]
        sessionID = res.data.id
        if (nextSubmitAbort.signal.aborted) return
        upsertSessionInStore(createdSession)
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
            return sync.data.command.some((x) => x.name === command)
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
              .filter((x) => x.type === "file")
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
  const exit = useExit()
  onCleanup(() => {
    cancelInterruptTimer?.()
    cancelRouteHandoff?.()
    submitAbort?.abort(createSubmitAbortError())
  })

  function pasteText(text: string, virtualText: string) {
    const currentOffset = input.visualCursor.offset
    const extmarkStart = currentOffset
    const extmarkEnd = extmarkStart + virtualText.length

    suppressAutocompleteForNextContentChange()
    input.insertText(virtualText + " ")

    const extmarkId = input.extmarks.create({
      start: extmarkStart,
      end: extmarkEnd,
      virtual: true,
      styleId: pasteStyleId,
      typeId: promptPartTypeId,
    })

    setStore(
      produce((draft) => {
        const partIndex = draft.prompt.parts.length
        draft.prompt.parts.push({
          type: "text" as const,
          text,
          source: {
            text: {
              start: extmarkStart,
              end: extmarkEnd,
              value: virtualText,
            },
          },
        })
        draft.extmarkToPartIndex.set(extmarkId, partIndex)
      }),
    )
    requestInputLayoutRefresh({ autocomplete: false })
  }

  async function pasteImage(file: { filename?: string; content: string; mime: string }) {
    const currentOffset = input.visualCursor.offset
    const extmarkStart = currentOffset
    const count = store.prompt.parts.filter((x) => x.type === "file" && x.mime.startsWith("image/")).length
    const virtualText = `[Image ${count + 1}]`
    const extmarkEnd = extmarkStart + virtualText.length
    const textToInsert = virtualText + " "

    suppressAutocompleteForNextContentChange()
    input.insertText(textToInsert)

    const extmarkId = input.extmarks.create({
      start: extmarkStart,
      end: extmarkEnd,
      virtual: true,
      styleId: pasteStyleId,
      typeId: promptPartTypeId,
    })

    const part: Omit<FilePart, "id" | "messageID" | "sessionID"> = {
      type: "file" as const,
      mime: file.mime,
      filename: file.filename,
      url: `data:${file.mime};base64,${file.content}`,
      source: {
        type: "file",
        path: file.filename ?? "",
        text: {
          start: extmarkStart,
          end: extmarkEnd,
          value: virtualText,
        },
      },
    }
    setStore(
      produce((draft) => {
        const partIndex = draft.prompt.parts.length
        draft.prompt.parts.push(part)
        draft.extmarkToPartIndex.set(extmarkId, partIndex)
      }),
    )
    requestInputLayoutRefresh({ autocomplete: false })
    return
  }

  async function pasteClipboardImage() {
    const content = await Clipboard.read()
    if (!content?.mime.startsWith("image/")) return false
    await pasteImage({
      filename: "clipboard",
      mime: content.mime,
      content: content.data,
    })
    return true
  }

  async function handleTerminalPaste(event: PasteEvent) {
    if (inputBlocked()) {
      event.preventDefault()
      return
    }

    let submitDeferred: boolean | undefined
    pasteSubmitGate.beginPasteHandling()
    try {
      // Normalize line endings at the boundary.
      // Windows ConPTY/Terminal often sends CR-only newlines in bracketed paste.
      const normalizedText = decodePasteBytes(event.bytes).replace(/\r\n/g, "\n").replace(/\r/g, "\n")
      const pastedContent = normalizedText.trim()
      if (!pastedContent) {
        event.preventDefault()
        submitDeferred = await pasteClipboardImage()
        return
      }

      // Drag/drop into terminal arrives as pasted text with shell-style
      // backslash escapes (spaces, iCloud's com\~apple\~CloudDocs,
      // parentheses, etc.). Decode those before filesystem access.
      const filepath = parsePastedFilePath(pastedContent)
      const isUrl = /^(https?):\/\//.test(filepath)
      if (!isUrl) {
        try {
          const mime = Filesystem.mimeType(filepath)
          const filename = path.basename(filepath)
          // Handle SVG as raw text content, not as base64 image.
          if (mime === "image/svg+xml") {
            event.preventDefault()
            const content = await Filesystem.readText(filepath).catch((error) => {
              log.warn("prompt svg paste read failed", { error, filepath })
              toast.show({
                message: error instanceof Error ? error.message : "Failed to read pasted SVG",
                variant: "error",
              })
              return undefined
            })
            if (content) {
              pasteText(content, `[SVG: ${filename ?? "image"}]`)
              return
            }
            // Fall through to plain-text paste if read failed.
          }
          if (mime.startsWith("image/")) {
            event.preventDefault()
            const content = await Filesystem.readArrayBuffer(filepath)
              .then((buffer) => Buffer.from(buffer).toString("base64"))
              .catch((error) => {
                log.warn("prompt image paste read failed", { error, filepath, mime })
                toast.show({
                  message: error instanceof Error ? error.message : "Failed to read pasted image",
                  variant: "error",
                })
                return undefined
              })
            if (content) {
              await pasteImage({
                filename,
                mime,
                content,
              })
              return
            }
            // Fall through to plain-text paste if read failed.
          }
        } catch {}
      }

      const lineCount = (pastedContent.match(/\n/g)?.length ?? 0) + 1
      if ((lineCount >= 3 || pastedContent.length > 150) && !sync.data.config.experimental?.disable_paste_summary) {
        event.preventDefault()
        suppressAutocompleteForNextContentChange()
        pasteText(pastedContent, `[Pasted ~${lineCount} lines]`)
        return
      }

      event.preventDefault()
      suppressAutocompleteForNextContentChange()
      input.insertText(normalizedText)
      requestInputLayoutRefresh({ autocomplete: false })
    } finally {
      pasteSubmitGate.finishPasteHandling({ submitDeferred })
    }
  }

  async function pasteWindowsClipboardText() {
    pasteSubmitGate.beginPasteHandling()
    let handledPaste = false
    try {
      const text = windowsClipboardTextPaste({
        content: await Clipboard.read(),
        platform: process.platform,
      })
      if (!text) return false

      input.insertText(text)
      requestInputLayoutRefresh({ autocomplete: false })
      handledPaste = true
      return true
    } finally {
      pasteSubmitGate.finishPasteHandling({ submitDeferred: handledPaste })
    }
  }

  const highlight = createMemo(() => {
    if (keybind.leader) return theme.border
    if (store.mode === "shell") return theme.primary
    return local.agent.color(local.agent.current().name)
  })

  const showVariant = createMemo(() => {
    const variants = local.model.variant.list()
    if (variants.length === 0) return false
    const current = local.model.variant.current()
    return !!current
  })

  const placeholderText = createMemo(() => {
    if (props.sessionID) return undefined
    if (store.mode === "shell") {
      const example = SHELL_PLACEHOLDERS[store.placeholder % SHELL_PLACEHOLDERS.length]
      return `Run a command... "${example}"`
    }
    if (!sync.data.provider_loaded || !local.model.ready) {
      return "Providers are loading... please wait"
    }
    if (!local.model.current()) {
      return sync.data.provider.length > 0 ? MSG_NO_MODEL : MSG_NO_PROVIDER
    }
    return `Ask anything... "${PLACEHOLDERS[store.placeholder % PLACEHOLDERS.length]}"`
  })

  const spinnerDef = createMemo(() => {
    const color = local.agent.color(local.agent.current().name)
    return {
      frames: createFrames({
        color,
        style: "blocks",
        inactiveFactor: 0.6,
        // enableFading: false,
        minAlpha: 0.3,
      }),
      color: createColors({
        color,
        style: "blocks",
        inactiveFactor: 0.6,
        // enableFading: false,
        minAlpha: 0.3,
      }),
    }
  })

  // Context-window usage for the footer gauge (ADR-031 R8). Anchored on
  // the most recent assistant message with usage data, against that
  // model's context limit.
  const contextGauge = createMemo(() => {
    if (!props.sessionID) return
    const msgs = sync.data.message[props.sessionID]
    if (!msgs) return
    const last = Usage.last(msgs) as any
    if (!last?.tokens) return
    const model = sync.data.provider.find((x: any) => x.id === last.providerID)?.models?.[last.modelID]
    return footerContextGauge({ totalTokens: Usage.total(last), contextLimit: model?.limit?.context })
  })

  const busyStatus = createMemo(() => {
    statusTick()
    const current = status()
    if (current.type !== "busy") return
    return footerSessionStatusView({
      status: current,
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
    return footerTokenChip({ tokens: last.tokens, startedAt: last.time.created, now })
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
                const suppressAutocomplete = suppressAutocompleteOnNextContentChange
                suppressAutocompleteOnNextContentChange = false
                syncPromptInputFromRenderable({ autocomplete: suppressAutocomplete ? false : undefined })
              }}
              keyBindings={textareaKeybindings()}
              onKeyDown={async (e: KeyEvent) => {
                const pendingIntent = pendingSubmitKeyIntent({
                  pending: submitPending() || submitInFlight,
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
                  void submit()
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
                    if (content?.mime.startsWith("image/")) {
                      e.preventDefault()
                      await pasteImage({
                        filename: "clipboard",
                        mime: content.mime,
                        content: content.data,
                      })
                      handledPaste = true
                      return
                    }
                    const text = windowsClipboardTextPaste({ content, platform: process.platform })
                    if (text) {
                      e.preventDefault()
                      suppressAutocompleteForNextContentChange()
                      input.insertText(text)
                      requestInputLayoutRefresh({ autocomplete: false })
                      handledPaste = true
                      return
                    }
                  } finally {
                    pasteSubmitGate.finishPasteHandling({ submitDeferred: handledPaste })
                  }
                  // If no supported clipboard fallback applies, let the default paste behavior continue.
                }
                if (keybind.match("input_clear", e) && store.prompt.input !== "") {
                  clearPromptDraft()
                  return
                }
                if (keybind.match("app_exit", e)) {
                  if (store.prompt.input === "") {
                    await exit()
                    // Don't preventDefault - let textarea potentially handle the event
                    e.preventDefault()
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
                  hasDraft: store.prompt.input !== "" || store.prompt.parts.length > 0,
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
              onPaste={handleTerminalPaste}
              ref={(r: TextareaRenderable) => {
                input = r
                if (promptPartTypeId === 0) {
                  promptPartTypeId = input.extmarks.registerType("prompt-part")
                }
                props.ref?.(ref)
                syncInputCursorColor()
              }}
              onMouseDown={(r: MouseEvent) => {
                focusRenderable(r.target, { name: "prompt-mouse-target-focus" })
                if (r.button !== MouseButton.RIGHT || process.platform !== "win32") return

                r.preventDefault()
                r.stopPropagation()
                void pasteWindowsClipboardText()
              }}
              focusedBackgroundColor={theme.backgroundElement}
              cursorColor={theme.text}
              syntaxStyle={syntax()}
            />
            <box flexDirection="row" flexShrink={0} paddingTop={1} gap={1}>
              <text fg={highlight()}>
                {store.mode === "shell"
                  ? "Shell"
                  : local.agent.icon(local.agent.current().name) +
                    " " +
                    (local.agent.current().displayName ?? Locale.titlecase(local.agent.current().name))}{" "}
              </text>
              <Show when={store.mode === "normal"}>
                <box flexDirection="row" gap={1}>
                  <text flexShrink={0} fg={keybind.leader ? theme.textMuted : theme.text}>
                    {local.model.parsed().model}
                  </text>
                  <text fg={theme.textMuted}>{local.model.parsed().provider}</text>
                  <Show when={showVariant()}>
                    <text fg={theme.textMuted}>·</text>
                    <text>
                      <span style={{ fg: theme.warning, bold: true }}>{local.model.variant.current()}</span>
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
                  <span style={{ fg: theme.warning, bold: true }}>Leader active</span>
                </text>
                <text fg={theme.textMuted}>press shortcut key or wait to cancel</text>
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
                        lines.push(`… ${view.hiddenLineCount} more line${view.hiddenLineCount === 1 ? "" : "s"}`)
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
                            <span style={{ fg: theme.warning }}>▣ </span>
                            {view.label}
                          </text>
                          <text fg={theme.textMuted}>{previewText()}</text>
                          <text fg={theme.textMuted}>{expanded() ? "Click to collapse" : "Click to expand"}</text>
                        </box>
                      </box>
                    )
                  }}
                </For>
              </box>
            </Show>
          </box>
        </Card>
        <box
          flexDirection={footerLayout().stacked ? "column" : "row"}
          justifyContent={footerLayout().stacked ? "flex-start" : "space-between"}
          gap={footerLayout().stacked ? 1 : 0}
        >
          <Show
            when={status().type !== "idle"}
            fallback={
              <Show
                when={submitPending()}
                fallback={
                  <Show when={finishedStatus()} fallback={<text />}>
                    <text fg={theme.success}>Finished</text>
                  </Show>
                }
              >
                <text fg={theme.warning}>
                  {pendingSubmitStatusText(submitStage())}
                  {pendingCancelHint() ? ` ${pendingCancelHint()} to cancel` : ""}
                </text>
              </Show>
            }
          >
            <box
              flexDirection="row"
              gap={1}
              flexGrow={1}
              justifyContent={status().type === "retry" ? "space-between" : "flex-start"}
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
                    <OpenTuiSpinner color={spinnerDef().color} frames={spinnerDef().frames} interval={40} />
                  </Show>
                  <Show when={status().type === "busy" && busyStatus()?.stale}>
                    <text fg={theme.warning}>!</text>
                  </Show>
                </box>
                <box flexDirection="row" gap={1} flexShrink={0}>
                  <Show when={busyStatus()?.label}>
                    <text fg={theme.warning}>{busyStatus()?.label}</text>
                  </Show>
                  <Show when={tokenChipView()} keyed>
                    {(chip) => (
                      <text fg={theme.textMuted}>
                        ↑{chip.input} ↓{chip.output}
                        <Show when={chip.rate}>
                          <span style={{ fg: theme.textMuted }}> · {chip.rate}</span>
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
                        return "gemini is way too hot right now"
                      if (r.message.length > 80) return r.message.slice(0, 80) + "..."
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
                      if (isTruncated()) {
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
                          <text fg={theme.error}>{retryText()}</text>
                        </box>
                      </Show>
                    )
                  })()}
                </box>
              </box>
              <KeyHint
                keys="esc"
                label={store.interrupt > 0 ? "again to interrupt" : "interrupt"}
                active={store.interrupt > 0}
              />
            </box>
          </Show>
          <Show when={status().type !== "retry"}>
            <box
              gap={footerLayout().stacked ? 0 : 1}
              flexDirection={footerLayout().stacked ? "column" : "row"}
              flexShrink={0}
            >
              <Show when={contextGauge()}>
                <box flexDirection="row" flexShrink={0} paddingRight={1}>
                  <Gauge view={contextGauge()} />
                </box>
              </Show>
              <box flexDirection="row" flexShrink={0}>
                {footerToggleChip({
                  // One mode at a time; click cycles. Fixed colors (not theme.primary —
                  // default theme primary is peach, which made Council look wrong).
                  label: footerWorkModeLabel(),
                  active: true,
                  activeFg: theme.text,
                  inactiveFg: theme.textMuted,
                  background: WORK_MODE_CHIP_BG[footerWorkMode()],
                  onMouseUp: () => command.trigger("app.cycle.work_mode"),
                })}
                {footerToggleChip({
                  label: runModeLabel(footerRunMode()),
                  active: footerRunMode() !== "none",
                  activeFg: theme.text,
                  inactiveFg: theme.textMuted,
                  background: footerRunMode() === "super-long" ? SUPER_LONG_PINK : theme.warning,
                  onMouseUp: () => command.trigger("app.cycle.run_mode"),
                })}
                {footerToggleChip({
                  label: "Sandbox",
                  active: sync.data.isolation.mode !== "full-access",
                  activeFg: theme.text,
                  inactiveFg: theme.error,
                  background: theme.success,
                  onMouseUp: () => command.trigger("app.toggle.sandbox"),
                })}
              </box>
              <Show when={footerLayout().showVariants || footerLayout().showShellHint}>
                <box gap={2} flexDirection="row" flexShrink={0}>
                  <Switch>
                    <Match when={store.mode === "normal"}>
                      <Show when={footerLayout().showVariants}>
                        <KeyHint keys={keybind.print("variant_cycle")} label="variants" />
                      </Show>
                    </Match>
                    <Match when={store.mode === "shell"}>
                      <Show when={footerLayout().showShellHint}>
                        <KeyHint keys="esc" label="exit shell mode" />
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
