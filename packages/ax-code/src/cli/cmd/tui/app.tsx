import { useKeyboard, useRenderer, useTerminalDimensions } from "@ax-code/opentui-solid"
import { Clipboard } from "@tui/util/clipboard"
import { Selection } from "@tui/util/selection"
import { MouseButton, TextAttributes, type MouseEvent } from "@ax-code/opentui-core"
import { RouteProvider, useRoute } from "@tui/context/route"
import {
  type Component,
  Switch,
  Match,
  createEffect,
  ErrorBoundary,
  createSignal,
  onMount,
  batch,
  Show,
  on,
  onCleanup,
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
import { Session as SessionApi } from "@/session"
import { TuiEvent } from "./event"
import { NotificationEvent } from "@/notification/events"
import { KVProvider, useKV } from "./context/kv"
import { Provider } from "@/provider/provider"
import { ArgsProvider, useArgs, type Args } from "./context/args"
import { PromptRefProvider, usePromptRef } from "./context/prompt"
import { VisualCapabilityProvider } from "./ui/primitives/capability-context"
import {
  runMode,
  nextRunMode,
  runModeFlags,
  runModeLabel,
  runModeTransition,
  type RunMode,
} from "./component/prompt/run-mode-view-model"
import { TuiConfigProvider } from "./context/tui-config"
import { TuiConfig } from "@/config/tui"
import { DiagnosticLog } from "@/debug/diagnostic-log"
import { Log } from "@/util/log"
import { GITHUB_REPO_URL, GITHUB_NEW_ISSUE_URL } from "@/constants/project"
import {
  clearTuiTerminalTitle,
  destroyTuiRenderer,
  getTuiRenderProfile,
  renderTui,
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
import { resolveDesktopHandoff } from "./navigation/desktop-handoff"
import { launchWebUi } from "@/desktop/webui"

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
                            <SyncProvider>
                              <ThemeProvider mode={FALLBACK_COLOR_MODE}>
                                <LocalProvider>
                                  <KeybindProvider>
                                    <PromptStashProvider>
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
                                    </PromptStashProvider>
                                  </KeybindProvider>
                                </LocalProvider>
                              </ThemeProvider>
                            </SyncProvider>
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

function App(props: { onSnapshot?: () => Promise<string[]> }) {
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
  const exit = useExit()
  const promptRef = usePromptRef()
  const [sessionRoute, setSessionRoute] = createSignal<Component | undefined>()
  let sessionRoutePromise: Promise<Component> | undefined
  let sessionRouteLoadFailed = false

  onMount(() => {
    recordTuiStartupOnce("tui.startup.appMounted", { route: route.data.type })
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
      toast.show({ message: "Failed to load session view", variant: "error" })
    }
    if (input.navigateHome) route.navigate({ type: "home" })
  }

  async function showProviderDialog() {
    const marker = dialog.stack.at(-1)
    try {
      const { DialogProvider: ProviderDialog } = await import("@tui/component/dialog-provider")
      if (dialog.stack.at(-1) !== marker) return
      dialog.replace(() => <ProviderDialog />)
    } catch (error) {
      Log.Default.warn("failed to load provider dialog", { error })
      toast.show({ message: "Failed to open provider dialog", variant: "error" })
    }
  }

  async function showModelDialog() {
    const marker = dialog.stack.at(-1)
    try {
      const { DialogModel: ModelDialog } = await import("@tui/component/dialog-model")
      if (dialog.stack.at(-1) !== marker) return
      dialog.replace(() => <ModelDialog />)
    } catch (error) {
      Log.Default.warn("failed to load model dialog", { error })
      toast.show({ message: "Failed to open model dialog", variant: "error" })
    }
  }

  async function showSessionListDialog() {
    const marker = dialog.stack.at(-1)
    try {
      const { DialogSessionList } = await import("@tui/component/dialog-session-list")
      if (dialog.stack.at(-1) !== marker) return
      dialog.replace(() => <DialogSessionList />)
    } catch (error) {
      Log.Default.warn("failed to load session list dialog", { error })
      toast.show({ message: "Failed to open session list", variant: "error" })
    }
  }

  async function showWorkspaceListDialog() {
    const marker = dialog.stack.at(-1)
    try {
      const { DialogWorkspaceList } = await import("@tui/component/dialog-workspace-list")
      if (dialog.stack.at(-1) !== marker) return
      dialog.replace(() => <DialogWorkspaceList />)
    } catch (error) {
      Log.Default.warn("failed to load workspace list dialog", { error })
      toast.show({ message: "Failed to open workspace list", variant: "error" })
    }
  }

  async function showAgentDialog() {
    const marker = dialog.stack.at(-1)
    try {
      const { DialogAgent } = await import("@tui/component/dialog-agent")
      if (dialog.stack.at(-1) !== marker) return
      dialog.replace(() => <DialogAgent />)
    } catch (error) {
      Log.Default.warn("failed to load agent dialog", { error })
      toast.show({ message: "Failed to open agent list", variant: "error" })
    }
  }

  async function showMcpDialog() {
    const marker = dialog.stack.at(-1)
    try {
      const { DialogMcp } = await import("@tui/component/dialog-mcp")
      if (dialog.stack.at(-1) !== marker) return
      dialog.replace(() => <DialogMcp />)
    } catch (error) {
      Log.Default.warn("failed to load mcp dialog", { error })
      toast.show({ message: "Failed to open MCP list", variant: "error" })
    }
  }

  async function showStatusDialog() {
    const marker = dialog.stack.at(-1)
    try {
      const { DialogStatus } = await import("@tui/component/dialog-status")
      if (dialog.stack.at(-1) !== marker) return
      dialog.replace(() => <DialogStatus />)
    } catch (error) {
      Log.Default.warn("failed to load status dialog", { error })
      toast.show({ message: "Failed to open status", variant: "error" })
    }
  }

  async function showThemeListDialog() {
    const marker = dialog.stack.at(-1)
    try {
      const { DialogThemeList } = await import("@tui/component/dialog-theme-list")
      if (dialog.stack.at(-1) !== marker) return
      dialog.replace(() => <DialogThemeList />)
    } catch (error) {
      Log.Default.warn("failed to load theme dialog", { error })
      toast.show({ message: "Failed to open themes", variant: "error" })
    }
  }

  async function showHelpDialog() {
    const marker = dialog.stack.at(-1)
    try {
      const { DialogHelp } = await import("./ui/dialog-help")
      if (dialog.stack.at(-1) !== marker) return
      dialog.replace(() => <DialogHelp />)
    } catch (error) {
      Log.Default.warn("failed to load help dialog", { error })
      toast.show({ message: "Failed to open help", variant: "error" })
    }
  }

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

  // Wire up console copy-to-clipboard via opentui's onCopySelection callback
  renderer.console.onCopySelection = async (text: string) => {
    if (!text || text.length === 0) return

    await Clipboard.copy(text)
      .then(() => {
        toast.show({ message: "Copied to clipboard", variant: "info", duration: 1500 })
        renderer.clearSelection()
      })
      .catch(toast.error)
  }
  const [terminalTitleEnabled, setTerminalTitleEnabled] = createSignal(kv.get("terminal_title_enabled", true))

  // Update terminal window title based on current route and session
  createEffect(() => {
    if (!terminalTitleEnabled()) {
      clearTuiTerminalTitle(renderer, renderProfile)
      return
    }
    if (!renderProfile.allowTerminalTitle) return

    if (route.data.type === "home") {
      setTuiTerminalTitle(renderer, "ax-code", renderProfile)
      return
    }

    if (route.data.type === "session") {
      const session = sync.session.get(route.data.sessionID)
      if (!session || SessionApi.isDefaultTitle(session.title)) {
        setTuiTerminalTitle(renderer, "ax-code", renderProfile)
        return
      }

      // Truncate title to 40 chars max
      const title = session.title.length > 40 ? session.title.slice(0, 37) + "..." : session.title
      setTuiTerminalTitle(renderer, `ax-code | ${title}`, renderProfile)
    }
  })

  const args = useArgs()

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
    } finally {
      cancelTimer()
      removeAbortListener?.()
    }
  }

  const RETRY_DELAY_MS = 250
  const MAX_SESSION_FORK_ATTEMPTS = 3
  const retryTimers = new Set<() => void>()
  let forkRetryDisposed = false
  let sandboxPutController: AbortController | undefined
  // Remember the restricted mode we toggled away from so turning the sandbox
  // back on restores a configured "read-only" instead of silently upgrading
  // it to "workspace-write".
  let lastRestrictedIsolationMode: "read-only" | "workspace-write" | undefined

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
      message: "Failed to save fast-model routing setting",
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
    sandboxPutController?.abort()
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
          toast.show({ message: "Failed to fork session", variant: "error" })
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
          toast.show({ message: "Failed to fork session", variant: "error" })
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
    const notify = () => toast.show({ message: "No previous session to continue", variant: "info" })
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

  createEffect(
    on(
      () => sync.data.provider_loaded && !sync.data.provider_failed && sync.data.provider.length === 0,
      (isEmpty, wasEmpty) => {
        // only trigger when we transition into an empty-provider state
        if (!isEmpty || wasEmpty) return
        void showProviderDialog()
      },
    ),
  )

  const connected = useConnected()
  command.register(() => [
    {
      title: "Switch session",
      value: "session.list",
      keybind: "session_list",
      category: "Session",
      suggested: sync.data.session.length > 0,
      slash: {
        name: "sessions",
        aliases: ["resume", "continue"],
      },
      onSelect: () => {
        void showSessionListDialog()
      },
    },
    ...(Flag.AX_CODE_EXPERIMENTAL_WORKSPACES
      ? [
          {
            title: "Manage workspaces",
            value: "workspace.list",
            category: "Workspace",
            suggested: true,
            onSelect: () => {
              void showWorkspaceListDialog()
            },
          },
        ]
      : []),
    {
      title: "New session",
      suggested: route.data.type === "session",
      value: "session.new",
      keybind: "session_new",
      category: "Session",
      slash: {
        name: "new",
        aliases: ["clear"],
      },
      onSelect: () => {
        // New chat always starts in Agent work mode (not sticky council/arena).
        kv.set("work_mode", WorkMode.DEFAULT)
        const current = promptRef.current
        // Don't require focus - if there's any text, preserve it
        const currentPrompt = current?.current?.input ? current.current : undefined
        const workspaceID =
          route.data.type === "session" ? sync.session.get(route.data.sessionID)?.directory : undefined
        route.navigate({
          type: "home",
          initialPrompt: currentPrompt,
          workspaceID,
        })
        dialog.clear()
      },
    },
    ...(
      [
        { keybind: "session_quick_switch_1", slot: 1 },
        { keybind: "session_quick_switch_2", slot: 2 },
        { keybind: "session_quick_switch_3", slot: 3 },
        { keybind: "session_quick_switch_4", slot: 4 },
        { keybind: "session_quick_switch_5", slot: 5 },
        { keybind: "session_quick_switch_6", slot: 6 },
        { keybind: "session_quick_switch_7", slot: 7 },
        { keybind: "session_quick_switch_8", slot: 8 },
        { keybind: "session_quick_switch_9", slot: 9 },
      ] as const
    ).map(({ keybind: kb, slot }) => ({
      title: `Switch to pinned session ${slot}`,
      value: `session.quick_switch.${slot}`,
      keybind: kb,
      category: "Session",
      onSelect: () => {
        local.session.quickSwitch(slot)
        dialog.clear()
      },
    })),
    {
      title: "Switch model",
      value: "model.list",
      keybind: "model_list",
      suggested: true,
      category: "Agent",
      slash: {
        name: "model",
        aliases: ["models"],
      },
      onSelect: () => {
        void showModelDialog()
      },
    },
    {
      title: "Model cycle",
      value: "model.cycle_recent",
      keybind: "model_cycle_recent",
      category: "Agent",
      hidden: true,
      onSelect: () => {
        local.model.cycle(1)
      },
    },
    {
      title: "Model cycle reverse",
      value: "model.cycle_recent_reverse",
      keybind: "model_cycle_recent_reverse",
      category: "Agent",
      hidden: true,
      onSelect: () => {
        local.model.cycle(-1)
      },
    },
    {
      title: "Favorite cycle",
      value: "model.cycle_favorite",
      keybind: "model_cycle_favorite",
      category: "Agent",
      hidden: true,
      onSelect: () => {
        local.model.cycleFavorite(1)
      },
    },
    {
      title: "Favorite cycle reverse",
      value: "model.cycle_favorite_reverse",
      keybind: "model_cycle_favorite_reverse",
      category: "Agent",
      hidden: true,
      onSelect: () => {
        local.model.cycleFavorite(-1)
      },
    },
    {
      title: "Switch agent",
      value: "agent.list",
      keybind: "agent_list",
      category: "Agent",
      slash: {
        name: "agent",
        aliases: ["agents"],
      },
      onSelect: () => {
        void showAgentDialog()
      },
    },
    {
      title: "Toggle MCPs",
      value: "mcp.list",
      category: "Agent",
      onSelect: () => {
        void showMcpDialog()
      },
    },
    {
      title: "Agent cycle",
      value: "agent.cycle",
      keybind: "agent_cycle",
      category: "Agent",
      hidden: true,
      onSelect: () => {
        local.agent.move(1)
      },
    },
    {
      title: "Variant cycle",
      value: "variant.cycle",
      keybind: "variant_cycle",
      category: "Agent",
      hidden: true,
      onSelect: () => {
        local.model.variant.cycle()
      },
    },
    {
      title: "Agent cycle reverse",
      value: "agent.cycle.reverse",
      keybind: "agent_cycle_reverse",
      category: "Agent",
      hidden: true,
      onSelect: () => {
        local.agent.move(-1)
      },
    },
    {
      title: "Connect provider",
      value: "provider.connect",
      suggested: !connected(),
      slash: {
        name: "connect",
      },
      onSelect: () => {
        void showProviderDialog()
      },
      category: "Provider",
    },
    {
      title: "View status",
      keybind: "status_view",
      value: "ax-code.status",
      onSelect: () => {
        void showStatusDialog()
      },
      category: "System",
    },
    {
      title: "Switch theme",
      value: "theme.switch",
      keybind: "theme_list",
      slash: {
        name: "theme",
        aliases: ["themes"],
      },
      onSelect: () => {
        void showThemeListDialog()
      },
      category: "System",
    },
    {
      title: "Toggle Theme Mode",
      value: "theme.switch_mode",
      onSelect: (dialog) => {
        setMode(mode() === "dark" ? "light" : "dark")
        dialog.clear()
      },
      category: "System",
    },
    {
      title: locked() ? "Unlock Theme Mode" : "Lock Theme Mode",
      value: "theme.mode.lock",
      onSelect: (dialog) => {
        if (locked()) unlock()
        else lock()
        dialog.clear()
      },
      category: "System",
    },
    {
      title: "Help",
      value: "help.show",
      slash: {
        name: "help",
      },
      onSelect: () => {
        void showHelpDialog()
      },
      category: "System",
    },
    {
      title: "Open docs",
      value: "docs.open",
      onSelect: () => {
        void import("open")
          .then(({ default: open }) => open(GITHUB_REPO_URL))
          .catch((error) => {
            Log.Default.warn("failed to open docs", { error })
            toast.show({
              message: error instanceof Error ? error.message : "Failed to open docs",
              variant: "error",
            })
          })
        dialog.clear()
      },
      category: "System",
    },
    {
      title: "Open Web UI",
      value: "webui.open",
      slash: {
        name: "webui",
      },
      description: "Start or open the AX Code browser UI",
      category: "System",
      onSelect: (dialog) => {
        dialog.clear()
        void launchWebUi({ openBrowser: true })
          .then((result) => {
            DiagnosticLog.recordProcess("webui.handoff", { started: result.started, port: result.port })
            toast.show({
              message: result.message,
              variant: "success",
              duration: 5000,
            })
          })
          .catch((error) => {
            Log.Default.warn("failed to open web ui", { error })
            toast.show({
              message: error instanceof Error ? error.message : "Failed to open AX Code Web UI",
              variant: "error",
              duration: 7000,
            })
          })
      },
    },
    {
      title: "Open Desktop",
      value: "desktop.handoff",
      slash: {
        name: "desktop",
      },
      description: "Get guidance for AX Code Desktop dashboards and workflow supervision",
      category: "System",
      onSelect: (dialog) => {
        const result = resolveDesktopHandoff({
          platform: process.platform,
          desktopUrl: undefined,
        })
        DiagnosticLog.recordProcess("desktop.dashboard.handoff", { result: result.type })
        toast.show({
          message: result.message,
          variant: "info",
          duration: 5000,
        })
        dialog.clear()
      },
    },
    {
      title: "Exit the app",
      value: "app.exit",
      slash: {
        name: "exit",
        aliases: ["quit", "q"],
      },
      onSelect: () => exit(),
      category: "System",
    },
    {
      title: "Toggle debug panel",
      category: "System",
      value: "app.debug",
      onSelect: (dialog) => {
        renderer.toggleDebugOverlay()
        dialog.clear()
      },
    },
    {
      title: "Toggle console",
      category: "System",
      value: "app.console",
      onSelect: (dialog) => {
        renderer.console.toggle()
        dialog.clear()
      },
    },
    {
      title: "Write heap snapshot",
      category: "System",
      value: "app.heap_snapshot",
      onSelect: async (dialog) => {
        // Defense in depth: a failed snapshot must never float an unhandled
        // rejection (the global handler exits the TUI); toast instead.
        try {
          const files = await props.onSnapshot?.()
          toast.show({
            variant: "info",
            message: `Heap snapshot written to ${files?.join(", ")}`,
            duration: 5000,
          })
        } catch (error) {
          toast.show({
            variant: "error",
            message: error instanceof Error ? error.message : "Failed to write heap snapshot",
            duration: 5000,
          })
        }
        dialog.clear()
      },
    },
    {
      title: "Suspend terminal",
      value: "terminal.suspend",
      keybind: "terminal_suspend",
      category: "System",
      hidden: true,
      onSelect: () => {
        // Lifecycle-managed SIGCONT (ADR-047 D2). Disposed on App cleanup and
        // replaced if suspend is invoked again before resume.
        terminalSuspend.suspend({
          suspend: () => renderer.suspend(),
          resume: () => renderer.resume(),
        })
      },
    },
    {
      title: terminalTitleEnabled() ? "Disable terminal title" : "Enable terminal title",
      value: "terminal.title.toggle",
      keybind: "terminal_title_toggle",
      category: "System",
      onSelect: (dialog) => {
        setTerminalTitleEnabled((prev) => {
          const next = !prev
          kv.set("terminal_title_enabled", next)
          if (!next) clearTuiTerminalTitle(renderer, renderProfile)
          return next
        })
        dialog.clear()
      },
    },
    {
      title: kv.get("animations_enabled", true) ? "Disable animations" : "Enable animations",
      value: "app.toggle.animations",
      category: "System",
      onSelect: (dialog) => {
        kv.set("animations_enabled", !kv.get("animations_enabled", true))
        dialog.clear()
      },
    },
    {
      title: kv.get("nerd_font_enabled", false) ? "Disable Nerd Font glyphs" : "Enable Nerd Font glyphs",
      description: "Recommended terminal font: Cascadia Code Nerd Font",
      value: "app.toggle.nerd_font",
      category: "System",
      onSelect: (dialog) => {
        kv.set("nerd_font_enabled", !kv.get("nerd_font_enabled", false))
        dialog.clear()
      },
    },
    {
      title: kv.get("diff_wrap_mode", "word") === "word" ? "Disable diff wrapping" : "Enable diff wrapping",
      value: "app.toggle.diffwrap",
      category: "System",
      onSelect: (dialog) => {
        const current = kv.get("diff_wrap_mode", "word")
        kv.set("diff_wrap_mode", current === "word" ? "none" : "word")
        dialog.clear()
      },
    },
    {
      title: sync.data.smartLlm ? "Turn fast-model routing off" : "Turn fast-model routing on",
      value: "app.toggle.smart_llm",
      category: "System",
      onSelect: (dialog) => {
        smartLlmToggle.toggle()
        dialog.clear()
      },
    },
    {
      title: `Cycle run mode (current: ${runModeLabel(currentRunMode())})`,
      value: "app.cycle.run_mode",
      category: "System",
      onSelect: (dialog) => {
        setRunMode(nextRunMode(currentRunMode()))
        dialog.clear()
      },
    },
    {
      title: `Cycle work mode (current: ${WorkMode.label(WorkMode.parse(kv.get("work_mode", WorkMode.DEFAULT)))})`,
      value: "app.cycle.work_mode",
      category: "Agent",
      slash: {
        name: "work-mode",
        aliases: ["workmode"],
      },
      onSelect: (dialog) => {
        const current = WorkMode.parse(kv.get("work_mode", WorkMode.DEFAULT))
        const next = WorkMode.cycle(current)
        kv.set("work_mode", next)
        toast.show({
          message: `Work mode: ${WorkMode.label(next)}`,
          variant: "info",
          duration: 2500,
        })
        dialog.clear()
      },
    },
    {
      title: sync.data.autonomous ? "Turn autonomous off" : "Turn autonomous on",
      value: "app.toggle.autonomous",
      category: "System",
      onSelect: (dialog) => {
        setRunMode(currentRunMode() === "none" ? "auto" : "none")
        dialog.clear()
      },
    },
    {
      title: currentRunMode() === "super-long" ? "Turn Super-Long off" : "Turn Super-Long on (implies autonomous)",
      value: "app.toggle.super_long",
      category: "System",
      onSelect: (dialog) => {
        setRunMode(currentRunMode() === "super-long" ? "auto" : "super-long")
        dialog.clear()
      },
    },
    {
      title: sync.data.isolation.mode === "full-access" ? "Turn sandbox on" : "Turn sandbox off",
      value: "app.toggle.sandbox",
      category: "System",
      onSelect: (dialog) => {
        const previousMode = sync.data.isolation.mode
        if (previousMode === "read-only" || previousMode === "workspace-write") {
          lastRestrictedIsolationMode = previousMode
        }
        const next = previousMode === "full-access" ? (lastRestrictedIsolationMode ?? "workspace-write") : "full-access"
        sandboxPutController?.abort()
        const controller = new AbortController()
        sandboxPutController = controller
        const headers = directoryRequestHeaders({
          directory: sdk.directory,
          contentType: "application/json",
        })
        // Await the PUT before updating sync state so the UI reflects the
        // server-confirmed isolation mode. An optimistic update would let
        // the user send prompts during the async gap while the server still
        // enforces the previous mode, producing confusing isolation prompts.
        void putJsonWithTimeout("/isolation", { mode: next }, headers, { signal: controller.signal })
          .then(() => {
            if (controller.signal.aborted || sandboxPutController !== controller) return
            sync.set("isolation", "mode", next)
            sync.set("isolation", "network", next === "full-access")
          })
          .catch((error) => {
            if (controller.signal.aborted || sandboxPutController !== controller) return
            Log.Default.warn("failed to update sandbox setting", { error, mode: next })
            toast.show({
              message: error instanceof Error ? error.message : "Failed to save sandbox setting",
              variant: "error",
            })
          })
        dialog.clear()
      },
    },
  ])

  let updateHandlerDisposed = false
  const eventUnsubs = [
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
        route.navigate({ type: "home" })
        toast.show({
          variant: "info",
          message: "The current session was deleted",
        })
      }
    }),

    sdk.event.on(SessionApi.Event.Error.type, (evt) => {
      const error = evt.properties.error
      if (error && typeof error === "object" && error.name === "MessageAbortedError") return

      toast.show({
        variant: "error",
        message: unknownErrorMessage(error),
        duration: 5000,
      })
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

      const result = await sdk.client.global.upgrade({ target: version })
      if (updateHandlerDisposed) return

      if (result.error || !result.data?.success) {
        const reason =
          (result.data as { success: false; error: string } | undefined)?.error ||
          unknownErrorMessage(result.error) ||
          "Update failed"
        toast.show({
          variant: "error",
          title: "Update Failed",
          message: reason,
          duration: 10000,
        })
        return
      }

      await DialogAlert.show(
        dialog,
        "Update Complete",
        `Successfully updated to ax-code v${result.data.version}. Please restart the application.`,
      )
      if (updateHandlerDisposed) return

      exit()
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
      <Switch>
        <Match when={route.data.type === "home"}>
          <Home />
        </Match>
        <Match when={route.data.type === "session"}>
          <Show
            when={sessionRoute()}
            fallback={
              <box paddingLeft={2} paddingRight={2} paddingTop={1}>
                <text fg={theme.textMuted}>Loading session...</text>
              </box>
            }
          >
            {(SessionRoute) => <Dynamic component={SessionRoute()} />}
          </Show>
        </Match>
      </Switch>
    </box>
  )
}

