import { LanguageProvider, useLanguage } from "./context/language"
import { DialogLanguage } from "./component/dialog-language"
import { DialogSetup, shouldOfferSetup } from "./component/dialog-setup"
import { useKeyboard, useRenderer, useTerminalDimensions } from "ax-tui/solid"
import { Clipboard } from "@tui/util/clipboard"
import { Selection } from "@tui/util/selection"
import { MouseButton, TextAttributes, type MouseEvent } from "ax-tui"
import { RouteProvider, useRoute } from "@tui/context/route"
import {
  type Component,
  Switch,
  Match,
  createEffect,
  createMemo,
  ErrorBoundary,
  createSignal,
  onMount,
  batch,
  Show,
  on,
  onCleanup,
  untrack,
} from "solid-js"
import { Dynamic } from "solid-js/web"
import { win32DisableProcessedInput, win32FlushInputBuffer, win32InstallCtrlCGuard } from "./win32"
import { Flag } from "@/flag/flag"
import { WorkMode } from "@/mode/work-mode"
import { providerModelKey } from "@/provider/model-key"

import { DialogProvider, useDialog } from "@tui/ui/dialog"
import { SDKProvider, useSDK } from "@tui/context/sdk"
import { SyncProvider, useSync } from "@tui/context/sync"
import { LocalProvider, useLocal } from "@tui/context/local"
import { useConnected } from "@tui/component/provider-state"
import { CommandProvider, useCommandDialog } from "@tui/component/dialog-command"
import { KeybindProvider } from "@tui/context/keybind"
import { ThemeProvider, useTheme } from "@tui/context/theme"
import { Home } from "@tui/routes/home"
import { PromptHistoryProvider } from "./component/prompt/history"
import { FrecencyProvider } from "./component/prompt/frecency"
import { PromptStashProvider } from "./component/prompt/stash"
import { DialogAlert } from "./ui/dialog-alert"
import { DialogConfirm } from "./ui/dialog-confirm"
import { ToastProvider, useToast } from "./ui/toast"
import { ExitProvider, useExit } from "./context/exit"
import { TUI_BACKEND_EXITED } from "./util/resilient-stream"
import { Session as SessionApi } from "@/session"
import { TuiEvent } from "./event"
import { NotificationEvent } from "@/notification/events"
import { KVProvider, useKV } from "./context/kv"
import { Provider } from "@/provider/provider"
import { ArgsProvider, useArgs, type Args } from "./context/args"
import { PromptRefProvider, usePromptRef } from "./context/prompt"
import { AxEngineDownloadsProvider } from "./context/ax-engine-downloads"
import { VisualCapabilityProvider } from "./ui/primitives/capability-context"
import { runMode, runModeFlags, runModeTransition, type RunMode } from "./component/prompt/run-mode-view-model"
import { TuiConfigProvider, useTuiConfig } from "./context/tui-config"
import { notifyTerminal } from "./util/terminal-notify"
import { notifyAudioEvent, type AudioNotifySettings } from "./util/audio-notify"
import { createTurnCompleteTracker } from "./util/turn-complete-tracker"
import { createPendingRequestTracker, familySessionIDs, outsideFamilyRequests } from "./util/pending-request-notices"
import { createSessionActivityIndex } from "./util/session-activity"
import { ContentDimensionsProvider } from "./context/content-dimensions"
import { navigationLayout } from "./navigation/navigation-layout"
import { SessionNavigation } from "./component/session-navigation"
import { NavigationBar } from "./component/navigation-bar"
import { sidebarRestoreVisible } from "./sidebar-restore-view-model"
import { mergeFollowUpSnapshot } from "./component/prompt/durable-follow-up"
import { DialogFollowUps } from "./component/dialog-follow-ups"
import { TuiConfig } from "@/config/tui"
import { DiagnosticLog } from "@/debug/diagnostic-log"
import { Log } from "@/util/log"
import { GITHUB_NEW_ISSUE_URL } from "@/constants/project"
import { AX_CODE_TERMINAL_TITLE } from "@/util/terminal-title"
import {
  clearTuiTerminalTitle,
  destroyTuiRenderer,
  getTuiRenderProfile,
  renderTui,
  setTuiTerminalProgress,
  setTuiTerminalTitle,
} from "./renderer"
import type { EventSource } from "./context/sdk"
import { Installation } from "@/installation"
import { installResizeInputGuard, useResizeInputRecovery } from "./input-mode"
import { formatTuiLogError } from "./util/log-error"
import { directoryRequestHeaders } from "@tui/util/request-headers"
import { scheduleDeferredStartupTask } from "@tui/util/startup-task"
import { scheduleTuiTimeout } from "@tui/util/timer"
import { beginTuiStartup, createTuiStartupSpan, recordTuiStartup, recordTuiStartupOnce } from "@tui/util/startup-trace"
import { responseErrorMessage, unknownErrorMessage } from "@tui/util/error-message"
import { registerTuiEventListener } from "@tui/util/lifecycle"
import { createTerminalSuspendController } from "@tui/util/terminal-suspend"
import { resolveSessionFirstRoute } from "./navigation/launch-policy"
import { formatTuiUpgradeCompleteMessage } from "./upgrade-check-view-model"
import { parseJsonPayload } from "@/util/json-value"
import { isRecord } from "@/util/record"
import { createTuiDialogLoaders } from "./tui-dialogs"
import { appCommands, type AppCommandSandbox } from "./app-commands"
import { DigitalCode, DigitalCodeCover, type DigitalCodeDoneReason } from "./component/digital-code"
import { StartupLogo } from "./component/startup-logo"
import {
  DIGITAL_CODE_ON_START_DEFAULT,
  DIGITAL_CODE_REVERSE_DURATION_MS,
  shouldAutoPlayDigitalCode,
  shouldPlayExitDigitalCode,
  initialStartupRainPhase,
  resolveStartupRainPhase,
  completeStartupRain,
  startupRainAfterPlayback,
  startupRainShowsLogo,
  startupRainCoversChrome,
  shouldStopDigitalCode,
} from "./component/digital-code-view-model"

const FALLBACK_COLOR_MODE = "dark" as const

export type TuiInput = {
  url: string
  args: Args
  config: TuiConfig.Info
  onSnapshot?: () => Promise<string[]>
  directory?: string
  fetch?: typeof fetch
  headers?: RequestInit["headers"]
  events?: EventSource
}

