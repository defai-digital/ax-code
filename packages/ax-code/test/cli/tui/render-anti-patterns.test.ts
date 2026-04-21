import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"

const TUI_ROOT = path.resolve(import.meta.dir, "../../../src/cli/cmd/tui")
const APP_SRC = path.join(TUI_ROOT, "app.tsx")
const HELPER_SRC = path.join(TUI_ROOT, "context/helper.tsx")
const RENDERER_SRC = path.join(TUI_ROOT, "renderer.ts")
const SESSION_ROUTE_SRC = path.join(TUI_ROOT, "routes/session/index.tsx")
const PERMISSION_PROMPT_SRC = path.join(TUI_ROOT, "routes/session/permission.tsx")
const QUESTION_PROMPT_SRC = path.join(TUI_ROOT, "routes/session/question.tsx")
const DIALOG_MESSAGE_SRC = path.join(TUI_ROOT, "routes/session/dialog-message.tsx")
const DISPLAY_COMMANDS_SRC = path.join(TUI_ROOT, "routes/session/display-commands.ts")
const TIMELINE_FORK_DIALOG_SRC = path.join(TUI_ROOT, "routes/session/dialog-fork-from-timeline.tsx")
const TIMELINE_DIALOG_SRC = path.join(TUI_ROOT, "routes/session/dialog-timeline.tsx")
const SIDEBAR_SRC = path.join(TUI_ROOT, "routes/session/sidebar.tsx")
const SESSION_LIST_DIALOG_SRC = path.join(TUI_ROOT, "component/dialog-session-list.tsx")
const WORKSPACE_LIST_DIALOG_SRC = path.join(TUI_ROOT, "component/dialog-workspace-list.tsx")
const THEME_DIALOG_SRC = path.join(TUI_ROOT, "component/dialog-theme-list.tsx")
const DIALOG_PROVIDER_SRC = path.join(TUI_ROOT, "component/dialog-provider.tsx")
const AUTOCOMPLETE_SRC = path.join(TUI_ROOT, "component/prompt/autocomplete.tsx")
const DIALOG_SELECT_SRC = path.join(TUI_ROOT, "ui/dialog-select.tsx")
const DIALOG_SRC = path.join(TUI_ROOT, "ui/dialog.tsx")
const DIALOG_PROMPT_SRC = path.join(TUI_ROOT, "ui/dialog-prompt.tsx")
const DIALOG_EXPORT_OPTIONS_SRC = path.join(TUI_ROOT, "ui/dialog-export-options.tsx")
const SYNC_SRC = path.join(TUI_ROOT, "context/sync.tsx")
const SYNC_BOOTSTRAP_FLOW_SRC = path.join(TUI_ROOT, "context/sync-bootstrap-flow.ts")
const SYNC_BOOTSTRAP_PLAN_SRC = path.join(TUI_ROOT, "context/sync-bootstrap-plan.ts")
const SYNC_BOOTSTRAP_PHASE_PLAN_SRC = path.join(TUI_ROOT, "context/sync-bootstrap-phase-plan.ts")
const SYNC_BOOTSTRAP_REQUEST_SRC = path.join(TUI_ROOT, "context/sync-bootstrap-request.ts")
const SYNC_BOOTSTRAP_RUNNER_SRC = path.join(TUI_ROOT, "context/sync-bootstrap-runner.ts")
const HOME_SRC = path.join(TUI_ROOT, "routes/home.tsx")
const STARTUP_TRACE_SRC = path.join(TUI_ROOT, "util/startup-trace.ts")
const DEFERRED_STARTUP_SRCS = [
  path.join(TUI_ROOT, "component/prompt/history.tsx"),
  path.join(TUI_ROOT, "component/prompt/frecency.tsx"),
  path.join(TUI_ROOT, "component/prompt/stash.tsx"),
  path.join(TUI_ROOT, "context/theme.tsx"),
]
const DOCTOR_PRELOAD_SRC = path.resolve(import.meta.dir, "../../../src/cli/cmd/doctor-preload.ts")