function ErrorComponent(props: {
  error: Error
  reset: () => void
  onExit: () => Promise<void>
  mode?: "dark" | "light"
}) {
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
    issueURL.searchParams.set("title", `opentui: fatal: ${props.error.message}`)
  }

  if (props.error.stack) {
    issueURL.searchParams.set(
      "description",
      "```\n" + props.error.stack.substring(0, 6000 - issueURL.toString().length) + "...\n```",
    )
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
          Please report an issue.
        </text>
        <box onMouseUp={copyIssueURL} backgroundColor={colors.primary} padding={1}>
          <text attributes={TextAttributes.BOLD} fg={colors.bg}>
            Copy issue URL (exception info pre-filled)
          </text>
        </box>
        {copied() && <text fg={colors.muted}>Successfully copied</text>}
        {copyError() && <text fg={colors.muted}>{copyError()}</text>}
      </box>
      <box flexDirection="row" gap={2} alignItems="center">
        <text fg={colors.text}>A fatal error occurred!</text>
        <box onMouseUp={props.reset} backgroundColor={colors.primary} padding={1}>
          <text fg={colors.bg}>Reset TUI</text>
        </box>
        <box onMouseUp={handleExit} backgroundColor={colors.primary} padding={1}>
          <text fg={colors.bg}>Exit</text>
        </box>
      </box>
      <scrollbox height={Math.floor(term().height * 0.7)}>
        <text fg={colors.muted}>{props.error.stack}</text>
      </scrollbox>
      <text fg={colors.text}>{props.error.message}</text>
    </box>
  )
}