export function tui(input: TuiInput) {
  // promise to prevent immediate exit
  return new Promise<void>((resolve, reject) => {
    void (async () => {
      const unguard = win32InstallCtrlCGuard()
      const unresize = installResizeInputGuard()
      try {
        const renderProfile = getTuiRenderProfile()
        // Claim the terminal tab title before the renderer mounts (kimi-code
        // style: one fire-and-forget OSC 0 write at startup). Entry already
        // wrote this for the default TUI path; repeating it here covers attach
        // / late mount and keeps the tab at "AX-Code" if mount crashes.
        setTuiTerminalTitle(AX_CODE_TERMINAL_TITLE, renderProfile)
        beginTuiStartup({
          continue: !!input.args.continue,
          fork: !!input.args.fork,
          hasPrompt: !!input.args.prompt,
          hasSessionID: !!input.args.sessionID,
        })
        recordTuiStartupOnce("tui.startup.rendererProfile", renderProfile)
        win32DisableProcessedInput()

        const onExit = async () => {
          unresize()
          unguard?.()
          resolve()
        }

        renderTui(() => {
          return (
            <ErrorBoundary
              fallback={(error, reset) => (
                <ErrorComponent error={error} reset={reset} onExit={onExit} mode={FALLBACK_COLOR_MODE} />
              )}
            >
              <ArgsProvider {...input.args}>
                <ExitProvider onExit={onExit}>
                  <KVProvider>
                    <ToastProvider>
                      <RouteProvider>
                        <TuiConfigProvider config={input.config}>
                          <SDKProvider
                            url={input.url}
                            directory={input.directory}
                            fetch={input.fetch}
                            headers={input.headers}
                            events={input.events}
                          >
                            <LanguageProvider>
                              <SyncProvider>
                                <ThemeProvider mode={FALLBACK_COLOR_MODE}>
                                  <LocalProvider>
                                    <KeybindProvider>
                                      <PromptStashProvider>
                                        <AxEngineDownloadsProvider>
                                          <DialogProvider>
                                            <CommandProvider>
                                              <FrecencyProvider>
                                                <PromptHistoryProvider>
                                                  <PromptRefProvider>
                                                    <VisualCapabilityProvider>
                                                      <App onSnapshot={input.onSnapshot} />
                                                    </VisualCapabilityProvider>
                                                  </PromptRefProvider>
                                                </PromptHistoryProvider>
                                              </FrecencyProvider>
                                            </CommandProvider>
                                          </DialogProvider>
                                        </AxEngineDownloadsProvider>
                                      </PromptStashProvider>
                                    </KeybindProvider>
                                  </LocalProvider>
                                </ThemeProvider>
                              </SyncProvider>
                            </LanguageProvider>
                          </SDKProvider>
                        </TuiConfigProvider>
                      </RouteProvider>
                    </ToastProvider>
                  </KVProvider>
                </ExitProvider>
              </ArgsProvider>
            </ErrorBoundary>
          )
        })
        recordTuiStartup("tui.startup.renderDispatched")
      } catch (error) {
        unresize()
        unguard?.()
        reject(error)
      }
    })()
  })
}

// Fire-once key for session error notifications: the same session reporting
// the same error (name + bounded data payload) dedupes to a single terminal
// and audio notification, so consecutive identical errors cannot spam either
// channel.
function sessionErrorNotifyKey(props: { sessionID?: string; error?: unknown }): string {
  const error = isRecord(props.error) ? props.error : {}
  const name = typeof error.name === "string" ? error.name : "unknown"
  let data = ""
  try {
    data = JSON.stringify(error.data ?? {})
  } catch {
    data = ""
  }
  return `error:${props.sessionID ?? "global"}:${name}:${data.slice(0, 300)}`
}

