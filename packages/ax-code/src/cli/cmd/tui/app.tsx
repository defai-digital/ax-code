import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { Clipboard } from "@tui/util/clipboard"
import { Selection } from "@tui/util/selection"
import { MouseButton, TextAttributes } from "@opentui/core"
import { RouteProvider, useRoute } from "@tui/context/route"
import {
  Switch,
  Match,
  createEffect,
  untrack,
  ErrorBoundary,
  createSignal,
  onMount,
  batch,
  Show,
  on,
  onCleanup,
} from "solid-js"
import { win32DisableProcessedInput, win32FlushInputBuffer, win32InstallCtrlCGuard } from "./win32"
import { Flag } from "@/flag/flag"
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
import { KVProvider, useKV } from "./context/kv"
import { Provider } from "@/provider/provider"
import { ArgsProvider, useArgs, type Args } from "./context/args"
import { PromptRefProvider, usePromptRef } from "./context/prompt"
import { TuiConfigProvider } from "./context/tui-config"
import { TuiConfig } from "@/config/tui"
import { DiagnosticLog } from "@/debug/diagnostic-log"
import { Log } from "@/util/log"
import { renderTui } from "./renderer"
import type { EventSource } from "./context/sdk"
import { Installation } from "@/installation"
import { installResizeInputGuard, useResizeInputRecovery } from "./input-mode"
import { Session } from "@tui/routes/session"

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
                                                <App onSnapshot={input.onSnapshot} />
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

  useResizeInputRecovery(dimensions)

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
      .then(() => toast.show({ message: "Copied to clipboard", variant: "info" }))
      .catch(toast.error)

    renderer.clearSelection()
  }
  const [terminalTitleEnabled, setTerminalTitleEnabled] = createSignal(kv.get("terminal_title_enabled", true))

  // Update terminal window title based on current route and session
  createEffect(() => {
    if (!terminalTitleEnabled() || Flag.AX_CODE_DISABLE_TERMINAL_TITLE) return

    if (route.data.type === "home") {
      renderer.setTerminalTitle("ax-code")
      return
    }

    if (route.data.type === "session") {
      const session = sync.session.get(route.data.sessionID)
      if (!session || SessionApi.isDefaultTitle(session.title)) {
        renderer.setTerminalTitle("ax-code")
        return
      }

      // Truncate title to 40 chars max
      const title = session.title.length > 40 ? session.title.slice(0, 37) + "..." : session.title
      renderer.setTerminalTitle(`ax-code | ${title}`)
    }
  })

  const args = useArgs()

  async function putJsonWithTimeout(path: string, body: unknown, headers?: Record<string, string>) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 10_000)
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
        throw new Error(`HTTP ${response.status} ${response.statusText}`.trim())
      }
    } finally {
      clearTimeout(timer)
    }
  }

  const RETRY_DELAY_MS = 250
  const MAX_SESSION_FORK_ATTEMPTS = 3
  const retryTimers = new Set<ReturnType<typeof setTimeout>>()
  let forkRetryDisposed = false

  onCleanup(() => {
    forkRetryDisposed = true
    for (const timer of retryTimers) clearTimeout(timer)
    retryTimers.clear()
  })

  function scheduleRetry(fn: () => void, delay = RETRY_DELAY_MS) {
    const timer = setTimeout(() => {
      retryTimers.delete(timer)
      fn()
    }, delay)
    retryTimers.add(timer)
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
        const { providerID, modelID } = Provider.parseModel(args.model)
        if (!providerID || !modelID)
          return toast.show({
            variant: "warning",
            message: `Invalid model format: ${args.model}`,
            duration: 3000,
          })
        local.model.set({ providerID, modelID }, { recent: true })
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
  createEffect(() => {
    if (continued || !sync.data.session_loaded || !args.continue) return
    const match = sync.data.session
      .toSorted((a, b) => b.time.updated - a.time.updated)
      .find((x) => x.parentID === undefined)?.id
    if (match) {
      continued = true
      if (args.fork) {
        forkSessionWithRetries({ sessionID: match, source: "continue" })
      } else {
        route.navigate({ type: "session", sessionID: match })
      }
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
            slash: {
              name: "workspaces",
            },
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
    {
      title: "Switch model",
      value: "model.list",
      keybind: "model_list",
      suggested: true,
      category: "Agent",
      slash: {
        name: "models",
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
        name: "agents",
      },
      onSelect: () => {
        void showAgentDialog()
      },
    },
    {
      title: "Toggle MCPs",
      value: "mcp.list",
      category: "Agent",
      slash: {
        name: "mcps",
      },
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
      slash: {
        name: "status",
      },
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
        name: "themes",
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
        import("open").then(({ default: open }) => open("https://github.com/defai-digital/ax-code")).catch(() => {})
        dialog.clear()
      },
      category: "System",
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
        const files = await props.onSnapshot?.()
        toast.show({
          variant: "info",
          message: `Heap snapshot written to ${files?.join(", ")}`,
          duration: 5000,
        })
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
        process.once("SIGCONT", () => {
          renderer.resume()
        })

        renderer.suspend()
        // pid=0 means send the signal to all processes in the process group
        process.kill(0, "SIGTSTP")
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
          if (!next) renderer.setTerminalTitle("")
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
      title: sync.data.smartLlm ? "Turn auto-route off" : "Turn auto-route on",
      value: "app.toggle.smart_llm",
      category: "System",
      slash: { name: "smart-llm", aliases: ["toggle-smart-llm"] },
      onSelect: (dialog) => {
        const next = !sync.data.smartLlm
        sync.set("smartLlm", next)
        void putJsonWithTimeout("/smart-llm", { enabled: next }).catch(() => {
          sync.set("smartLlm", !next)
        })
        dialog.clear()
      },
    },
    {
      title: sync.data.autonomous ? "Turn autonomous off" : "Turn autonomous on",
      value: "app.toggle.autonomous",
      category: "System",
      slash: { name: "autonomous", aliases: ["toggle-autonomous"] },
      onSelect: (dialog) => {
        const next = !sync.data.autonomous
        sync.set("autonomous", next)
        void putJsonWithTimeout("/autonomous", { enabled: next }).catch(() => {
          sync.set("autonomous", !next)
        })
        dialog.clear()
      },
    },
    {
      title: sync.data.isolation.mode === "full-access" ? "Turn sandbox on" : "Turn sandbox off",
      value: "app.toggle.sandbox",
      category: "System",
      slash: { name: "sandbox", aliases: ["toggle-sandbox"] },
      onSelect: (dialog) => {
        const previousMode = sync.data.isolation.mode
        const previousNetwork = sync.data.isolation.network
        const next = previousMode === "full-access" ? "workspace-write" : "full-access"
        sync.set("isolation", "mode", next)
        sync.set("isolation", "network", next === "full-access")
        const headers: Record<string, string> = { "content-type": "application/json" }
        if (sdk.directory) {
          const encoded = /[^\x00-\x7F]/.test(sdk.directory) ? encodeURIComponent(sdk.directory) : sdk.directory
          headers["x-ax-code-directory"] = encoded
          headers["x-opencode-directory"] = encoded
        }
        void putJsonWithTimeout("/isolation", { mode: next }, headers).catch(() => {
          sync.set("isolation", "mode", previousMode)
          sync.set("isolation", "network", previousNetwork)
        })
        dialog.clear()
      },
    },
  ])

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

    sdk.event.on(TuiEvent.SessionSelect.type, (evt) => {
      route.navigate({
        type: "session",
        sessionID: evt.properties.sessionID,
      })
    }),

    sdk.event.on(SessionApi.Event.Deleted.type, (evt) => {
      if (route.data.type === "session" && route.data.sessionID === evt.properties.info.id) {
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
      const message = (() => {
        if (!error) return "An error occurred"

        if (typeof error === "object") {
          const data = error.data
          if (data && typeof data === "object" && "message" in data && typeof data.message === "string") {
            return data.message
          }
        }
        return String(error)
      })()

      toast.show({
        variant: "error",
        message,
        duration: 5000,
      })
    }),

    sdk.event.on("installation.update-available", async (evt) => {
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

      if (result.error || !result.data?.success) {
        const reason =
          (result.data as { success: false; error: string } | undefined)?.error ||
          (result.error instanceof Error ? result.error.message : String(result.error ?? "")) ||
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

      exit()
    }),
  ]
  onCleanup(() => {
    for (const unsub of eventUnsubs) unsub()
  })

  return (
    <box
      width={dimensions().width}
      height={dimensions().height}
      backgroundColor={theme.background}
      onMouseDown={(evt) => {
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
          <Session />
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
    renderer.setTerminalTitle("")
    renderer.destroy()
    win32FlushInputBuffer()
    await props.onExit()
  }

  useKeyboard((evt) => {
    if (evt.ctrl && evt.name === "c") {
      handleExit()
    }
  })
  const [copied, setCopied] = createSignal(false)

  const issueURL = new URL("https://github.com/defai-digital/ax-code/issues/new?template=bug-report.yml")

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
    Clipboard.copy(issueURL.toString()).then(() => {
      setCopied(true)
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
