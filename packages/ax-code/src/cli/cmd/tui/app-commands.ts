import { Flag } from "@/flag/flag"
import { WorkMode } from "@/mode/work-mode"
import { effortChangeMessage } from "@/provider/effort-label"
import { GITHUB_REPO_URL } from "@/constants/project"
import { launchWebUi } from "@/desktop/webui"
import { DiagnosticLog } from "@/debug/diagnostic-log"
import { Log } from "@/util/log"
import { directoryRequestHeaders } from "@tui/util/request-headers"
import { clearTuiTerminalTitle } from "./renderer"
import { resolveDesktopHandoff } from "./navigation/desktop-handoff"
import { parseIsolationState } from "./context/sync-runtime-store"
import { nextRunMode, runModeLabel, type RunMode } from "./component/prompt/run-mode-view-model"
import type { CommandOption } from "./component/dialog-command"
import type { TuiDialogLoaders } from "./tui-dialogs"

export type AppCommandSandbox = {
  lastRestricted: "read-only" | "workspace-write" | undefined
  controller: AbortController | undefined
}

export type AppCommandsInput = {
  dialogs: TuiDialogLoaders
  sync: any
  kv: any
  route: any
  promptRef: any
  dialog: any
  local: any
  connected: () => unknown
  setMode: (mode: "dark" | "light") => void
  mode: () => "dark" | "light"
  locked: () => boolean
  lock: () => void
  unlock: () => void
  terminalTitleEnabled: () => boolean
  setTerminalTitleEnabled: (fn: (prev: boolean) => boolean) => void
  renderProfile: Parameters<typeof clearTuiTerminalTitle>[0]
  smartLlmToggle: { toggle: () => void }
  currentRunMode: () => RunMode
  setRunMode: (mode: RunMode) => void
  toast: {
    show: (input: { message: string; variant: "error" | "info" | "success" | "warning"; duration?: number }) => void
  }
  sdk: any
  putJsonWithTimeout: (
    path: string,
    body: unknown,
    headers?: Record<string, string>,
    options?: { signal?: AbortSignal },
  ) => Promise<unknown>
  sandbox: AppCommandSandbox
  exit: () => void
  renderer: any
  onSnapshot?: () => Promise<string[]>
  terminalSuspend: { suspend: (input: { suspend: () => void; resume: () => void }) => void }
}

export function appCommands(input: AppCommandsInput): CommandOption[] {
  const {
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
    renderer,
    onSnapshot,
    terminalSuspend,
  } = input

  return [
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
        void dialogs.showSessionListDialog()
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
              void dialogs.showWorkspaceListDialog()
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
        void dialogs.showModelDialog()
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
        hidden: true,
      },
      onSelect: () => {
        void dialogs.showAgentDialog()
      },
    },
    {
      title: "Toggle MCPs",
      value: "mcp.list",
      category: "Agent",
      slash: {
        name: "mcp",
      },
      onSelect: () => {
        void dialogs.showMcpDialog()
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
      title: "Set effort",
      value: "effort.list",
      category: "Agent",
      slash: {
        name: "effort",
        aliases: ["variant", "thinking"],
        hidden: true,
      },
      onSelect: () => {
        void dialogs.showEffortDialog()
      },
    },
    {
      title: "Effort cycle",
      value: "variant.cycle",
      keybind: "variant_cycle",
      category: "Agent",
      hidden: true,
      onSelect: () => {
        const variants = local.model.variant.list()
        if (variants.length === 0) {
          toast.show({
            message: `${local.model.parsed().model ?? "This model"} has no effort levels to cycle`,
            variant: "info",
            duration: 1500,
          })
          return
        }
        const next = local.model.variant.cycle()
        toast.show({
          message: effortChangeMessage(next),
          variant: "info",
          duration: 1500,
        })
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
        void dialogs.showProviderDialog()
      },
      category: "Provider",
    },
    {
      title: "Manage providers",
      value: "provider.manage",
      slash: {
        name: "providers",
      },
      onSelect: () => {
        void dialogs.showProvidersDialog()
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
        void dialogs.showStatusDialog()
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
        hidden: true,
      },
      onSelect: () => {
        void dialogs.showThemeListDialog()
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
        void dialogs.showHelpDialog()
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
        hidden: true,
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
        hidden: true,
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
        hidden: true,
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
          const files = await onSnapshot?.()
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
    // SIGTSTP does not exist on Windows, so process-group suspension would
    // throw there. Do not register a command the platform cannot execute.
    ...(process.platform === "win32"
      ? []
      : [
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
        ]),
    {
      title: terminalTitleEnabled() ? "Disable terminal title" : "Enable terminal title",
      value: "terminal.title.toggle",
      keybind: "terminal_title_toggle",
      category: "System",
      onSelect: (dialog) => {
        setTerminalTitleEnabled((prev) => {
          const next = !prev
          kv.set("terminal_title_enabled", next)
          if (!next) clearTuiTerminalTitle(renderProfile)
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
        hidden: true,
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
          sandbox.lastRestricted = previousMode
        }
        const next = previousMode === "full-access" ? (sandbox.lastRestricted ?? "workspace-write") : "full-access"
        sandbox.controller?.abort()
        const controller = new AbortController()
        sandbox.controller = controller
        const headers = directoryRequestHeaders({
          directory: sdk.directory,
          contentType: "application/json",
        })
        // Await the PUT before updating sync state so the UI reflects the
        // server-confirmed isolation mode. An optimistic update would let
        // the user send prompts during the async gap while the server still
        // enforces the previous mode, producing confusing isolation prompts.
        void putJsonWithTimeout("/isolation", { mode: next }, headers, { signal: controller.signal })
          .then((body) => {
            if (controller.signal.aborted || sandbox.controller !== controller) return
            // PUT persists the project preference but reports the effective
            // state: a CLI --sandbox / AX_CODE_ISOLATION_MODE override stays
            // authoritative. Applying `next` would lie about the live sandbox.
            const effective = parseIsolationState(body)
            if (!effective) {
              throw new Error("Sandbox setting was saved but the server returned an unexpected isolation state")
            }
            sync.set("isolation", "mode", effective.mode)
            sync.set("isolation", "network", effective.network)
            if (effective.mode !== next) {
              toast.show({
                message:
                  "Sandbox stayed " +
                  (effective.mode === "full-access" ? "off" : "on") +
                  " because a CLI --sandbox or AX_CODE_ISOLATION_MODE override is in effect",
                variant: "warning",
              })
            }
          })
          .catch((error) => {
            if (controller.signal.aborted || sandbox.controller !== controller) return
            Log.Default.warn("failed to update sandbox setting", { error, mode: next })
            toast.show({
              message: error instanceof Error ? error.message : "Failed to save sandbox setting",
              variant: "error",
            })
          })
        dialog.clear()
      },
    },
  ]
}