function App(props: { onSnapshot?: () => Promise<string[]> }) {
  const uiText = useLanguage().t

  const { t } = useLanguage()
  const route = useRoute()
  const dimensions = useTerminalDimensions()
  const renderer = useRenderer()
  const renderProfile = getTuiRenderProfile()
  renderer.externalOutputMode = "passthrough"
  const dialog = useDialog()
  const local = useLocal()
  const kv = useKV()
  const command = useCommandDialog()
  const sdk = useSDK()
  const toast = useToast()
  const { theme, mode, setMode, locked, lock, unlock } = useTheme()
  const sync = useSync()
  const tuiConfig = useTuiConfig()
  const exit = useExit()
  const args = useArgs()
  const [queueRefresh, refreshQueue] = createSignal(0)
  for (const event of ["server.connected", "server.resync_required"] as const) {
    onCleanup(sdk.event.on(event, () => refreshQueue((value) => value + 1)))
  }
  command.register(() => [
    {
      title: t("language.title"),
      value: "language.settings",
      category: t("common.settings"),
      slash: { name: "language", aliases: ["lang"] },
      onSelect: () => dialog.replace(() => <DialogLanguage />),
    },
    {
      title: t("setup.title"),
      value: "setup.open",
      category: t("common.settings"),
      slash: { name: "setup" },
      onSelect: () => dialog.replace(() => <DialogSetup />),
    },
    {
      title: uiText("ui.manageSavedFollowUps"),
      value: "session.followups",
      category: uiText("common.session"),
      slash: { name: "queue" },
      enabled: route.data.type === "session",
      onSelect: () => {
        if (route.data.type !== "session") return
        const sessionID = route.data.sessionID
        dialog.replace(() => (
          <DialogFollowUps sessionID={sessionID} onAttention={() => command.trigger("session.attention")} />
        ))
      },
    },
  ])
  createEffect(() => {
    queueRefresh()
    const sessionID = route.data.type === "session" ? route.data.sessionID : undefined
    const directory = sdk.directory
    if (!sessionID || !sdk.sseConnected || sync.data.status === "loading") return
    const abort = new AbortController()
    const deleted = new Set<string>()
    const unsubscribe = sdk.event.on("task.queue.deleted", (event) => deleted.add(event.properties.id))
    onCleanup(unsubscribe)
    onCleanup(() => abort.abort())
    untrack(() => {
      const before = new Map(sync.data.task_queue.map((item) => [item.id, JSON.stringify(item)]))
      void sdk
        .fetch(`${sdk.url.replace(/\/$/, "")}/task-queue?sessionID=${encodeURIComponent(sessionID)}`, {
          headers: directoryRequestHeaders({ directory }),
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10_000)]),
        })
        .then(async (response) => {
          if (!response.ok) throw new Error("Unable to refresh saved follow-ups")
          const rows: unknown = await response.json()
          if (!Array.isArray(rows)) throw new Error("Invalid saved follow-up response")
          if (abort.signal.aborted || sdk.directory !== directory) return
          sync.set("task_queue", (current) => mergeFollowUpSnapshot(current, rows, sessionID, before, deleted))
        })
        .catch((error) => {
          if (abort.signal.aborted) return
          Log.Default.warn("follow-up refresh failed", { error })
          toast.show({ message: uiText("ui.savedFollowUpsCouldNotBeRefreshedReconnectToRetry"), variant: "warning" })
        })
        .finally(unsubscribe)
    })
  })
  const promptRef = usePromptRef()
  const [sessionRoute, setSessionRoute] = createSignal<Component | undefined>()
  // Short-lived ASCII Digital Code overlay. Manual preview is always
  // available; startup playback is on by default (`digital_code_on_start`
  // opts out) and task-completion playback is opt-in
  // (`digital_code_on_task_complete`).
  const [digitalCodePlaying, setDigitalCodePlaying] = createSignal(false)
  const [startupRainPhase, setStartupRainPhase] = createSignal(initialStartupRainPhase())
  let exiting = false
  const playDigitalCode = () => {
    if (!exiting) setDigitalCodePlaying(true)
  }
  const endDigitalCode = (reason: DigitalCodeDoneReason = "timeout") => {
    batch(() => {
      setDigitalCodePlaying(false)
      if (startupRainPhase() !== "rain") return
      // Startup rain hands off to the brand logo; an explicit skip goes
      // straight to the working screen. Completion plays are already in "app".
      setStartupRainPhase(reason === "skip" ? completeStartupRain() : startupRainAfterPlayback())
    })
  }
  const endStartupLogo = () => {
    if (startupRainShowsLogo(startupRainPhase())) setStartupRainPhase(completeStartupRain())
  }
  // Reverse (bottom-to-top) rain. An explicit quit plays it before the
  // renderer tears down; the palette's "Play Ending Video" entry previews the
  // same overlay. The preview is always allowed — it is a deliberate request —
  // while the exit flourish honors the shared animation policy so quitting
  // stays immediate when animations are off.
  const [reverseRainPlaying, setReverseRainPlaying] = createSignal(false)
  let reverseRainDone: Promise<void> | undefined
  let settleReverseRain: (() => void) | undefined
  const playReverseDigitalCode = (): Promise<void> => {
    const existing = reverseRainDone
    // A caller that arrives mid-run — quitting during the palette preview —
    // waits for the run already on screen instead of cutting it off.
    if (existing) return existing
    const created = new Promise<void>((resolve) => {
      settleReverseRain = resolve
    })
    reverseRainDone = created
    setReverseRainPlaying(true)
    return created
  }
  const endReverseDigitalCode = () => {
    batch(() => {
      setReverseRainPlaying(false)
      const settle = settleReverseRain
      settleReverseRain = undefined
      reverseRainDone = undefined
      settle?.()
    })
  }
  const playExitDigitalCode = () => {
    exiting = true
    // Cancel every startup phase before KV readiness or a playback callback
    // can start another overlay above the ending video.
    batch(() => {
      setStartupRainPhase(completeStartupRain())
      setDigitalCodePlaying(false)
    })
    if (!shouldPlayExitDigitalCode({ animationsEnabled: kv.get("animations_enabled", true) })) return Promise.resolve()
    return playReverseDigitalCode()
  }
  exit.onFlourish(playExitDigitalCode)
  onCleanup(() => {
    exit.onFlourish(undefined)
    settleReverseRain?.()
    settleReverseRain = undefined
    reverseRainDone = undefined
  })
  createEffect(() => {
    // Selection is not checked here on purpose: a selection can only appear
    // under the overlays through the keys they pass through, and the overlays
    // yield on their own the moment `renderer.hasSelection` becomes true. This
    // stop path therefore only has to guard dialogs.
    if (!shouldStopDigitalCode({ dialogOpen: dialog.stack.length > 0, hasSelection: false })) return
    batch(() => {
      if (digitalCodePlaying()) setDigitalCodePlaying(false)
      if (startupRainPhase() !== "app") setStartupRainPhase("app")
    })
  })
  let sessionRoutePromise: Promise<Component> | undefined
  let sessionRouteLoadFailed = false

  onMount(() => {
    recordTuiStartupOnce("tui.startup.appMounted", { route: route.data.type })
  })

  // Startup flourish: cover the main chrome from the first paint, then play
  // rain once kv.json has loaded. Reading before kv.ready would ignore a
  // persisted opt-out (the default is true). A dialog or selection drops the
  // cover so it never hides an interactive surface.
  createEffect(
    on(
      () => kv.ready,
      (ready) => {
        if (startupRainPhase() !== "hold") return
        const next = resolveStartupRainPhase({
          phase: "hold",
          ready,
          enabled: kv.get("digital_code_on_start", DIGITAL_CODE_ON_START_DEFAULT),
          animationsEnabled: kv.get("animations_enabled", true),
          dialogOpen: dialog.stack.length > 0,
        })
        if (next === "hold") return
        batch(() => {
          setStartupRainPhase(next)
          if (next === "rain") playDigitalCode()
        })
      },
    ),
  )

  // Fatal backend exit (internal transport): the wire-death sentinel is
  // emitted by createEventSource in thread.ts when the backend process dies.
  // Everything downstream (RPC, streaming) is dead at that point, so surface
  // a blocking dialog once instead of letting the UI look alive-but-frozen.
  let backendDeathDialogShown = false
  createEffect(() => {
    if (backendDeathDialogShown) return
    if (sdk.connectionStatus?.error !== TUI_BACKEND_EXITED) return
    backendDeathDialogShown = true
    void DialogAlert.show(
      dialog,
      "Backend process exited",
      "The ax-code backend process stopped unexpectedly. Sessions are saved on disk — restart ax-code to continue.",
    ).then(() => exit())
  })

  useResizeInputRecovery(dimensions)

  function ensureSessionRouteLoaded(source: "route" | "startup-preload" = "route") {
    const loaded = sessionRoute()
    if (loaded) return Promise.resolve(loaded)
    if (sessionRoutePromise) return sessionRoutePromise

    const finishSessionRouteImport = createTuiStartupSpan("tui.startup.sessionRouteImport", { source })
    sessionRoutePromise = import("@tui/routes/session")
      .then(({ Session }) => {
        sessionRouteLoadFailed = false
        setSessionRoute(() => Session)
        recordTuiStartupOnce("tui.startup.sessionRouteReady", { source })
        return Session
      })
      .catch((error) => {
        finishSessionRouteImport({ ok: false, error: formatTuiLogError(error) })
        throw error
      })
      .finally(() => {
        finishSessionRouteImport()
        sessionRoutePromise = undefined
      })

    return sessionRoutePromise
  }

  function handleSessionRouteLoadFailure(
    error: unknown,
    input: {
      source: "route" | "startup-preload"
      navigateHome?: boolean
    },
  ) {
    Log.Default.warn("failed to load session route", {
      source: input.source,
      error,
    })
    if (!sessionRouteLoadFailed) {
      sessionRouteLoadFailed = true
      toast.show({ message: uiText("ui.failedToLoadSessionView"), variant: "error" })
    }
    if (input.navigateHome) route.navigate({ type: "home" })
  }

  const dialogs = createTuiDialogLoaders({
    dialog,
    toast,
    variantCount: () => local.model.variant.list().length,
    currentModelName: () => local.model.parsed().model,
  })

  useKeyboard((evt) => {
    if (!Flag.AX_CODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT) return
    if (!renderer.getSelection()) return

    // Windows Terminal-like behavior:
    // - Ctrl+C copies and dismisses selection
    // - Esc dismisses selection
    // - Most other key input dismisses selection and is passed through
    if (evt.ctrl && evt.name === "c") {
      if (!Selection.copy(renderer, toast)) {
        renderer.clearSelection()
        return
      }

      evt.preventDefault()
      evt.stopPropagation()
      return
    }

    if (evt.name === "escape") {
      renderer.clearSelection()
      evt.preventDefault()
      evt.stopPropagation()
      return
    }

    renderer.clearSelection()
  })

  // Wire up console copy-to-clipboard via AX Code TUI's onCopySelection callback
  renderer.console.onCopySelection = async (text: string) => {
    if (!text || text.length === 0) return

    await Clipboard.copy(text)
      .then(() => {
        toast.show({ message: uiText("ui.copiedToClipboard"), variant: "info", duration: 1500 })
        renderer.clearSelection()
      })
      .catch(toast.error)
  }
  const [terminalTitleEnabled, setTerminalTitleEnabled] = createSignal(kv.get("terminal_title_enabled", true))
  const [navigationExpanded, setNavigationExpanded] = createSignal<ReadonlySet<string>>(new Set())
  createEffect(
    on(
      () => sdk.directory ?? sync.data.path.directory,
      () => setNavigationExpanded(new Set<string>()),
    ),
  )
  createEffect(
    on(
      () =>
        [
          route.data.type === "session" ? route.data.sessionID : undefined,
          sdk.directory ?? sync.data.path.directory,
          sync.data.session_loaded,
        ] as const,
      ([current, directory]) => {
        const byID = new Map(
          sync.data.session
            .filter((session) => session.directory === directory)
            .map((session) => [session.id, session]),
        )
        const ancestors = new Set<string>()
        let id = current
        while (id && !ancestors.has(id)) {
          ancestors.add(id)
          id = byID.get(id)?.parentID
        }
        setNavigationExpanded((previous) => new Set([...previous, ...ancestors]))
      },
    ),
  )
  const navigation = createMemo(() =>
    navigationLayout(dimensions().width, kv.get("navigation_visible", true), kv.get("navigation_width")),
  )
  const showSidebarRestore = createMemo(() => {
    if (route.data.type !== "session") return false
    return sidebarRestoreVisible({
      sessionRoute: true,
      childSession: Boolean(sync.session.get(route.data.sessionID)?.parentID),
      sidebar: kv.get("sidebar", "auto") === "hide" ? "hide" : "auto",
      terminalWidth: dimensions().width,
    })
  })
  const contentDimensions = createMemo(() => ({
    width: navigation().contentWidth,
    height: Math.max(0, dimensions().height - (navigation().railWidth ? 0 : 1) - (args.persistentRuntime ? 1 : 0)),
  }))

  const sessionWorking = () => {
    if (route.data.type !== "session") return false
    const status = sync.data.session_status?.[route.data.sessionID]
    return status?.type === "busy" || status?.type === "retry"
  }

  // While a session is working, show a busy indicator in the terminal tab
  // via OSC 9;4 (Windows Terminal / ConEmu / Ghostty / WezTerm). The tab text
  // stays a static "AX-Code": the animated A/X brand pulse lives in the footer
  // busy indicator (component/footer-animation), not in the tab title.
  createEffect(() => {
    setTuiTerminalProgress(terminalTitleEnabled() && sessionWorking(), renderProfile)
  })
  // The progress keepalive interval is module state in renderer.ts, outside
  // Solid's cleanup tracking. If this component is torn down while a session
  // is still working (the error boundary replaces the app with the fatal-error
  // screen), nothing else stops it — the indicator would keep re-arming every
  // second on a crashed session until the user force-exits.
  onCleanup(() => setTuiTerminalProgress(false, renderProfile))

  createEffect(() => {
    if (!terminalTitleEnabled()) {
      clearTuiTerminalTitle(renderProfile)
      return
    }
    setTuiTerminalTitle(AX_CODE_TERMINAL_TITLE, renderProfile)
  })

  // Terminal-native notifications (OSC 9 / BEL fallback, ported from
  // kimi-code). Fire-once keys live in util/terminal-notify.ts, so reactive
  // re-runs of these effects never re-notify for the same event.
  const notificationsEnabled = () => tuiConfig.notifications?.enabled ?? true

  // Audio notifications ride the same triggers as the terminal notifier.
  // Sound requires notifications.enabled and defaults to off, so a stock
  // config adds zero behavior here.
  const audioNotifySettings = (): AudioNotifySettings => ({
    enabled: notificationsEnabled(),
    sound: tuiConfig.notifications?.sound,
    voice: tuiConfig.notifications?.voice,
    rate: tuiConfig.notifications?.rate,
    events: tuiConfig.notifications?.events,
  })

  // Observe the viewed subtree, not task success or only the parent status.
  const turnComplete = createTurnCompleteTracker()
  createEffect(() => {
    const sessionID = route.data.type === "session" ? route.data.sessionID : undefined
    const status = sessionID === undefined ? undefined : sync.data.session_status?.[sessionID]?.type
    const activity =
      sessionID === undefined
        ? undefined
        : createSessionActivityIndex({
            sessions: sync.data.session,
            statuses: sync.data.session_status,
            permissions: sync.data.permission,
            questions: sync.data.question,
          }).get(sessionID)
    const failedMembers = activity?.members
      .filter(({ id }) => {
        const last = sync.data.message[id]?.findLast((message) => message.role === "assistant")
        return last?.role === "assistant" && !!last.error
      })
      .map(({ id }) => id)
    const key = turnComplete.update(sessionID, status, {
      members: activity?.members,
      pending: activity?.attention,
      ready: sdk.sseConnected && sync.data.status === "complete" && sync.data.session_loaded,
      failedMembers,
    })
    if (!key || sessionID === undefined) return
    if (!notificationsEnabled()) return
    const session = sync.session.get(sessionID)
    const sessionTitle = session && !SessionApi.isDefaultTitle(session.title) ? session.title : undefined
    notifyTerminal({
      title: "ax-code",
      body: sessionTitle ? `Session idle: ${sessionTitle}` : "Session idle",
      key,
    })
    notifyAudioEvent({ kind: "complete", source: sessionTitle, settings: audioNotifySettings(), key })
  })

  // Notify when a permission approval or question is pending. The request's
  // own id is the fire-once key, so a request notifies exactly once.
  createEffect(() => {
    if (!notificationsEnabled()) return
    for (const requests of Object.values(sync.data.permission)) {
      for (const request of requests) {
        const key = `permission:${request.id}`
        notifyTerminal({ title: "ax-code", body: "Permission requested", key })
        notifyAudioEvent({ kind: "permission", source: request.permission, settings: audioNotifySettings(), key })
      }
    }
    for (const requests of Object.values(sync.data.question)) {
      for (const request of requests) {
        const key = `question:${request.id}`
        notifyTerminal({ title: "ax-code", body: "Question from agent", key })
        const first = request.questions[0]
        notifyAudioEvent({
          kind: "question",
          source: first?.header || first?.question,
          settings: audioNotifySettings(),
          key,
        })
      }
    }
  })

  // In-TUI notice for requests the current route cannot answer: the session
  // route renders permission/question prompts only for the open session's
  // family, so a request from a top-level automation session (scheduled task,
  // detached queue work) would otherwise park invisibly until the run times
  // out (PRD-2026-09-12). Fire-once per request; opening the named session
  // renders the pending prompt there.
  const pendingRequests = createPendingRequestTracker()
  createEffect(() => {
    const sessionID = route.data.type === "session" ? route.data.sessionID : undefined
    const family = familySessionIDs(sync.data.session, sessionID)
    const outside = [
      ...outsideFamilyRequests(sync.data.permission, family).map((request) => ({
        ...request,
        kind: "approval" as const,
      })),
      ...outsideFamilyRequests(sync.data.question, family).map((request) => ({
        ...request,
        kind: "question" as const,
      })),
    ]
    for (const request of pendingRequests.update(outside)) {
      const session = sync.session.get(request.sessionID)
      const title = session && !SessionApi.isDefaultTitle(session.title) ? session.title : "another session"
      toast.show({
        message:
          request.kind === "approval"
            ? `Approval needed in "${title}" — use /attention to open it`
            : `Question from the agent in "${title}" — use /attention to open it`,
        variant: "warning",
        duration: 8_000,
      })
    }
  })

  createEffect(() => {
    if (!sync.data.provider_loaded) return
    const model = local.model.current()
    if (!model) return
    void sync.runtime
      .syncSuperLong({ model: providerModelKey(model) })
      .catch((error) => Log.Default.warn("failed to sync super-long for active model", { error }))
  })

  createEffect(() => {
    if (route.data.type !== "session") return
    void ensureSessionRouteLoaded("route").catch((error) => {
      handleSessionRouteLoadFailure(error, { source: "route", navigateHome: true })
    })
  })

  onMount(() => {
    const cancel = scheduleDeferredStartupTask(
      () =>
        ensureSessionRouteLoaded("startup-preload")
          .then(() => undefined)
          .catch((error) => {
            handleSessionRouteLoadFailure(error, { source: "startup-preload" })
          }),
      {
        name: "session-route-startup-preload",
      },
    )
    onCleanup(cancel)
  })

  async function putJsonWithTimeout(
    path: string,
    body: unknown,
    headers?: Record<string, string>,
    options?: { signal?: AbortSignal },
  ) {
    const ctrl = new AbortController()
    const onAbort = () => ctrl.abort()
    let removeAbortListener: (() => void) | undefined
    if (options?.signal?.aborted) {
      onAbort()
    } else if (options?.signal) {
      removeAbortListener = registerTuiEventListener(options.signal, "abort", onAbort, {
        name: "app-put-json-timeout-abort-forward",
        options: { once: true },
      })
    }
    const cancelTimer = scheduleTuiTimeout(() => ctrl.abort(), {
      name: "app-put-json-timeout",
      delayMs: 10_000,
      unref: true,
    })
    try {
      const response = await sdk.fetch(`${sdk.url}${path}`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          ...headers,
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      })
      if (!response.ok) {
        throw new Error(await responseErrorMessage(response))
      }
      return parseJsonPayload(await response.text())
    } finally {
      cancelTimer()
      removeAbortListener?.()
    }
  }

  const RETRY_DELAY_MS = 250
  const MAX_SESSION_FORK_ATTEMPTS = 3
  const retryTimers = new Set<() => void>()
  let forkRetryDisposed = false
  const sandbox: AppCommandSandbox = {
    lastRestricted: undefined,
    controller: undefined,
  }

  function createBooleanRuntimeToggle(input: {
    endpoint: "/smart-llm" | "/autonomous" | "/super-long"
    label: {
      warn: string
      message: string
    }
    getCurrent: () => boolean
    setCurrent: (value: boolean) => void
  }) {
    let putController: AbortController | undefined

    const toggle = () => {
      const previous = input.getCurrent()
      const next = !previous
      putController?.abort()
      const controller = new AbortController()
      putController = controller
      input.setCurrent(next)
      // Scope the write to the active directory (worktree/workspace aware);
      // without the header the server persists to its own cwd's ax-code.json.
      const headers = directoryRequestHeaders({ directory: sdk.directory })
      void putJsonWithTimeout(input.endpoint, { enabled: next }, headers, { signal: controller.signal }).catch(
        (error) => {
          if (controller.signal.aborted || putController !== controller) return
          Log.Default.warn(input.label.warn, { error, enabled: next })
          if (input.getCurrent() === next) input.setCurrent(previous)
          toast.show({
            message: error instanceof Error ? error.message : input.label.message,
            variant: "error",
          })
        },
      )
    }

    const dispose = () => {
      putController?.abort()
    }

    return { toggle, dispose }
  }

  const smartLlmToggle = createBooleanRuntimeToggle({
    endpoint: "/smart-llm",
    getCurrent: () => sync.data.smartLlm,
    setCurrent: (value) => sync.set("smartLlm", value),
    label: {
      warn: "failed to update smart llm setting",
      message: uiText("ui.failedToSaveFastModelRoutingSetting"),
    },
  })
  // Autonomous and Super-Long are a dependent pair (Super-Long requires
  // autonomous; disabling autonomous clears Super-Long server-side), so
  // they change together through ordered run-mode transitions instead of
  // two independent boolean toggles. See run-mode-view-model.ts.
  let runModeController: AbortController | undefined
  const currentRunMode = () => runMode({ autonomous: sync.data.autonomous, superLong: sync.data.superLong })
  function setRunMode(mode: RunMode) {
    const previous = { autonomous: sync.data.autonomous, superLong: sync.data.superLong }
    const steps = runModeTransition(previous, mode)
    if (steps.length === 0) return
    runModeController?.abort()
    const controller = new AbortController()
    runModeController = controller
    const desired = runModeFlags(mode)
    sync.set("autonomous", desired.autonomous)
    sync.set("superLong", desired.superLong)
    // Track which steps actually landed so a mid-sequence failure rolls
    // the client back to what the server really holds, not to `previous`.
    const applied = { ...previous }
    // Scope the writes to the active directory (worktree/workspace aware);
    // without the header the server persists to its own cwd's ax-code.json.
    const headers = directoryRequestHeaders({ directory: sdk.directory })
    void (async () => {
      for (const step of steps) {
        await putJsonWithTimeout(step.endpoint, { enabled: step.enabled }, headers, { signal: controller.signal })
        applied[step.key] = step.enabled
      }
    })().catch((error) => {
      if (controller.signal.aborted || runModeController !== controller) return
      Log.Default.warn("failed to update run mode", { error, mode })
      sync.set("autonomous", applied.autonomous)
      sync.set("superLong", applied.superLong)
      toast.show({
        message: error instanceof Error ? error.message : "Failed to save run mode",
        variant: "error",
      })
    })
  }

  const terminalSuspend = createTerminalSuspendController()

  onCleanup(() => {
    forkRetryDisposed = true
    for (const cancel of retryTimers) cancel()
    retryTimers.clear()
    smartLlmToggle.dispose()
    runModeController?.abort()
    sandbox.controller?.abort()
    terminalSuspend.dispose()
  })

  function scheduleRetry(fn: () => void, delay = RETRY_DELAY_MS) {
    const cancel = scheduleTuiTimeout(
      () => {
        retryTimers.delete(cancel)
        fn()
      },
      {
        name: "app-session-fork-retry",
        delayMs: delay,
        unref: true,
      },
    )
    retryTimers.add(cancel)
  }

  function forkSessionWithRetries(input: { sessionID: string; source: "continue" | "startup" }) {
    const attemptFork = (attempt: number) => {
      sdk.client.session
        .fork({ sessionID: input.sessionID })
        .then((result) => {
          if (forkRetryDisposed) return
          if (result.data?.id) {
            route.navigate({ type: "session", sessionID: result.data.id })
            return
          }
          if (attempt < MAX_SESSION_FORK_ATTEMPTS) {
            scheduleRetry(() => attemptFork(attempt + 1))
            return
          }
          toast.show({ message: uiText("ui.failedToForkSession"), variant: "error" })
        })
        .catch((error) => {
          if (forkRetryDisposed) return
          Log.Default.warn("failed to fork session", {
            source: input.source,
            sessionID: input.sessionID,
            attempt,
            error,
          })
          if (attempt < MAX_SESSION_FORK_ATTEMPTS) {
            scheduleRetry(() => attemptFork(attempt + 1))
            return
          }
          toast.show({ message: uiText("ui.failedToForkSession"), variant: "error" })
        })
    }

    attemptFork(1)
  }

  onMount(() => {
    batch(() => {
      if (args.agent) local.agent.set(args.agent)
      if (args.model) {
        let parsed: ReturnType<typeof Provider.parseModel> | undefined
        try {
          parsed = Provider.parseModel(args.model)
        } catch {
          toast.show({ variant: "warning", message: `Invalid model format: ${args.model}`, duration: 3000 })
        }
        if (parsed !== undefined) local.model.set(parsed, { recent: true })
      }
      // Handle --session without --fork immediately (fork is handled in createEffect below)
      if (args.sessionID && !args.fork) {
        route.navigate({
          type: "session",
          sessionID: args.sessionID,
        })
      }
    })
  })

  let continued = false
  const continueWithSession = (sessionID: string) => {
    continued = true
    if (args.fork) {
      forkSessionWithRetries({ sessionID, source: "continue" })
    } else {
      route.navigate({ type: "session", sessionID })
    }
  }
  let continueFallbackStarted = false
  createEffect(() => {
    if (continued || !sync.data.session_loaded || !args.continue) return
    const match = sync.data.session
      .toSorted((a, b) => b.time.updated - a.time.updated)
      .find((x) => x.parentID === undefined)?.id
    if (match) {
      continueWithSession(match)
      return
    }
    // The bootstrap session list is bounded by a ~30-day window
    // (sync-bootstrap-request.ts passes `start`), so a last session older than
    // that leaves `sync.data.session` empty here and --continue silently
    // no-ops. Fall back to a one-shot UNBOUNDED session.list before giving up;
    // toast if there is genuinely nothing to continue. Runs at most once.
    if (continueFallbackStarted) return
    continueFallbackStarted = true
    const notify = () => toast.show({ message: uiText("ui.noPreviousSessionToContinue"), variant: "info" })
    sdk.client.session
      .list({})
      .then((result) => {
        if (continued) return
        if (result.error) {
          Log.Default.warn("failed to list sessions for --continue", { error: result.error })
          notify()
          return
        }
        const fallback = (result.data ?? [])
          .filter((x) => x.parentID === undefined)
          .toSorted((a, b) => b.time.updated - a.time.updated)[0]?.id
        if (fallback) {
          continueWithSession(fallback)
          return
        }
        notify()
      })
      .catch((error) => {
        if (continued) return
        Log.Default.warn("failed to list sessions for --continue", { error })
        notify()
      })
  })

  // Session-first launch (ADR-035): when no explicit --session/--continue/--prompt
  // is given and AX_CODE_TUI_SESSION_FIRST is enabled, auto-resume the most recent
  // session instead of landing on the home/new-session screen.
  let sessionFirstApplied = false
  createEffect(() => {
    if (sessionFirstApplied || !sync.data.session_loaded) return
    if (!Flag.AX_CODE_TUI_SESSION_FIRST) return
    if (args.sessionID || args.continue || args.prompt) return
    if (route.data.type !== "home") return
    const recentSessionIDs = sync.data.session
      .filter((x) => x.parentID === undefined)
      .toSorted((a, b) => b.time.updated - a.time.updated)
      .map((x) => x.id)
    const decision = resolveSessionFirstRoute({
      recentSessionIDs,
      hasProjectContext: true,
    })
    if (decision.type === "session") {
      sessionFirstApplied = true
      recordTuiStartupOnce("tui.startup.sessionFirst", { sessionID: decision.sessionID })
      route.navigate({ type: "session", sessionID: decision.sessionID })
    }
  })

  // Handle --session with --fork: wait for the session list to settle before forking
  // (session list loads in non-blocking phase for --session, so we must wait for it
  // to avoid a race where reconcile overwrites the newly forked session)
  let startupForkStarted = false
  createEffect(() => {
    if (startupForkStarted || !sync.data.session_loaded || !args.sessionID || !args.fork) return
    startupForkStarted = true
    forkSessionWithRetries({ sessionID: args.sessionID, source: "startup" })
  })

  // Offer setup once on a fresh interactive install, after bootstrap. Never
  // replace an active dialog or interrupt a restored session or --prompt.
  let setupOffered = false
  createEffect(() => {
    if (
      setupOffered ||
      !shouldOfferSetup({
        kvReady: kv.ready,
        seen: kv.get("setup_seen_v1", false),
        providerLoaded: sync.data.provider_loaded,
        providerFailed: sync.data.provider_failed,
        modelReady: local.model.ready,
        sessionLoaded: sync.data.session_loaded,
        sessionCount: sync.data.session.length,
        providerCount: sync.data.provider.length,
        explicitLaunch: !!(args.prompt || args.sessionID || args.continue || args.fork),
        atHome: route.data.type === "home",
        dialogOpen: dialog.stack.length > 0,
      })
    )
      return
    setupOffered = true
    dialog.replace(() => <DialogSetup />)
  })

  createEffect(() => {
    if (!kv.ready || !kv.get("setup_resume_v1", false) || dialog.stack.length > 0) return
    kv.set("setup_resume_v1", false)
    if (args.prompt || args.sessionID || args.continue || args.fork) return
    dialog.replace(() => <DialogSetup />)
  })

  const connected = useConnected()
  command.register(() =>
    appCommands({
      t,
      dialogs,
      sync,
      kv,
      route,
      promptRef,
      dialog,
      local,
      connected,
      setMode,
      mode,
      locked,
      lock,
      unlock,
      terminalTitleEnabled,
      setTerminalTitleEnabled,
      renderProfile,
      smartLlmToggle,
      currentRunMode,
      setRunMode,
      toast,
      sdk,
      putJsonWithTimeout,
      sandbox,
      exit,
      persistentRuntime: !!args.persistentRuntime,
      renderer,
      onSnapshot: props.onSnapshot,
      terminalSuspend,
      playDigitalCode,
      playReverseDigitalCode,
      terminalWidth: () => dimensions().width,
    }),
  )

  let updateHandlerDisposed = false
  let interactiveUpgradeVersion: string | undefined
  const eventUnsubs = [
    sdk.event.on("server.resync_required", () => turnComplete.reset()),
    sdk.event.on("server.serialization_error", () => turnComplete.reset()),
    sdk.event.on("server.instance.disposed", () => turnComplete.reset()),
    sdk.event.on("server.connected", () => turnComplete.reset()),
    sdk.event.on(TuiEvent.CommandExecute.type, (evt) => {
      command.trigger(evt.properties.command)
    }),

    sdk.event.on(TuiEvent.ToastShow.type, (evt) => {
      toast.show({
        title: evt.properties.title,
        message: evt.properties.message,
        variant: evt.properties.variant,
        duration: evt.properties.duration,
      })
    }),

    sdk.event.on(NotificationEvent.ToastShow.type, (evt) => {
      toast.show({
        title: evt.properties.title,
        message: evt.properties.message,
        variant: evt.properties.variant,
        duration: evt.properties.duration,
      })
    }),

    sdk.event.on(TuiEvent.SessionSelect.type, (evt) => {
      route.navigate({
        type: "session",
        sessionID: evt.properties.sessionID,
      })
    }),

    sdk.event.on(SessionApi.Event.Deleted.type, (evt) => {
      if (route.data.type === "session" && route.data.sessionID === evt.properties.info.id) {
        // Returning to the new-chat surface: default work mode to Agent.
        kv.set("work_mode", WorkMode.DEFAULT)
        local.agent.resetToDefault()
        route.navigate({ type: "home" })
        toast.show({
          variant: "info",
          message: uiText("ui.theCurrentSessionWasDeleted"),
        })
      }
    }),

    sdk.event.on(SessionApi.Event.Error.type, (evt) => {
      turnComplete.suppress(evt.properties.sessionID)
      const error = evt.properties.error
      if (error && typeof error === "object" && error.name === "MessageAbortedError") return

      toast.show({
        variant: "error",
        message: unknownErrorMessage(error),
        duration: 5000,
      })

      // Session errors also notify through the terminal (OSC 9 / BEL) and
      // audio channels, fire-once per session + error identity.
      const key = sessionErrorNotifyKey(evt.properties)
      if (notificationsEnabled()) notifyTerminal({ title: "ax-code", body: "Session error", key })
      notifyAudioEvent({ kind: "error", settings: audioNotifySettings(), key })
    }),

    sdk.event.on("installation.update-available", async (evt) => {
      if (updateHandlerDisposed) return
      const version = evt.properties.version

      const skipped = kv.get("skipped_version")
      if (skipped) {
        const { gt } = await import("semver")
        if (!gt(version, skipped)) return
      }

      const choice = await DialogConfirm.show(
        dialog,
        `Update Available`,
        `A new release v${version} is available. Would you like to update now?`,
        "skip",
      )
      if (updateHandlerDisposed) return

      if (choice === false) {
        kv.set("skipped_version", version)
        return
      }

      if (choice !== true) return

      toast.show({
        variant: "info",
        message: `Updating to v${version}...`,
        duration: 30000,
      })

      // The upgrade route emits installation.updated before returning. Mark
      // this version as interactive so its event is not also rendered as a
      // silent-background-update toast (SSE delivery may trail the response).
      interactiveUpgradeVersion = version
      const result = await sdk.client.global.upgrade({ target: version })
      if (updateHandlerDisposed) return

      if (result.error || !result.data?.success) {
        interactiveUpgradeVersion = undefined
        const reason =
          (result.data as { success: false; error: string } | undefined)?.error ||
          unknownErrorMessage(result.error) ||
          "Update failed"
        toast.show({
          variant: "error",
          title: uiText("ui.updateFailed"),
          message: reason,
          duration: 10000,
        })
        return
      }

      await DialogAlert.show(
        dialog,
        "Update Complete",
        formatTuiUpgradeCompleteMessage(result.data.version, result.data.warnings),
      )
      if (updateHandlerDisposed) return

      exit()
    }),

    sdk.event.on("installation.updated", (evt) => {
      if (interactiveUpgradeVersion === evt.properties.version) return
      // Silent background patch upgrade finished — the running process still
      // holds the old binary, so the new version only takes effect on restart.
      const warnings = evt.properties.warnings ?? []
      toast.show({
        variant: warnings.length ? "warning" : "info",
        title: warnings.length ? "Updated with warning" : "Updated",
        message: [
          `ax-code was updated to v${evt.properties.version} in the background. Restart to use the new version.`,
          ...warnings,
        ].join("\n"),
        duration: warnings.length ? 15000 : 10000,
      })
    }),

    // Opt-in flourish for durable automation finishing. Guarded so it never
    // covers a dialog, a selection, or a run already on screen; the completion
    // toast remains the primary signal.
    sdk.event.on("scheduled.task.succeeded", () => {
      if (
        !shouldAutoPlayDigitalCode({
          enabled: kv.get("digital_code_on_task_complete", false),
          animationsEnabled: kv.get("animations_enabled", true),
          alreadyPlaying: digitalCodePlaying(),
          dialogOpen: dialog.stack.length > 0,
          hasSelection: Boolean(renderer.getSelection()?.getSelectedText()),
        })
      ) {
        return
      }
      playDigitalCode()
    }),
  ]
  onCleanup(() => {
    updateHandlerDisposed = true
    for (const unsub of eventUnsubs) unsub()
  })

  return (
    <box
      width={dimensions().width}
      height={dimensions().height}
      backgroundColor={theme.background}
      onMouseDown={(evt: MouseEvent) => {
        if (!Flag.AX_CODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT) return
        if (evt.button !== MouseButton.RIGHT) return

        if (!Selection.copy(renderer, toast)) return
        evt.preventDefault()
        evt.stopPropagation()
      }}
      onMouseUp={Flag.AX_CODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT ? undefined : () => Selection.copy(renderer, toast)}
    >
      <Show when={args.persistentRuntime}>
        {(runtime) => (
          <box
            height={1}
            flexShrink={0}
            flexDirection="row"
            justifyContent="space-between"
            backgroundColor={theme.backgroundPanel}
          >
            <text fg={theme.textMuted}>
              {dimensions().width >= 65 ? `Persistent on ${runtime().host.slice(0, 30)} · ` : "Persistent · "}
              {sdk.sseConnected ? "connected" : "disconnected"}
            </text>
            <box onMouseUp={() => void exit()}>
              <text fg={theme.accent}>{t("common.disconnect")}</text>
            </box>
          </box>
        )}
      </Show>
      <Show when={navigation().railWidth === 0}>
        <NavigationBar width={dimensions().width} showSidebarRestore={showSidebarRestore()} />
      </Show>
      <box flexDirection="row" width="100%" height={contentDimensions().height}>
        <Show when={navigation().railWidth > 0}>
          <SessionNavigation
            width={navigation().railWidth}
            expanded={navigationExpanded()}
            setExpanded={setNavigationExpanded}
          />
        </Show>
        <box width={navigation().contentWidth} height="100%" flexShrink={0}>
          <ContentDimensionsProvider value={contentDimensions}>
            <Switch>
              <Match when={route.data.type === "home"}>
                <Home />
              </Match>
              <Match when={route.data.type === "session"}>
                <Show
                  when={sessionRoute()}
                  fallback={
                    <box paddingLeft={2} paddingRight={2} paddingTop={1}>
                      <text fg={theme.textMuted}>{t("common.loading")}</text>
                    </box>
                  }
                >
                  {(SessionRoute) => <Dynamic component={SessionRoute()} />}
                </Show>
              </Match>
            </Switch>
          </ContentDimensionsProvider>
        </box>
      </box>
      <Show when={startupRainCoversChrome(startupRainPhase())}>
        <DigitalCodeCover />
      </Show>
      <Show when={digitalCodePlaying()}>
        <DigitalCode onDone={endDigitalCode} />
      </Show>
      <Show when={reverseRainPlaying()}>
        <DigitalCode
          direction="up"
          durationMs={DIGITAL_CODE_REVERSE_DURATION_MS}
          captureInput
          onDone={endReverseDigitalCode}
        />
      </Show>
      <Show when={startupRainShowsLogo(startupRainPhase())}>
        <StartupLogo onDone={endStartupLogo} />
      </Show>
    </box>
  )
}

