import { english, type Translate } from "./i18n"
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
import { DIGITAL_CODE_ON_START_DEFAULT } from "./component/digital-code-view-model"
import { workModeCycleToast } from "./component/work-mode-availability"
import type { CommandOption } from "./component/dialog-command"
import type { TuiDialogLoaders } from "./tui-dialogs"
import { DialogConfirm } from "@tui/ui/dialog-confirm"
import {
  confirmNavigationClear,
  NAVIGATION_CLEAR_MESSAGE,
  NAVIGATION_CLEAR_TITLE,
  navigationFilter,
} from "./navigation/navigation-model"
import { NAVIGATION_DOCK_MIN_WIDTH } from "./navigation/navigation-layout"

export type AppCommandSandbox = {
  lastRestricted: "read-only" | "workspace-write" | undefined
  controller: AbortController | undefined
}

export type AppCommandsInput = {
  t?: Translate
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
  exit: (() => void) & { flourish?: () => void }
  persistentRuntime?: boolean
  renderer: any
  onSnapshot?: () => Promise<string[]>
  terminalSuspend: { suspend: (input: { suspend: () => void; resume: () => void }) => void }
  playDigitalCode: () => void
  playReverseDigitalCode: () => void
  terminalWidth: () => number
}

export function appCommands(input: AppCommandsInput): CommandOption[] {
  const t = input.t ?? english
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
    playDigitalCode,
    playReverseDigitalCode,
  } = input

  return [
    {
      title: t("command.switchSession"),
      value: "session.list",
      keybind: "session_list",
      category: t("common.session"),
      suggested: sync.data.session.length > 0,
      slash: {
        name: "sessions",
        aliases: ["resume", "continue"],
      },
      onSelect: () => {
        void dialogs.showSessionListDialog()
      },
    },
    {
      title: t("command.pending"),
      value: "session.attention",
      category: t("common.session"),
      slash: { name: "attention" },
      onSelect: () => {
        void dialogs.showAttentionDialog()
      },
    },
    {
      title: t("command.details"),
      value: "session.navigation.info",
      category: t("common.session"),
      slash: { name: "navigation-info" },
      onSelect: () => {
        const sessionID = route.data.type === "session" ? route.data.sessionID : undefined
        void dialogs.showNavigationInfo(
          sdk.directory ?? sync.data.path.directory ?? "Unavailable",
          sessionID ? (sync.session.get(sessionID)?.title ?? sessionID) : t("command.newSession"),
        )
      },
    },
    {
      title: t("command.navigationFilter"),
      value: "session.navigation.filter",
      category: t("common.session"),
      slash: { name: "navigation-filter" },
      onSelect: () => {
        kv.set("navigation_filter", navigationFilter(kv.get("navigation_filter")) === "recent" ? "active" : "recent")
        dialog.clear()
      },
    },
    {
      title: t("command.navigationWidth"),
      value: "session.navigation.width",
      category: t("common.session"),
      slash: { name: "navigation-width" },
      onSelect: () => {
        void dialogs.showNavigationWidthDialog()
      },
    },
    {
      title: t("command.sidebarWidth"),
      value: "session.sidebar.width",
      category: t("common.session"),
      slash: { name: "sidebar-width" },
      onSelect: () => {
        void dialogs.showSidebarWidthDialog()
      },
    },
    {
      title: t("command.clearNavigation"),
      value: "session.navigation.clear",
      category: t("common.session"),
      slash: { name: "navigation-clear" },
      onSelect: async () => {
        await confirmNavigationClear({
          ask: () => DialogConfirm.show(dialog, NAVIGATION_CLEAR_TITLE, NAVIGATION_CLEAR_MESSAGE),
          apply: (at) => kv.set("navigation_cleared_at", at),
        })
      },
    },
    {
      title:
        input.terminalWidth() < NAVIGATION_DOCK_MIN_WIDTH
          ? t("command.openNavigation")
          : kv.get("navigation_visible", true)
            ? t("command.hideNavigation")
            : t("command.showNavigation"),
      value: "session.navigation",
      category: t("common.session"),
      slash: { name: "navigation" },
      onSelect: () => {
        if (input.terminalWidth() < NAVIGATION_DOCK_MIN_WIDTH) {
          void dialogs.showNavigationDialog()
          return
        }
        kv.set("navigation_visible", !kv.get("navigation_visible", true))
        dialog.clear()
      },
    },
    ...(Flag.AX_CODE_EXPERIMENTAL_WORKSPACES
      ? [
          {
            title: t("command.workspaces"),
            value: "workspace.list",
            category: t("category.workspace"),
            suggested: true,
            onSelect: () => {
              void dialogs.showWorkspaceListDialog()
            },
          },
        ]
      : []),
    {
      title: t("command.newSession"),
      suggested: route.data.type === "session",
      value: "session.new",
      keybind: "session_new",
      category: t("common.session"),
      slash: {
        name: "new",
        aliases: ["clear"],
      },
      onSelect: () => {
        // New chat always starts in Agent work mode (not sticky council/arena).
        // Drop an auto-routed specialist (debug/plan/…) so Home does not
        // inherit that agent's model pin on the next submit.
        kv.set("work_mode", WorkMode.DEFAULT)
        local.agent.resetToDefault()
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
      title: t("command.pinned", { slot }),
      value: `session.quick_switch.${slot}`,
      keybind: kb,
      category: t("common.session"),
      onSelect: () => {
        local.session.quickSwitch(slot)
        dialog.clear()
      },
    })),
    {
      title: t("command.switchModel"),
      value: "model.list",
      keybind: "model_list",
      suggested: true,
      category: t("category.agent"),
      slash: {
        name: "model",
        aliases: ["models"],
      },
      onSelect: () => {
        void dialogs.showModelDialog()
      },
    },
    {
      title: t("command.modelCycle"),
      value: "model.cycle_recent",
      keybind: "model_cycle_recent",
      category: t("category.agent"),
      hidden: true,
      onSelect: () => {
        local.model.cycle(1)
      },
    },
    {
      title: t("command.modelReverse"),
      value: "model.cycle_recent_reverse",
      keybind: "model_cycle_recent_reverse",
      category: t("category.agent"),
      hidden: true,
      onSelect: () => {
        local.model.cycle(-1)
      },
    },
    {
      title: t("command.favoriteCycle"),
      value: "model.cycle_favorite",
      keybind: "model_cycle_favorite",
      category: t("category.agent"),
      hidden: true,
      onSelect: () => {
        local.model.cycleFavorite(1)
      },
    },
    {
      title: t("command.favoriteReverse"),
      value: "model.cycle_favorite_reverse",
      keybind: "model_cycle_favorite_reverse",
      category: t("category.agent"),
      hidden: true,
      onSelect: () => {
        local.model.cycleFavorite(-1)
      },
    },
    {
      title: t("command.switchAgent"),
      value: "agent.list",
      keybind: "agent_list",
      category: t("category.agent"),
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
      title: t("command.mcp"),
      value: "mcp.list",
      category: t("category.agent"),
      slash: {
        name: "mcp",
      },
      onSelect: () => {
        void dialogs.showMcpDialog()
      },
    },
    {
      title: t("command.scheduled"),
      value: "scheduled.list",
      category: t("category.agent"),
      slash: {
        name: "schedule",
        aliases: ["scheduled"],
      },
      onSelect: () => {
        void dialogs.showScheduledTasksDialog()
      },
    },
    {
      title: t("command.agentCycle"),
      value: "agent.cycle",
      keybind: "agent_cycle",
      category: t("category.agent"),
      hidden: true,
      onSelect: () => {
        local.agent.move(1)
      },
    },
    {
      title: t("command.effort"),
      value: "effort.list",
      category: t("category.agent"),
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
      title: t("command.effortCycle"),
      value: "variant.cycle",
      keybind: "variant_cycle",
      category: t("category.agent"),
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
      title: t("command.agentReverse"),
      value: "agent.cycle.reverse",
      keybind: "agent_cycle_reverse",
      category: t("category.agent"),
      hidden: true,
      onSelect: () => {
        local.agent.move(-1)
      },
    },
    {
      title: t("command.connect"),
      value: "provider.connect",
      suggested: !connected(),
      slash: {
        name: "connect",
      },
      onSelect: () => {
        void dialogs.showProviderDialog()
      },
      category: t("category.provider"),
    },
    {
      title: t("command.providers"),
      value: "provider.manage",
      slash: {
        name: "providers",
      },
      onSelect: () => {
        void dialogs.showProvidersDialog()
      },
      category: t("category.provider"),
    },
    {
      title: t("command.status"),
      keybind: "status_view",
      value: "ax-code.status",
      slash: {
        name: "status",
      },
      onSelect: () => {
        void dialogs.showStatusDialog()
      },
      category: t("category.system"),
    },
    {
      title: t("command.theme"),
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
      category: t("category.system"),
    },
    {
      title: t("command.themeMode"),
      value: "theme.switch_mode",
      onSelect: (dialog) => {
        setMode(mode() === "dark" ? "light" : "dark")
        dialog.clear()
      },
      category: t("category.system"),
    },
    {
      title: locked() ? t("command.unlockTheme") : t("command.lockTheme"),
      value: "theme.mode.lock",
      onSelect: (dialog) => {
        if (locked()) unlock()
        else lock()
        dialog.clear()
      },
      category: t("category.system"),
    },
    {
      title: t("command.help"),
      value: "help.show",
      slash: {
        name: "help",
      },
      onSelect: () => {
        void dialogs.showHelpDialog()
      },
      category: t("category.system"),
    },
    {
      title: t("command.docs"),
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
      category: t("category.system"),
    },
    {
      title: "Open Web UI",
      value: "webui.open",
      slash: {
        name: "webui",
        hidden: true,
      },
      description: "Start or open the AX Code browser UI",
      category: t("category.system"),
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
      category: t("category.system"),
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
      title: input.persistentRuntime ? t("command.detach") : t("command.exit"),
      value: "app.exit",
      slash: {
        name: "exit",
        aliases: ["quit", "q"],
      },
      onSelect: () => {
        // An explicit quit plays the app-registered flourish (the reverse
        // rain) before teardown; a bare exit stub stays immediate.
        if (exit.flourish) void exit.flourish()
        else exit()
      },
      category: t("category.system"),
    },
    {
      title: t("command.debug"),
      category: t("category.system"),
      value: "app.debug",
      onSelect: (dialog) => {
        renderer.toggleDebugOverlay()
        dialog.clear()
      },
    },
    {
      title: t("command.console"),
      category: t("category.system"),
      value: "app.console",
      onSelect: (dialog) => {
        renderer.console.toggle()
        dialog.clear()
      },
    },
    {
      title: t("command.heap"),
      category: t("category.system"),
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
            title: t("command.suspend"),
            value: "terminal.suspend",
            keybind: "terminal_suspend",
            category: t("category.system"),
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
      title: terminalTitleEnabled() ? t("command.titleOff") : t("command.titleOn"),
      value: "terminal.title.toggle",
      keybind: "terminal_title_toggle",
      category: t("category.system"),
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
      title: kv.get("animations_enabled", true) ? t("command.animationsOff") : t("command.animationsOn"),
      value: "app.toggle.animations",
      category: t("category.system"),
      onSelect: (dialog) => {
        kv.set("animations_enabled", !kv.get("animations_enabled", true))
        dialog.clear()
      },
    },
    {
      title: t("command.opening"),
      description: t("ui.previewTheOpeningDigitalCodeAnimation"),
      value: "app.digital_code.play",
      category: t("category.system"),
      onSelect: (dialog) => {
        dialog.clear()
        playDigitalCode()
      },
    },
    {
      title: t("command.ending"),
      description: t("ui.previewTheEndingDigitalCodeAnimationThatPlaysWhenYouExit"),
      value: "app.digital_code.play_reverse",
      category: t("category.system"),
      onSelect: (dialog) => {
        dialog.clear()
        playReverseDigitalCode()
      },
    },
    {
      title: kv.get("digital_code_on_task_complete", false)
        ? t("ui.disableDigitalCodeOnTaskCompletion")
        : t("ui.enableDigitalCodeOnTaskCompletion"),
      description: t("ui.playTheOverlayOnceAScheduledTaskRunCompletes"),
      value: "app.toggle.digital_code",
      category: t("category.system"),
      onSelect: (dialog) => {
        kv.set("digital_code_on_task_complete", !kv.get("digital_code_on_task_complete", false))
        dialog.clear()
      },
    },
    {
      title: kv.get("digital_code_on_start", DIGITAL_CODE_ON_START_DEFAULT)
        ? t("ui.disableDigitalCodeOnStartup")
        : t("ui.enableDigitalCodeOnStartup"),
      description: t("ui.playTheOverlayOnceWhenTheTuiLaunches"),
      value: "app.toggle.digital_code_on_start",
      category: t("category.system"),
      onSelect: (dialog) => {
        kv.set("digital_code_on_start", !kv.get("digital_code_on_start", DIGITAL_CODE_ON_START_DEFAULT))
        dialog.clear()
      },
    },
    {
      title: kv.get("nerd_font_enabled", false) ? t("command.nerdOff") : t("command.nerdOn"),
      description: "Recommended terminal font: Cascadia Code Nerd Font",
      value: "app.toggle.nerd_font",
      category: t("category.system"),
      onSelect: (dialog) => {
        kv.set("nerd_font_enabled", !kv.get("nerd_font_enabled", false))
        dialog.clear()
      },
    },
    {
      title: kv.get("diff_wrap_mode", "word") === "word" ? t("command.wrapOff") : t("command.wrapOn"),
      value: "app.toggle.diffwrap",
      category: t("category.system"),
      onSelect: (dialog) => {
        const current = kv.get("diff_wrap_mode", "word")
        kv.set("diff_wrap_mode", current === "word" ? "none" : "word")
        dialog.clear()
      },
    },
    {
      title: sync.data.smartLlm ? t("command.fastOff") : t("command.fastOn"),
      value: "app.toggle.smart_llm",
      category: t("category.system"),
      onSelect: (dialog) => {
        smartLlmToggle.toggle()
        dialog.clear()
      },
    },
    {
      title: t("command.runMode", { mode: runModeLabel(currentRunMode()) }),
      value: "app.cycle.run_mode",
      category: t("category.system"),
      onSelect: (dialog) => {
        setRunMode(nextRunMode(currentRunMode()))
        dialog.clear()
      },
    },
    {
      title: t("command.workMode", { mode: WorkMode.label(WorkMode.parse(kv.get("work_mode", WorkMode.DEFAULT))) }),
      description:
        "Agent: one agent · Council: multi-model advisory review (needs ≥2 providers) · Arena: best-of-N comparison (opt-in)",
      value: "app.cycle.work_mode",
      category: t("category.agent"),
      slash: {
        name: "work-mode",
        aliases: ["workmode"],
      },
      onSelect: () => {
        void dialogs.showWorkModeDialog()
      },
    },
    {
      title: t("command.agentMode"),
      value: "app.clear.work_mode",
      category: t("category.agent"),
      hidden: WorkMode.parse(kv.get("work_mode", WorkMode.DEFAULT)) === WorkMode.DEFAULT,
      onSelect: (dialog) => {
        kv.set("work_mode", WorkMode.DEFAULT)
        toast.show({
          message: workModeCycleToast("agent", { state: "available", members: 1 }, []),
          variant: "info",
          duration: 2500,
        })
        dialog.clear()
      },
    },
    {
      title: sync.data.autonomous ? t("command.autoOff") : t("command.autoOn"),
      value: "app.toggle.autonomous",
      category: t("category.system"),
      onSelect: (dialog) => {
        setRunMode(currentRunMode() === "none" ? "auto" : "none")
        dialog.clear()
      },
    },
    {
      title: currentRunMode() === "super-long" ? t("command.longOff") : t("command.longOn"),
      value: "app.toggle.super_long",
      category: t("category.system"),
      onSelect: (dialog) => {
        setRunMode(currentRunMode() === "super-long" ? "auto" : "super-long")
        dialog.clear()
      },
    },
    {
      title: sync.data.isolation.mode === "full-access" ? t("command.sandboxOn") : t("command.sandboxOff"),
      value: "app.toggle.sandbox",
      category: t("category.system"),
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