describe("tui OpenTUI stability guardrails", () => {
  test("keeps OpenTUI wired as the default renderer path", async () => {
    const app = await fs.readFile(APP_SRC, "utf8")
    const renderer = await fs.readFile(RENDERER_SRC, "utf8")

    expect(app).toContain('import { renderTui } from "./renderer"')
    expect(app).not.toMatch(/runNativeTuiSlice|AX_CODE_TUI_NATIVE/i)
    expect(renderer).toContain('from "@opentui/solid"')
    expect(renderer).toContain("render(root, createTuiRenderOptions(options))")
  })

  test("keeps renderer startup configured for terminal stability", async () => {
    const renderer = await fs.readFile(RENDERER_SRC, "utf8")

    expect(renderer).toContain("targetFps: 60")
    expect(renderer).toContain("exitOnCtrlC: false")
    expect(renderer).toContain("autoFocus: false")
    expect(renderer).toContain("openConsoleOnError: false")
    expect(renderer).toContain("useKittyKeyboard: {}")
  })

  test("keeps passthrough external output enabled in the app runtime", async () => {
    const app = await fs.readFile(APP_SRC, "utf8")

    expect(app).toContain('renderer.externalOutputMode = "passthrough"')
  })

  test("does not block first paint on a pre-render terminal color probe", async () => {
    const app = await fs.readFile(APP_SRC, "utf8")

    expect(app).not.toContain("getTerminalBackgroundColor")
  })

  test("does not eagerly import the heavy session route on app startup", async () => {
    const app = await fs.readFile(APP_SRC, "utf8")

    expect(app).not.toContain('import { Session } from "@tui/routes/session"')
    expect(app).toContain('import("@tui/routes/session")')
    expect(app).toContain("ensureSessionRouteLoaded")
  })

  test("avoids async createEffect in the session startup path", async () => {
    const session = await fs.readFile(SESSION_ROUTE_SRC, "utf8")

    expect(session).not.toContain("createEffect(async")
  })

  test("handles delegated task preview session sync failures without unhandled rejections", async () => {
    const session = await fs.readFile(SESSION_ROUTE_SRC, "utf8")

    expect(session).toContain('void sync.session.sync(id).catch((error) => {')
    expect(session).toContain('log.warn("task child session preview sync failed"')
  })

  test("handles question prompt replies and rejects without leaking unhandled failures", async () => {
    const question = await fs.readFile(QUESTION_PROMPT_SRC, "utf8")

    expect(question).toContain("function submitQuestionRequest(")
    expect(question).toContain("void Promise.resolve()")
    expect(question).toContain('log.warn(failureLabel, { error, requestID: props.request.id })')
    expect(question).toContain('"question prompt reply failed"')
    expect(question).toContain('"question prompt reject failed"')
    expect(question).toContain('"Failed to submit question response"')
    expect(question).toContain('"Failed to reject question"')
    expect(question).toContain("if (total === 0) {")
  })

  test("handles permission prompt replies without leaking unhandled failures", async () => {
    const permission = await fs.readFile(PERMISSION_PROMPT_SRC, "utf8")

    expect(permission).toContain("function submitPermissionReply(")
    expect(permission).toContain("void Promise.resolve()")
    expect(permission).toContain('log.warn(failureLabel, { error, requestID: props.request.id })')
    expect(permission).toContain('"permission prompt once-reply failed"')
    expect(permission).toContain('"permission prompt always-reply failed"')
    expect(permission).toContain('"permission prompt reject failed"')
    expect(permission).toContain('"Failed to allow permission once"')
    expect(permission).toContain('"Failed to allow permission permanently"')
    expect(permission).toContain('"Failed to reject permission"')
  })

  test("handles dialog message revert failures without leaking stale prompt state", async () => {
    const dialogMessage = await fs.readFile(DIALOG_MESSAGE_SRC, "utf8")

    expect(dialogMessage).toContain('log.warn("dialog message revert failed"')
    expect(dialogMessage).toContain('message: error instanceof Error ? error.message : "Failed to revert message"')
    expect(dialogMessage).toContain("props.setPrompt(promptState(sync.data.part[msg.id] ?? []))")
    expect(dialogMessage).toContain('message: "Message is no longer available"')
    expect(dialogMessage).toContain("dialog.clear()")
  })

  test("handles dialog message copy and fork failures without leaking unhandled rejections", async () => {
    const dialogMessage = await fs.readFile(DIALOG_MESSAGE_SRC, "utf8")

    expect(dialogMessage).toContain('log.warn("dialog message copy failed"')
    expect(dialogMessage).toContain('message: error instanceof Error ? error.message : "Failed to copy message"')
    expect(dialogMessage).toContain('log.warn("dialog message fork failed"')
    expect(dialogMessage).toContain('message: error instanceof Error ? error.message : "Failed to fork session"')
    expect(dialogMessage).toContain('message: "Message is no longer available"')
    expect(dialogMessage).toContain("messageID: msg.id")
    expect(dialogMessage).toContain("promptState(sync.data.part[msg.id] ?? [])")
  })

  test("handles timeline fork failures without leaking unhandled rejections", async () => {
    const timelineForkDialog = await fs.readFile(TIMELINE_FORK_DIALOG_SRC, "utf8")

    expect(timelineForkDialog).toContain('log.warn("timeline fork failed"')
    expect(timelineForkDialog).toContain('message: error instanceof Error ? error.message : "Failed to fork session"')
    expect(timelineForkDialog).toContain("promptState(sync.data.part[message.id] ?? [])")
    expect(timelineForkDialog).toContain('title: "No fork target available"')
    expect(timelineForkDialog).toContain('description: "No user messages with text content are available to fork from."')
    expect(timelineForkDialog).toContain("if (option.disabled) return")
  })

  test("keeps the timeline dialog from rendering as a blank empty state", async () => {
    const timelineDialog = await fs.readFile(TIMELINE_DIALOG_SRC, "utf8")

    expect(timelineDialog).toContain('title: "No timeline message available"')
    expect(timelineDialog).toContain('description: "No user messages with text content are available in this session."')
    expect(timelineDialog).toContain("disabled: true")
    expect(timelineDialog).toContain("if (option.disabled) return")
  })

  test("handles session list deletion failures without leaking unhandled rejections", async () => {
    const sessionListDialog = await fs.readFile(SESSION_LIST_DIALOG_SRC, "utf8")

    expect(sessionListDialog).toContain(".catch(() => false)")
    expect(sessionListDialog).toContain('message: "Failed to delete session"')
    expect(sessionListDialog).toContain('sync.data.session.filter((session) => session.id !== option.value)')
  })

  test("handles workspace deletion failures without treating transport errors as success", async () => {
    const workspaceListDialog = await fs.readFile(WORKSPACE_LIST_DIALOG_SRC, "utf8")

    expect(workspaceListDialog).toContain(".then((result) => !result.error)")
    expect(workspaceListDialog).toContain(".catch(() => false)")
    expect(workspaceListDialog).toContain('message: "Failed to delete workspace"')
  })

  test("handles workspace open and create failures without leaking unhandled rejections", async () => {
    const workspaceListDialog = await fs.readFile(WORKSPACE_LIST_DIALOG_SRC, "utf8")

    expect(workspaceListDialog).toContain("await client.session.list({ roots: true, limit: 1 }).catch(() => undefined)")
    expect(workspaceListDialog).toContain("if (!input.forceCreate && !listed) {")
    expect(workspaceListDialog).toContain('message: "Failed to open workspace"')
    expect(workspaceListDialog).toContain("await sync.workspace.sync()")
    expect(workspaceListDialog).toContain("await props.onSelect(workspace.directory)")
    expect(workspaceListDialog).toContain('message: error instanceof Error ? error.message : "Failed to open workspace"')
  })

  test("handles session summarize failures without leaking unhandled rejections", async () => {
    const displayCommands = await fs.readFile(DISPLAY_COMMANDS_SRC, "utf8")

    expect(displayCommands).toContain("void Promise.resolve()")
    expect(displayCommands).toContain("input.sdk.client.session.summarize({")
    expect(displayCommands).toContain('message: error instanceof Error ? error.message : "Failed to summarize session"')
    expect(displayCommands).toContain('message: "Connect a provider to summarize this session"')
    expect(displayCommands).toContain("dialog.clear()")
  })

  test("closes transcript copy and export commands when the session is no longer available", async () => {
    const displayCommands = await fs.readFile(DISPLAY_COMMANDS_SRC, "utf8")

    expect(displayCommands).toContain('input.toast.show({ message: "Session is no longer available", variant: "warning" })')
    expect(displayCommands).toContain("if (!data) {")
    expect(displayCommands).toContain("dialog.clear()")
  })

  test("closes jump-to-last-user after moving the session view", async () => {
    const displayCommands = await fs.readFile(DISPLAY_COMMANDS_SRC, "utf8")

    expect(displayCommands).toContain('value: "session.messages_last_user"')
    expect(displayCommands).toContain("input.jumpToLastUser()")
    expect(displayCommands).toContain("dialog.clear()")
  })

  test("handles undo and redo session revert failures without leaking stale prompt state", async () => {
    const session = await fs.readFile(SESSION_ROUTE_SRC, "utf8")

    expect(session).toContain("enabled: !!undoMessageID(messages(), session()?.revert?.messageID),")
    expect(session).toContain('log.warn("session undo failed"')
    expect(session).toContain('log.warn("session redo failed"')
    expect(session).toContain('message: error instanceof Error ? error.message : "Failed to undo previous message"')
    expect(session).toContain('message: error instanceof Error ? error.message : "Failed to redo the previous message"')
    expect(session).toContain("prompt.set(promptState(sync.data.part[messageID] ?? []))")
    expect(session).toContain("if (!messageID) {")
    expect(session).toContain("dialog.clear()")
  })

  test("disposes the session reconnect recovery gate on route cleanup", async () => {
    const session = await fs.readFile(SESSION_ROUTE_SRC, "utf8")

    expect(session).toContain("const reconnectSession = createReconnectRecoveryGate(")
    expect(session).toContain("onCleanup(() => reconnectSession.dispose())")
  })

  test("keeps startup routing scoped to session-list readiness instead of full sync completion", async () => {
    const app = await fs.readFile(APP_SRC, "utf8")
    const sync = await fs.readFile(SYNC_SRC, "utf8")

    expect(sync).toContain("session_loaded")
    expect(app).toContain("sync.data.session_loaded")
    expect(app).not.toContain('sync.status === "loading"')
    expect(app).not.toContain('sync.status !== "complete"')
    expect(app).not.toContain('sync.status === "complete" &&')
  })

  test("defers lower-priority sync hydration out of the initial bootstrap burst", async () => {
    const requests = await fs.readFile(SYNC_BOOTSTRAP_REQUEST_SRC, "utf8")
    const plan = await fs.readFile(SYNC_BOOTSTRAP_PLAN_SRC, "utf8")
    const phasePlan = await fs.readFile(SYNC_BOOTSTRAP_PHASE_PLAN_SRC, "utf8")
    const coreStart = plan.indexOf("export function createCoreBootstrapPhaseTasks")
    const deferredStart = plan.indexOf("export function createDeferredBootstrapPhaseTasks")
    const coreBlock = coreStart >= 0 && deferredStart > coreStart ? plan.slice(coreStart, deferredStart) : ""
    const deferredBlock = deferredStart >= 0 ? plan.slice(deferredStart) : ""

    expect(requests).toContain('"tui bootstrap debug-engine"')
    expect(requests).toContain('"tui bootstrap worktree.list"')
    expect(requests).toContain('"tui bootstrap mcp.status"')
    expect(coreBlock).not.toContain("input.lspPromise")
    expect(coreBlock).not.toContain("input.mcpPromise")
    expect(coreBlock).not.toContain("input.resourcePromise")
    expect(coreBlock).not.toContain("input.formatterPromise")
    expect(coreBlock).not.toContain("input.workspacesTask")
    expect(coreBlock).not.toContain("input.debugEngineTask")
    expect(deferredBlock).toContain("input.lspPromise")
    expect(deferredBlock).toContain("input.mcpPromise")
    expect(deferredBlock).toContain("input.resourcePromise")
    expect(deferredBlock).toContain("input.formatterPromise")
    expect(deferredBlock).toContain("input.workspacesTask")
    expect(deferredBlock).toContain("input.debugEngineTask")
    expect(phasePlan).toContain('input.setStatus("complete")')
  })

  test("does not gate context providers on a generic ready flag", async () => {
    const helper = await fs.readFile(HELPER_SRC, "utf8")

    expect(helper).not.toContain("<Show")
    expect(helper).not.toContain("init.ready")
  })

  test("defers startup-adjacent filesystem hydration off async onMount handlers", async () => {
    for (const file of DEFERRED_STARTUP_SRCS) {
      const text = await fs.readFile(file, "utf8")

      expect(text).not.toContain("onMount(async")
      expect(text).toContain("scheduleDeferredStartupTask")
    }
  })

  test("keeps the session sidebar timer fan-out bounded", async () => {
    const sidebar = await fs.readFile(SIDEBAR_SRC, "utf8")
    const matches = sidebar.match(/setInterval\(/g) ?? []

    expect(matches.length).toBeLessThanOrEqual(2)
  })

  test("keeps the theme dialog reactive while custom themes hydrate", async () => {
    const dialog = await fs.readFile(THEME_DIALOG_SRC, "utf8")

    expect(dialog).toContain("createMemo")
    expect(dialog).toContain("ensureCustomThemesLoaded")
  })

  test("avoids async onMount in the provider oauth dialog flow", async () => {
    const dialogProvider = await fs.readFile(DIALOG_PROVIDER_SRC, "utf8")

    expect(dialogProvider).not.toContain("onMount(async")
    expect(dialogProvider).toContain("let cancelled = false")
  })

  test("handles provider dialog async actions without leaking unhandled rejections", async () => {
    const dialogProvider = await fs.readFile(DIALOG_PROVIDER_SRC, "utf8")

    expect(dialogProvider).toContain("function runProviderDialogAction(")
    expect(dialogProvider).toContain("void Promise.resolve()")
    expect(dialogProvider).toContain('log.warn("provider dialog action failed"')
    expect(dialogProvider).toContain('action: "select-provider"')
    expect(dialogProvider).toContain('fallbackMessage: "Failed to complete provider authorization"')
    expect(dialogProvider).toContain('fallbackMessage: "Failed to connect provider"')
  })

  test("waits for provider and model readiness before home prompt auto-submit", async () => {
    const home = await fs.readFile(HOME_SRC, "utf8")

    expect(home).toContain("sync.data.provider_loaded")
    expect(home).toContain("local.model.current()")
    expect(home).not.toContain("sync.ready && local.model.ready")
  })

  test("keeps autocomplete free of interval polling for prompt anchor tracking", async () => {
    const autocomplete = await fs.readFile(AUTOCOMPLETE_SRC, "utf8")

    expect(autocomplete).toContain("scheduleMicrotaskTask")
    expect(autocomplete).not.toContain("setInterval(")
  })

  test("keeps dialog selection post-update work on cancellable microtasks", async () => {
    const dialogSelect = await fs.readFile(DIALOG_SELECT_SRC, "utf8")

    expect(dialogSelect).toContain("scheduleMicrotaskTask")
    expect(dialogSelect).toContain("function runDialogSelectAction(")
    expect(dialogSelect).toContain('"dialog select action failed"')
    expect(dialogSelect).toContain('"dialog select keybind failed"')
    expect(dialogSelect).toContain('"Failed to complete the selected action"')
    expect(dialogSelect).toContain("void Promise.resolve()")
    expect(dialogSelect).not.toContain("setTimeout(")
  })

  test("keeps dialog focus handoff work on cancellable microtasks", async () => {
    for (const file of [DIALOG_SRC, DIALOG_PROMPT_SRC, DIALOG_EXPORT_OPTIONS_SRC]) {
      const text = await fs.readFile(file, "utf8")

      expect(text).toContain("scheduleMicrotaskTask")
      expect(text).not.toContain("setTimeout(")
    }
  })

  test("handles dialog prompt async confirms without leaking unhandled rejections", async () => {
    const dialogPrompt = await fs.readFile(DIALOG_PROMPT_SRC, "utf8")

    expect(dialogPrompt).toContain("function runDialogPromptAction(")
    expect(dialogPrompt).toContain('log.warn("dialog prompt confirm failed"')
    expect(dialogPrompt).toContain("void Promise.resolve()")
  })

  test("keeps doctor checking the OpenTUI preload dependency with bundled-runtime awareness", async () => {
    const doctor = await fs.readFile(DOCTOR_PRELOAD_SRC, "utf8")

    expect(doctor).toContain("Bun.resolveSync")
    expect(doctor).toContain('"@opentui/solid/preload"')
    expect(doctor).toContain("Bundled runtime")
    expect(doctor).toContain("source/dev TUI may fail to start")
  })

  test("keeps startup tracing wired around the first render and bootstrap phases", async () => {
    const startupTrace = await fs.readFile(STARTUP_TRACE_SRC, "utf8")
    const app = await fs.readFile(APP_SRC, "utf8")
    const sync = await fs.readFile(SYNC_SRC, "utf8")
    const bootstrapFlow = await fs.readFile(SYNC_BOOTSTRAP_FLOW_SRC, "utf8")
    const bootstrapPhasePlan = await fs.readFile(SYNC_BOOTSTRAP_PHASE_PLAN_SRC, "utf8")
    const bootstrapRunner = await fs.readFile(SYNC_BOOTSTRAP_RUNNER_SRC, "utf8")
    const home = await fs.readFile(HOME_SRC, "utf8")
    const session = await fs.readFile(SESSION_ROUTE_SRC, "utf8")

    expect(startupTrace).toContain("beginTuiStartup")
    expect(startupTrace).toContain("createTuiStartupSpan")
    expect(startupTrace).toContain("elapsedMs")
    expect(app).toContain("beginTuiStartup")
    expect(app).toContain("tui.startup.renderDispatched")
    expect(app).toContain('createTuiStartupSpan("tui.startup.sessionRouteImport"')
    expect(sync).toContain("createSpan: createTuiStartupSpan")
    expect(sync).toContain("recordStartup: recordTuiStartupOnce")
    expect(bootstrapRunner).toContain('input.createSpan("tui.startup.bootstrap")')
    expect(bootstrapRunner).toContain('createNamedSpan("tui.startup.bootstrapCore")')
    expect(bootstrapRunner).toContain('createNamedSpan("tui.startup.bootstrapDeferred")')
    expect(bootstrapFlow).toContain('input.recordStartup("tui.startup.sessionListReady")')
    expect(bootstrapPhasePlan).toContain('input.recordStartup("tui.startup.bootstrapDeferredReady"')
    expect(home).toContain('recordTuiStartupOnce("tui.startup.homeMounted"')
    expect(home).toContain('recordTuiStartupOnce("tui.startup.homePromptReady"')
    expect(session).toContain('recordTuiStartupOnce("tui.startup.sessionMounted"')
  })
})