function ErrorComponent(props: {
  error: Error
  reset: () => void
  onExit: () => Promise<void>
  mode?: "dark" | "light"
}) {
  const uiText = useLanguage().t

  const term = useTerminalDimensions()
  const renderer = useRenderer()

  createEffect(() => {
    DiagnosticLog.recordProcess("tui.errorBoundary", { error: props.error })
  })

  const handleExit = async () => {
    await destroyTuiRenderer(renderer)
    win32FlushInputBuffer()
    await props.onExit()
  }

  useKeyboard((evt) => {
    if (evt.ctrl && evt.name === "c") {
      handleExit()
    }
  })
  const [copied, setCopied] = createSignal(false)
  const [copyError, setCopyError] = createSignal<string | undefined>()

  const issueURL = new URL(`${GITHUB_NEW_ISSUE_URL}?template=bug-report.yml`)

  // Choose safe fallback colors per mode since theme context may not be available
  const isLight = props.mode === "light"
  const colors = {
    bg: isLight ? "#ffffff" : "#0a0a0a",
    text: isLight ? "#1a1a1a" : "#eeeeee",
    muted: isLight ? "#8a8a8a" : "#808080",
    primary: isLight ? "#3b7dd8" : "#fab283",
  }

  if (props.error.message) {
    issueURL.searchParams.set("title", `ax-code-tui: fatal: ${props.error.message}`)
  }

  if (props.error.stack) {
    const maxStackLength = Math.max(0, 6000 - issueURL.toString().length)
    const stack = props.error.stack.substring(0, maxStackLength)
    const truncated = stack.length < props.error.stack.length
    issueURL.searchParams.set("description", "```\n" + stack + (truncated ? "...\n```" : "\n```"))
  }

  issueURL.searchParams.set("ax-code-version", Installation.VERSION)

  const copyIssueURL = () => {
    void Clipboard.copy(issueURL.toString())
      .then(() => {
        setCopied(true)
        setCopyError(undefined)
      })
      .catch((error) => {
        setCopied(false)
        setCopyError(error instanceof Error ? error.message : "Failed to copy issue URL")
      })
  }

  return (
    <box flexDirection="column" gap={1} backgroundColor={colors.bg}>
      <box flexDirection="row" gap={1} alignItems="center">
        <text attributes={TextAttributes.BOLD} fg={colors.text}>
          {uiText("ui.pleaseReportAnIssue")}
        </text>
        <box onMouseUp={copyIssueURL} backgroundColor={colors.primary} padding={1}>
          <text attributes={TextAttributes.BOLD} fg={colors.bg}>
            {uiText("ui.copyIssueUrlExceptionInfoPreFilled")}
          </text>
        </box>
        {copied() && <text fg={colors.muted}>{uiText("ui.successfullyCopied")}</text>}
        {copyError() && <text fg={colors.muted}>{copyError()}</text>}
      </box>
      <box flexDirection="row" gap={2} alignItems="center">
        <text fg={colors.text}>{uiText("ui.aFatalErrorOccurred")}</text>
        <box onMouseUp={props.reset} backgroundColor={colors.primary} padding={1}>
          <text fg={colors.bg}>{uiText("ui.resetTui")}</text>
        </box>
        <box onMouseUp={handleExit} backgroundColor={colors.primary} padding={1}>
          <text fg={colors.bg}>{uiText("ui.exit2")}</text>
        </box>
      </box>
      <scrollbox height={Math.floor(term().height * 0.7)}>
        <text fg={colors.muted}>{props.error.stack}</text>
      </scrollbox>
      <text fg={colors.text}>{props.error.message}</text>
    </box>
  )
}
