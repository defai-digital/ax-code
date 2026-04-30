import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"

const TUI_ROOT = path.resolve(import.meta.dir, "../../../src/cli/cmd/tui")
const UI_ROOT = path.resolve(import.meta.dir, "../../../../ui/src")
const APP_SRC = path.join(TUI_ROOT, "app.tsx")
const EVENT_SRC = path.join(TUI_ROOT, "event.ts")
const HELPER_SRC = path.join(TUI_ROOT, "context/helper.tsx")
const RENDERER_SRC = path.join(TUI_ROOT, "renderer.ts")
const THREAD_SRC = path.join(TUI_ROOT, "thread.ts")
const WORKER_SRC = path.join(TUI_ROOT, "worker.ts")
const SESSION_ROUTE_SRC = path.join(TUI_ROOT, "routes/session/index.tsx")
const PERMISSION_PROMPT_SRC = path.join(TUI_ROOT, "routes/session/permission.tsx")
const QUESTION_PROMPT_SRC = path.join(TUI_ROOT, "routes/session/question.tsx")
const DIALOG_MESSAGE_SRC = path.join(TUI_ROOT, "routes/session/dialog-message.tsx")
const DISPLAY_COMMANDS_SRC = path.join(TUI_ROOT, "routes/session/display-commands.ts")
const TIMELINE_FORK_DIALOG_SRC = path.join(TUI_ROOT, "routes/session/dialog-fork-from-timeline.tsx")
const TIMELINE_DIALOG_SRC = path.join(TUI_ROOT, "routes/session/dialog-timeline.tsx")
const SIDEBAR_SRC = path.join(TUI_ROOT, "routes/session/sidebar.tsx")
const SESSION_COMPARE_SRC = path.join(TUI_ROOT, "routes/session/compare.ts")
const SESSION_DRE_SRC = path.join(TUI_ROOT, "routes/session/dre.ts")
const SESSION_ROLLBACK_SRC = path.join(TUI_ROOT, "routes/session/rollback.ts")
const FOOTER_VIEW_MODEL_SRC = path.join(TUI_ROOT, "routes/session/footer-view-model.ts")
const SESSION_LIST_DIALOG_SRC = path.join(TUI_ROOT, "component/dialog-session-list.tsx")
const WORKSPACE_SESSION_LIST_DIALOG_SRC = path.join(TUI_ROOT, "component/workspace/dialog-session-list.tsx")
const SESSION_RENAME_DIALOG_SRC = path.join(TUI_ROOT, "component/dialog-session-rename.tsx")
const SPINNER_SRC = path.join(TUI_ROOT, "component/spinner.tsx")
const SPINNER_PROFILE_SRC = path.join(TUI_ROOT, "component/spinner-profile.ts")
const WORKSPACE_LIST_DIALOG_SRC = path.join(TUI_ROOT, "component/dialog-workspace-list.tsx")
const DIALOG_COMMAND_SRC = path.join(TUI_ROOT, "component/dialog-command.tsx")
const THEME_DIALOG_SRC = path.join(TUI_ROOT, "component/dialog-theme-list.tsx")
const DIALOG_PROVIDER_SRC = path.join(TUI_ROOT, "component/dialog-provider.tsx")
const PROMPT_SRC = path.join(TUI_ROOT, "component/prompt/index.tsx")
const AUTOCOMPLETE_SRC = path.join(TUI_ROOT, "component/prompt/autocomplete.tsx")
const PROMPT_HISTORY_SRC = path.join(TUI_ROOT, "component/prompt/history.tsx")
const PROMPT_FRECENCY_SRC = path.join(TUI_ROOT, "component/prompt/frecency.tsx")
const PROMPT_STASH_SRC = path.join(TUI_ROOT, "component/prompt/stash.tsx")
const DIALOG_SELECT_SRC = path.join(TUI_ROOT, "ui/dialog-select.tsx")
const DIALOG_SRC = path.join(TUI_ROOT, "ui/dialog.tsx")
const DIALOG_PROMPT_SRC = path.join(TUI_ROOT, "ui/dialog-prompt.tsx")
const DIALOG_CONFIRM_SRC = path.join(TUI_ROOT, "ui/dialog-confirm.tsx")
const DIALOG_EXPORT_OPTIONS_SRC = path.join(TUI_ROOT, "ui/dialog-export-options.tsx")
const DIALOG_HELP_SRC = path.join(TUI_ROOT, "ui/dialog-help.tsx")
const TOAST_SRC = path.join(TUI_ROOT, "ui/toast.tsx")
const LINK_SRC = path.join(TUI_ROOT, "ui/link.tsx")
const CLIPBOARD_SRC = path.join(TUI_ROOT, "util/clipboard.ts")
const LOCAL_SRC = path.join(TUI_ROOT, "context/local.tsx")
const ROUTE_SRC = path.join(TUI_ROOT, "context/route.tsx")
const EXIT_CONTEXT_SRC = path.join(TUI_ROOT, "context/exit.tsx")
const SYNC_SRC = path.join(TUI_ROOT, "context/sync.tsx")
const THEME_SRC = path.join(TUI_ROOT, "context/theme.tsx")
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
const DEBUG_EXPLAIN_SRC = path.resolve(import.meta.dir, "../../../src/cli/cmd/debug/explain.ts")
const RESIZE_HANDLE_SRC = path.join(UI_ROOT, "components/layout/resize-handle.tsx")
const TEXT_FIELD_SRC = path.join(UI_ROOT, "components/text-field.tsx")
const SESSION_TURN_SRC = path.join(UI_ROOT, "components/session-turn.tsx")
const FILE_SSR_SRC = path.join(UI_ROOT, "components/file-ssr.tsx")

describe("tui OpenTUI stability guardrails", () => {
  test("keeps OpenTUI wired as the default renderer path", async () => {
    const app = await fs.readFile(APP_SRC, "utf8")
    const renderer = await fs.readFile(RENDERER_SRC, "utf8")

    expect(app).toContain('from "./renderer"')
    expect(app).toContain("getTuiRenderProfile")
    expect(app).not.toMatch(/runNativeTuiSlice|AX_CODE_TUI_NATIVE/i)
    expect(renderer).toContain('from "@opentui/solid"')
    expect(renderer).toContain("render(root, createTuiRenderOptions(options))")
  })

  test("keeps renderer startup configured for terminal stability", async () => {
    const renderer = await fs.readFile(RENDERER_SRC, "utf8")

    expect(renderer).toContain("resolveTuiRenderProfile")
    expect(renderer).toContain("createTuiRenderOptionsFromProfile")
    expect(renderer).toContain("targetFps: 60")
    expect(renderer).toContain("exitOnCtrlC: false")
    expect(renderer).toContain("testing: false")
    expect(renderer).toContain("useThread: advancedTerminal")
    expect(renderer).toContain('screenMode: advancedTerminal ? "alternate-screen" : "main-screen"')
    expect(renderer).toContain("allowTerminalTitle: advancedTerminal && !terminalTitleDisabled")
    expect(renderer).toContain("autoFocus: false")
    expect(renderer).toContain("openConsoleOnError: false")
    expect(renderer).toContain("useMouse: true")
    expect(renderer).toContain("useKittyKeyboard: advancedTerminal")
    expect(renderer).toContain("useKittyKeyboard: profile.useKittyKeyboard ? {} : null")
  })

  test("keeps passthrough external output enabled in the app runtime", async () => {
    const app = await fs.readFile(APP_SRC, "utf8")

    expect(app).toContain('renderer.externalOutputMode = "passthrough"')
  })

  test("does not block first paint on a pre-render terminal color probe", async () => {
    const app = await fs.readFile(APP_SRC, "utf8")

    expect(app).not.toContain("getTerminalBackgroundColor")
  })

  test("does not probe the terminal palette unless the system theme is active", async () => {
    const theme = await fs.readFile(THEME_SRC, "utf8")

    expect(theme).toContain("() => store.active")
    expect(theme).toContain('if (active !== "system") return')
    expect(theme).toContain("if (!Flag.AX_CODE_TUI_ADVANCED_TERMINAL)")
    expect(theme).toContain("scheduleDeferredStartupTask(() => resolveSystemTheme(store.mode)")
    expect(theme).not.toContain("onMount(() => {\n      resolveSystemTheme(store.mode)")
  })

  test("keeps terminal title writes behind the advanced terminal profile", async () => {
    const app = await fs.readFile(APP_SRC, "utf8")
    const exitContext = await fs.readFile(EXIT_CONTEXT_SRC, "utf8")
    const renderer = await fs.readFile(RENDERER_SRC, "utf8")

    expect(renderer).toContain("allowTerminalTitle")
    expect(renderer).toContain("setTuiTerminalTitle")
    expect(renderer).toContain("clearTuiTerminalTitle")
    expect(app).toContain("setTuiTerminalTitle")
    expect(app).toContain("clearTuiTerminalTitle")
    expect(exitContext).toContain("clearTuiTerminalTitle(renderer)")
  })

  test("does not eagerly import the heavy session route on app startup", async () => {
    const app = await fs.readFile(APP_SRC, "utf8")

    expect(app).not.toContain('import { Session } from "@tui/routes/session"')
    expect(app).toContain('import("@tui/routes/session")')
    expect(app).toContain("ensureSessionRouteLoaded")
  })

  test("recovers from lazy session route load failures instead of hanging on the loading fallback", async () => {
    const app = await fs.readFile(APP_SRC, "utf8")

    expect(app).toContain("handleSessionRouteLoadFailure")
    expect(app).toContain('ensureSessionRouteLoaded("route").catch((error) => {')
    expect(app).toContain('ensureSessionRouteLoaded("startup-preload")')
    expect(app).toContain('message: "Failed to load session view"')
    expect(app).toContain('route.navigate({ type: "home" })')
  })

  test("avoids async createEffect in the session startup path", async () => {
    const session = await fs.readFile(SESSION_ROUTE_SRC, "utf8")

    expect(session).not.toContain("createEffect(async")
    expect(session).toContain("runInitialSessionSync")
    expect(session).toContain('sync(sessionID, { missing: "throw" })')
    expect(session).toContain("createSessionEntrySyncRetryState")
    expect(session).toContain("nextSessionEntrySyncRetry")
    expect(session).toContain("toBottom()")
    expect(session).not.toContain("scroll.scrollBy(100_000)")
    expect(session).not.toContain("MAX_SESSION_ENTRY_SYNC_ATTEMPTS")
  })

  test("handles delegated task preview session sync failures without unhandled rejections", async () => {
    const session = await fs.readFile(SESSION_ROUTE_SRC, "utf8")

    expect(session).toContain("void sync.session.sync(id).catch((error) => {")
    expect(session).toContain('log.warn("task child session preview sync failed"')
  })

  test("handles question prompt replies and rejects without leaking unhandled failures", async () => {
    const question = await fs.readFile(QUESTION_PROMPT_SRC, "utf8")

    expect(question).toContain("function submitQuestionRequest(")
    expect(question).toContain("void Promise.resolve()")
    expect(question).toContain("log.warn(failureLabel, { error, requestID: props.request.id })")
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
    expect(permission).toContain("log.warn(failureLabel, { error, requestID: props.request.id })")
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
    expect(timelineForkDialog).toContain(
      'description: "No user messages with text content are available to fork from."',
    )
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
    expect(sessionListDialog).toContain("sync.data.session.filter((session) => session.id !== option.value)")
  })

  test("keeps session list dialogs resilient when listing or search requests fail", async () => {
    const sessionListDialog = await fs.readFile(SESSION_LIST_DIALOG_SRC, "utf8")
    const workspaceSessionListDialog = await fs.readFile(WORKSPACE_SESSION_LIST_DIALOG_SRC, "utf8")

    expect(sessionListDialog).toContain('log.warn("session list search failed"')
    expect(sessionListDialog).toContain('message: error instanceof Error ? error.message : "Failed to search sessions"')
    expect(sessionListDialog).toContain("return info.value")

    expect(workspaceSessionListDialog).toContain('log.warn("workspace session list load failed"')
    expect(workspaceSessionListDialog).toContain('log.warn("workspace session list search failed"')
    expect(workspaceSessionListDialog).toContain(
      'message: error instanceof Error ? error.message : "Failed to load workspace sessions"',
    )
    expect(workspaceSessionListDialog).toContain(
      'message: error instanceof Error ? error.message : "Failed to search sessions"',
    )
    expect(workspaceSessionListDialog).toContain("return info.value")
  })

  test("waits for session rename updates before clearing the dialog", async () => {
    const sessionRenameDialog = await fs.readFile(SESSION_RENAME_DIALOG_SRC, "utf8")

    expect(sessionRenameDialog).toContain("onConfirm={async (value) => {")
    expect(sessionRenameDialog).toContain("await sdk.client.session.update({")
    expect(sessionRenameDialog).toContain("dialog.clear()")
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
    expect(workspaceListDialog).toContain("listed = await client.session.list({ roots: true, limit: 1 })")
    expect(workspaceListDialog).toContain(
      'message: error instanceof Error ? error.message : "Failed to open workspace"',
    )
    expect(workspaceListDialog).toContain("await sync.workspace.sync()")
    expect(workspaceListDialog).toContain("await props.onSelect(workspace.directory)")
  })

  test("handles session summarize failures without leaking unhandled rejections", async () => {
    const displayCommands = await fs.readFile(DISPLAY_COMMANDS_SRC, "utf8")

    expect(displayCommands).toContain("void Promise.resolve()")
    expect(displayCommands).toContain("input.sdk.client.session.summarize({")
    expect(displayCommands).toContain('message: error instanceof Error ? error.message : "Failed to summarize session"')
    expect(displayCommands).toContain('message: "Connect a provider to summarize this session"')
    expect(displayCommands).toContain("dialog.clear()")
  })

  test("renderDialogLoading returns a thunk so dialog.replace defers construction into the DialogProvider scope (gh#193)", async () => {
    const dialogLoading = await fs.readFile(path.join(TUI_ROOT, "ui/dialog-loading.tsx"), "utf8")

    expect(dialogLoading).toContain("export function renderDialogLoading(props: DialogLoadingProps): () => JSX.Element")
    expect(dialogLoading).toContain("return () => <DialogLoading {...props} />")
  })

  test("handles session share, DRE web, and unshare command failures without leaving stale dialogs behind", async () => {
    const displayCommands = await fs.readFile(DISPLAY_COMMANDS_SRC, "utf8")
    const session = await fs.readFile(SESSION_ROUTE_SRC, "utf8")

    expect(displayCommands).toContain('value: "session.share"')
    expect(displayCommands).toContain('title: "Share session"')
    expect(displayCommands).toContain('message: "Creating share URL..."')
    expect(displayCommands).toContain('throw new Error("Share endpoint returned no URL")')
    expect(displayCommands).toContain('message: error instanceof Error ? error.message : "Failed to share session"')
    expect(displayCommands).toContain(".then(() => dialog.clear())")
    expect(displayCommands).toContain("dialog.clear()")

    expect(displayCommands).toContain('value: "session.dre.web"')
    expect(displayCommands).toContain('message: "Failed to open DRE graph in the browser"')
    expect(displayCommands).toContain(".finally(() => dialog.clear())")

    expect(session).toContain('value: "session.unshare"')
    expect(session).toContain('message: "Session unshared successfully"')
    expect(session).toContain('message: error instanceof Error ? error.message : "Failed to unshare session"')
    expect(session).toContain("dialog.clear()")
  })

  test("closes transcript copy and export commands when the session is no longer available", async () => {
    const displayCommands = await fs.readFile(DISPLAY_COMMANDS_SRC, "utf8")

    expect(displayCommands).toContain(
      'input.toast.show({ message: "Session is no longer available", variant: "warning" })',
    )
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
    // Source can be reformatted by prettier (e.g. `message:` line-broken
    // from its value), so collapse whitespace before substring assertions.
    const collapsed = session.replace(/\s+/g, " ")

    expect(collapsed).toContain("enabled: !!undoMessageID(messages(), session()?.revert?.messageID),")
    expect(collapsed).toContain('log.warn("session rollback abort failed"')
    expect(collapsed).toContain(
      'message: error instanceof Error ? error.message : "Failed to stop the running session before rollback"',
    )
    expect(collapsed).toContain('log.warn("session undo abort failed"')
    expect(collapsed).toContain(
      'message: error instanceof Error ? error.message : "Failed to stop the running session before undo"',
    )
    expect(collapsed).toContain('log.warn("session undo failed"')
    expect(collapsed).toContain('log.warn("session redo failed"')
    expect(collapsed).toContain('message: error instanceof Error ? error.message : "Failed to undo previous message"')
    expect(collapsed).toContain(
      'message: error instanceof Error ? error.message : "Failed to redo the previous message"',
    )
    expect(collapsed).toContain("prompt.set(promptState(sync.data.part[messageID] ?? []))")
    expect(collapsed).toContain("if (!messageID) {")
    expect(collapsed).toContain("dialog.clear()")
  })

  test("disposes the session reconnect recovery gate on route cleanup", async () => {
    const session = await fs.readFile(SESSION_ROUTE_SRC, "utf8")

    expect(session).toContain("const reconnectSession = createReconnectRecoveryGate(")
    expect(session).toContain("onCleanup(() => reconnectSession.dispose())")
  })

  test("guards session route sync completions against stale route switches", async () => {
    const session = await fs.readFile(SESSION_ROUTE_SRC, "utf8")

    expect(session).toContain("let sessionSyncGeneration = 0")
    expect(session).toContain("const generation = ++sessionSyncGeneration")
    expect(session).toContain("if (generation !== sessionSyncGeneration) return")
    expect(session).toContain("sessionSyncGeneration++")
  })

  test("returns home and shows a toast when the current session is deleted", async () => {
    const app = await fs.readFile(APP_SRC, "utf8")

    expect(app).toContain("sdk.event.on(SessionApi.Event.Deleted.type")
    expect(app).toContain('if (route.data.type === "session" && route.data.sessionID === evt.properties.info.id)')
    expect(app).toContain('route.navigate({ type: "home" })')
    expect(app).toContain('message: "The current session was deleted"')
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

    expect(matches.length).toBe(1)
    expect(sidebar).toContain("5_000")
    expect(sidebar).not.toContain("1_000")
    expect(sidebar).not.toContain("clockId")
    expect(sidebar).not.toContain("clockTick")
    expect(sidebar).not.toContain("Elapsed")
    expect(sidebar).not.toContain("tokens")
    expect(sidebar).not.toContain("sidebar-eta")
    expect(sidebar).not.toContain("./usage")
  })

  test("surfaces concise session status in the sidebar title", async () => {
    const sidebar = await fs.readFile(SIDEBAR_SRC, "utf8")
    const footerViewModel = await fs.readFile(FOOTER_VIEW_MODEL_SRC, "utf8")

    expect(sidebar).toContain("sidebarSessionStatusView")
    expect(sidebar).toContain("titleStatus().label")
    expect(footerViewModel).toContain('"Thinking..."')
    expect(footerViewModel).toContain('"Processing..."')
    expect(footerViewModel).toContain('"Finished"')
    expect(footerViewModel).toContain('"Thinking stalled"')
    expect(footerViewModel).toContain('"Processing stalled"')
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

  test("refreshes provider-backed runtime state after connect and disconnect flows", async () => {
    const dialogProvider = await fs.readFile(DIALOG_PROVIDER_SRC, "utf8")

    expect(dialogProvider).toContain("await sdk.client.instance.dispose()")
    expect(dialogProvider).toContain("await sync.bootstrap()")
    expect(dialogProvider).toContain('toast.show({ variant: "success", message: `Disconnected ${provider.name}` })')
    expect(dialogProvider).toContain('toast.show({ variant: "success", message: `Connected ${provider.name}` })')
    expect(dialogProvider).toContain("dialog.replace(() => <DialogModel providerID={provider.id} />)")
    expect(dialogProvider).toContain("dialog.clear()")
  })

  test("keeps app-level lazy dialog loaders marker-guarded and user-visible on failure", async () => {
    const app = await fs.readFile(APP_SRC, "utf8")
    const prompt = await fs.readFile(PROMPT_SRC, "utf8")

    expect(app).toContain("const marker = dialog.stack.at(-1)")
    expect(app).toContain("if (dialog.stack.at(-1) !== marker) return")
    expect(app).toContain('toast.show({ message: "Failed to open provider dialog", variant: "error" })')
    expect(app).toContain('toast.show({ message: "Failed to open model dialog", variant: "error" })')
    expect(app).toContain('toast.show({ message: "Failed to open session list", variant: "error" })')
    expect(app).toContain('toast.show({ message: "Failed to open workspace list", variant: "error" })')
    expect(app).toContain('toast.show({ message: "Failed to open agent list", variant: "error" })')
    expect(app).toContain('toast.show({ message: "Failed to open MCP list", variant: "error" })')
    expect(app).toContain('toast.show({ message: "Failed to open status", variant: "error" })')
    expect(app).toContain('toast.show({ message: "Failed to open themes", variant: "error" })')
    expect(app).toContain('toast.show({ message: "Failed to open help", variant: "error" })')

    expect(prompt).toContain("if (dialog.stack.at(-1) !== marker) return")
    expect(prompt).toContain('toast.show({ message: "Failed to open provider dialog", variant: "error" })')
  })

  test("opens docs through a failure-safe app command", async () => {
    const app = await fs.readFile(APP_SRC, "utf8")

    expect(app).toContain('value: "docs.open"')
    expect(app).toContain('Log.Default.warn("failed to open docs", { error })')
    expect(app).toContain('message: error instanceof Error ? error.message : "Failed to open docs"')
    expect(app).toContain("dialog.clear()")
  })

  test("surfaces error-boundary issue URL copy failures instead of silently rejecting", async () => {
    const app = await fs.readFile(APP_SRC, "utf8")

    expect(app).toContain("const [copyError, setCopyError] = createSignal<string | undefined>()")
    expect(app).toContain("void Clipboard.copy(issueURL.toString())")
    expect(app).toContain('setCopyError(error instanceof Error ? error.message : "Failed to copy issue URL")')
    expect(app).toContain("{copyError() && <text fg={colors.muted}>{copyError()}</text>}")
  })

  test("keeps startup and continue fork retries bounded, gated, and cancellable", async () => {
    const app = await fs.readFile(APP_SRC, "utf8")

    expect(app).toContain("const RETRY_DELAY_MS = 250")
    expect(app).toContain("const MAX_SESSION_FORK_ATTEMPTS = 3")
    expect(app).toContain("const retryTimers = new Set<ReturnType<typeof setTimeout>>()")
    expect(app).toContain("let forkRetryDisposed = false")
    expect(app).toContain("for (const timer of retryTimers) clearTimeout(timer)")
    expect(app).toContain("retryTimers.clear()")
    expect(app).toContain("retryTimers.delete(timer)")
    expect(app).toContain("if (forkRetryDisposed) return")
    expect(app).toContain('toast.show({ message: "Failed to fork session", variant: "error" })')
    expect(app).toContain("if (continued || !sync.data.session_loaded || !args.continue) return")
    expect(app).toContain(
      "if (startupForkStarted || !sync.data.session_loaded || !args.sessionID || !args.fork) return",
    )
    expect(app).toContain('forkSessionWithRetries({ sessionID: match, source: "continue" })')
    expect(app).toContain('forkSessionWithRetries({ sessionID: args.sessionID, source: "startup" })')
  })

  test("handles command dispatch async actions without leaking unhandled rejections", async () => {
    const dialogCommand = await fs.readFile(DIALOG_COMMAND_SRC, "utf8")

    expect(dialogCommand).toContain("function runCommandAction(")
    expect(dialogCommand).toContain('log.warn("command action failed"')
    expect(dialogCommand).toContain('runCommandAction(option, "keybind")')
    expect(dialogCommand).toContain('runCommandAction(option, "trigger")')
    expect(dialogCommand).toContain('runCommandAction(option, "slash")')
    expect(dialogCommand).toContain("void Promise.resolve()")
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

  test("handles prompt session interrupts without leaking unhandled rejections", async () => {
    const prompt = await fs.readFile(PROMPT_SRC, "utf8")

    expect(prompt).toContain('log.warn("prompt session interrupt failed"')
    expect(prompt).toContain('message: error instanceof Error ? error.message : "Failed to interrupt session"')
    expect(prompt).toContain("void sdk.client.session")
    expect(prompt).toContain(".abort({")
    expect(prompt).toContain(".catch((error) => {")
  })

  test("keeps pending prompt submission cancellable with explicit stage state", async () => {
    const prompt = await fs.readFile(PROMPT_SRC, "utf8")

    expect(prompt).toContain("pendingSubmitKeyIntent")
    expect(prompt).toContain("cancelPendingSubmit")
    expect(prompt).toContain("new AbortController()")
    expect(prompt).toContain("let submitInFlight = false")
    expect(prompt).toContain("if (startingNewSession) sessionID = SessionID.descending()")
    expect(prompt).toContain("setSubmitPending(true)")
    expect(prompt).toContain('setSubmitStage("dispatching")')
    expect(prompt).toContain("pending: submitPending() || submitInFlight")
    expect(prompt).toContain("useTextareaKeybindings({ submit: false, interceptEnter: true })")
    expect(prompt).toContain("function isPromptSubmitKey(event: KeyEvent)")
    expect(prompt).toContain('event.name === "return" || event.name === "linefeed"')
    expect(prompt).toContain("useKeyboard((evt) => {")
    expect(prompt).toContain("evt.stopPropagation()")
    expect(prompt).toContain("isPromptSubmitKey(e)")
    expect(prompt).toContain("void submit()")
    expect(prompt).not.toContain("onSubmit={submit}")
    expect(prompt).toContain("pendingSubmitStatusText(submitStage())")
  })

  test("routes autocomplete Enter before prompt submit while submit still prioritizes slash dispatch", async () => {
    const prompt = await fs.readFile(PROMPT_SRC, "utf8")
    const autocomplete = await fs.readFile(AUTOCOMPLETE_SRC, "utf8")

    const keyboardHandlerStart = prompt.indexOf("useKeyboard((evt) => {")
    const keyboardHandlerEnd = prompt.indexOf("const fileStyleId", keyboardHandlerStart)
    const keyboardHandler = prompt.slice(keyboardHandlerStart, keyboardHandlerEnd)
    expect(keyboardHandler).toContain("if (autocomplete?.visible) return")
    expect(autocomplete).toContain('if (name === "return" || name === "linefeed")')

    const submitStart = prompt.indexOf("async function submit()")
    const submitEnd = prompt.indexOf("const selectedModel", submitStart)
    const submitBody = prompt.slice(submitStart, submitEnd)
    const slashDispatch = submitBody.indexOf(
      'if (currentMode === "normal" && slashName && command.trySlash(slashName)) return',
    )
    const autocompleteReturn = submitBody.indexOf("if (autocomplete?.visible) return")

    expect(slashDispatch).toBeGreaterThan(-1)
    expect(autocompleteReturn).toBeGreaterThan(-1)
    expect(slashDispatch).toBeLessThan(autocompleteReturn)
  })

  test("keeps newly-created prompt sessions durable before the route handoff", async () => {
    const prompt = await fs.readFile(PROMPT_SRC, "utf8")

    expect(prompt).toContain("const startingNewSession = sessionID == null")
    expect(prompt).toContain("settlePromptLocally({ clearPrompt: !startingNewSession })")
    expect(prompt).toContain("function settlePromptLocally(options: { clearPrompt: boolean })")
    expect(prompt).toContain("finishPendingSubmit()")
    expect(prompt).toContain("routeToSession(sessionID)")
    expect(prompt).toContain("let routeHandoffTimer: ReturnType<typeof setTimeout> | undefined")
    expect(prompt).toContain("if (input && !input.isDestroyed) input.blur()")
    expect(prompt).toContain("routeHandoffTimer = setTimeout(() => {")
    expect(prompt).toContain("if (submitRunID !== runID) return")
    expect(prompt).toContain("sdk.client.session.create({ id: sessionID }")
    expect(prompt).toContain("upsertSessionInStore(createdSession)")
    expect(prompt).toContain('setSubmitStage("dispatching")')
    expect(prompt.indexOf("upsertSessionInStore(createdSession)")).toBeLessThan(
      prompt.lastIndexOf("routeToSession(sessionID)"),
    )
    expect(prompt.indexOf('path: "prompt_async"')).toBeLessThan(prompt.lastIndexOf("routeToSession(sessionID)"))
    expect(prompt).not.toContain("releaseSubmitAbort()")
    expect(prompt).not.toContain("await Promise.resolve()")
  })

  test("keeps animated spinners out of the compiled runtime render path", async () => {
    const prompt = await fs.readFile(PROMPT_SRC, "utf8")
    const spinner = await fs.readFile(SPINNER_SRC, "utf8")
    const profile = await fs.readFile(SPINNER_PROFILE_SRC, "utf8")

    expect(profile).toContain('runtimeMode()) !== "compiled"')
    expect(spinner).toContain("shouldUseTuiAnimations")
    expect(prompt).toContain("shouldUseTuiAnimations")
    expect(prompt).toContain("fallback={<text fg={theme.textMuted}>[⋯]</text>}")
  })

  test("keeps session route view namespaces distinct from core session namespaces", async () => {
    const session = await fs.readFile(SESSION_ROUTE_SRC, "utf8")
    const wrappers = [
      { src: SESSION_COMPARE_SRC, core: "SessionCompare", view: "SessionCompareView" },
      { src: SESSION_DRE_SRC, core: "SessionDre", view: "SessionDreView" },
      { src: SESSION_ROLLBACK_SRC, core: "SessionRollback", view: "SessionRollbackView" },
    ]

    expect(session).not.toContain("shouldRenderSessionSidebar")
    expect(session).not.toContain("sidebarRenderEnabled")

    for (const wrapper of wrappers) {
      const text = await fs.readFile(wrapper.src, "utf8")

      expect(text).toContain(`import { ${wrapper.core} as ${wrapper.core}Core }`)
      expect(text).toContain(`export namespace ${wrapper.view}`)
      expect(text).not.toContain(`export namespace ${wrapper.core} {`)
    }
  })

  test("handles pasted SVG and image read failures without silently falling back to raw paths", async () => {
    const prompt = await fs.readFile(PROMPT_SRC, "utf8")

    expect(prompt).toContain('log.warn("prompt svg paste read failed"')
    expect(prompt).toContain('message: error instanceof Error ? error.message : "Failed to read pasted SVG"')
    expect(prompt).toContain('log.warn("prompt image paste read failed"')
    expect(prompt).toContain('message: error instanceof Error ? error.message : "Failed to read pasted image"')
    expect(prompt).toContain("event.preventDefault()")
    expect(prompt).toContain("return undefined")
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
    expect(dialogPrompt).toContain("dialog.clear()")
  })

  test("handles dialog confirm async callbacks without leaking unhandled rejections", async () => {
    const dialogConfirm = await fs.readFile(DIALOG_CONFIRM_SRC, "utf8")

    expect(dialogConfirm).toContain("function runDialogConfirmAction(")
    expect(dialogConfirm).toContain('log.warn("dialog confirm action failed"')
    expect(dialogConfirm).toContain("void Promise.resolve()")
  })

  test("opens clicked tui links through a failure-safe browser launch path", async () => {
    const link = await fs.readFile(LINK_SRC, "utf8")

    expect(link).toContain('Log.Default.warn("link open failed"')
    expect(link).toContain('message: error instanceof Error ? error.message : "Failed to open link"')
    expect(link).toContain("void open(props.href).catch((error) => {")
  })

  test("keeps clipboard fallback writes from silently succeeding on failure or timeout", async () => {
    const clipboard = await fs.readFile(CLIPBOARD_SRC, "utf8")

    expect(clipboard).toContain('throw new Error("Timed out writing to clipboard")')
    expect(clipboard).toContain("input.then(")
    expect(clipboard).toContain('type: "error" as const')
    expect(clipboard).toContain("await waitForWrite(clipboardy.write(text))")
    expect(clipboard).not.toContain("await waitForWrite(clipboardy.write(text)).catch(() => {})")
  })

  test("clears console selections only after clipboard copy succeeds", async () => {
    const app = await fs.readFile(APP_SRC, "utf8")

    expect(app).toContain("renderer.console.onCopySelection = async (text: string) => {")
    expect(app).toContain(".then(() => {")
    expect(app).toContain('toast.show({ message: "Copied to clipboard", variant: "info" })')
    expect(app).toContain("renderer.clearSelection()")
  })

  test("keeps session and permission derived state in component-scoped memos", async () => {
    const session = await fs.readFile(SESSION_ROUTE_SRC, "utf8")
    const permission = await fs.readFile(PERMISSION_PROMPT_SRC, "utf8")

    expect(session).toContain("const subagentTasks = createMemo(() => {")
    expect(session).not.toContain("const tasks = createMemo(() => {")
    expect(permission).toContain("const permissionInfo = createMemo(() => {")
    expect(permission).not.toContain("const current = info()")
  })

  test("keeps prompt editing and navigation resilient across duplicate summaries and wide characters", async () => {
    const prompt = await fs.readFile(PROMPT_SRC, "utf8")
    const autocomplete = await fs.readFile(AUTOCOMPLETE_SRC, "utf8")
    const question = await fs.readFile(QUESTION_PROMPT_SRC, "utf8")

    expect(prompt).toContain("function stringIndexFromDisplayOffset(")
    expect(prompt).toContain("const text = expandPromptTextParts(store.prompt.input, store.prompt.parts)")
    expect(prompt).toContain("input.cursorOffset === Bun.stringWidth(input.plainText)")
    expect(prompt).toContain("input.cursorOffset = Bun.stringWidth(input.plainText)")
    expect(autocomplete).toContain("const rawPath = selected.path ?? selected.value ?? selected.display")
    expect(question).toContain("if (val.isDestroyed) return")
  })

  test("keeps dialogs, routes, and toasts following the guarded control flow", async () => {
    const dialogExport = await fs.readFile(DIALOG_EXPORT_OPTIONS_SRC, "utf8")
    const dialogHelp = await fs.readFile(DIALOG_HELP_SRC, "utf8")
    const route = await fs.readFile(ROUTE_SRC, "utf8")
    const toast = await fs.readFile(TOAST_SRC, "utf8")

    expect(dialogExport).toContain("dialog.clear()")
    expect(dialogHelp).not.toContain('evt.name === "return" || evt.name === "escape"')
    expect(route).toContain("function parseInitialRoute(")
    expect(toast).toContain("queue: [] as ToastOptions[]")
    expect(toast).toContain("function scheduleNextToast(options: ToastOptions)")
  })

  test("keeps UI copy, resize, and streaming indicators reading current runtime state", async () => {
    const resizeHandle = await fs.readFile(RESIZE_HANDLE_SRC, "utf8")
    const textField = await fs.readFile(TEXT_FIELD_SRC, "utf8")
    const sessionTurn = await fs.readFile(SESSION_TURN_SRC, "utf8")

    expect(resizeHandle).toContain("let activeCleanup: (() => void) | undefined")
    expect(resizeHandle).toContain("onCleanup(() => {")
    expect(textField).toContain('const node = inputWrapper?.querySelector("input, textarea")')
    expect(textField).toContain('const value = local.value ?? currentValue ?? local.defaultValue ?? ""')
    expect(sessionTurn).toContain("return assistantVisible() === 0")
  })

  test("keeps toast duration defaults and SSR line-selection retries under explicit caller control", async () => {
    const event = await fs.readFile(EVENT_SRC, "utf8")
    const fileSsr = await fs.readFile(FILE_SSR_SRC, "utf8")

    expect(event).toContain('duration: z.number().optional().describe("Duration in milliseconds")')
    expect(fileSsr).toContain("let selectedLinesFrame: number | undefined")
    expect(fileSsr).toContain("let selectedLinesVersion = 0")
    expect(fileSsr).toContain('const syncSelectedLines = (range: DiffFileProps<T>["selectedLines"]) => {')
    expect(fileSsr).toContain("clearSelectedLinesFrame()")
  })

  test("surfaces local model preference persistence failures instead of silently dropping them", async () => {
    const local = await fs.readFile(LOCAL_SRC, "utf8")

    expect(local).toContain('const log = Log.create({ service: "tui.local" })')
    expect(local).toContain('log.warn("failed to persist local model preferences"')
    expect(local).toContain("optionalStateErrorMessage")
    expect(local).toContain("shouldSurfaceOptionalStateError")
    expect(local).toContain("if (state.saveWarningShown) return")
    expect(local).toContain("state.saveWarningShown = false")
    expect(local).toContain('log.warn("failed to load local model preferences"')
    expect(local).toContain('"Failed to load model preferences"')
    expect(local).toContain('"code" in error && error.code === "ENOENT"')
  })

  test("surfaces prompt history persistence failures instead of silently dropping them", async () => {
    const history = await fs.readFile(PROMPT_HISTORY_SRC, "utf8")

    expect(history).toContain('const log = Log.create({ service: "tui.prompt-history" })')
    expect(history).toContain('log.warn("failed to load prompt history"')
    expect(history).toContain('log.warn("failed to persist prompt history"')
    expect(history).toContain('log.warn("failed to append prompt history"')
    expect(history).toContain("optionalStateErrorMessage")
    expect(history).toContain("shouldSurfaceOptionalStateError")
    expect(history).toContain('"Failed to load prompt history"')
    expect(history).toContain('"Failed to save prompt history"')
    expect(history).toContain('"code" in error && error.code === "ENOENT"')
    expect(history).toContain("if (writeWarningShown) return")
  })

  test("surfaces frecency persistence failures instead of silently dropping them", async () => {
    const frecency = await fs.readFile(PROMPT_FRECENCY_SRC, "utf8")

    expect(frecency).toContain('const log = Log.create({ service: "tui.frecency" })')
    expect(frecency).toContain('log.warn("failed to load frecency data"')
    expect(frecency).toContain('log.warn("failed to persist frecency data"')
    expect(frecency).toContain('log.warn("failed to append frecency data"')
    expect(frecency).toContain("optionalStateErrorMessage")
    expect(frecency).toContain("shouldSurfaceOptionalStateError")
    expect(frecency).toContain('"Failed to load file frecency"')
    expect(frecency).toContain('"Failed to save file frecency"')
    expect(frecency).toContain('"code" in error && error.code === "ENOENT"')
    expect(frecency).toContain("if (writeWarningShown) return")
  })

  test("surfaces prompt stash persistence failures instead of silently dropping them", async () => {
    const stash = await fs.readFile(PROMPT_STASH_SRC, "utf8")

    expect(stash).toContain('const log = Log.create({ service: "tui.prompt-stash" })')
    expect(stash).toContain('log.warn("failed to load prompt stash"')
    expect(stash).toContain('log.warn("prompt stash write failed"')
    expect(stash).toContain("optionalStateErrorMessage")
    expect(stash).toContain("shouldSurfaceOptionalStateError")
    expect(stash).toContain('"Failed to load prompt stash"')
    expect(stash).toContain('"Failed to save prompt stash"')
    expect(stash).toContain('"code" in error && error.code === "ENOENT"')
    expect(stash).toContain("if (writeWarningShown) return")
  })

  test("navigates new prompt sessions with a bounded route handoff", async () => {
    const prompt = await fs.readFile(PROMPT_SRC, "utf8")

    expect(prompt).toContain("upsertSessionInStore")
    expect(prompt).toContain("routeHandoffTimer = setTimeout(() => {")
    expect(prompt).toContain("if (routeHandoffTimer) clearTimeout(routeHandoffTimer)")
    expect(prompt).toContain('type: "session"')
    expect(prompt).not.toContain("temporary hack to make sure the message is sent")
    expect(prompt).not.toContain("navigationTimer = setTimeout")
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
    const thread = await fs.readFile(THREAD_SRC, "utf8")
    const sync = await fs.readFile(SYNC_SRC, "utf8")
    const bootstrapFlow = await fs.readFile(SYNC_BOOTSTRAP_FLOW_SRC, "utf8")
    const bootstrapPhasePlan = await fs.readFile(SYNC_BOOTSTRAP_PHASE_PLAN_SRC, "utf8")
    const bootstrapRunner = await fs.readFile(SYNC_BOOTSTRAP_RUNNER_SRC, "utf8")
    const home = await fs.readFile(HOME_SRC, "utf8")
    const session = await fs.readFile(SESSION_ROUTE_SRC, "utf8")

    expect(startupTrace).toContain("beginTuiStartup")
    expect(startupTrace).toContain("createTuiStartupSpan")
    expect(startupTrace).toContain("elapsedMs")
    expect(thread).toContain('DiagnosticLog.recordProcess("tui.threadStarted"')
    expect(thread).toContain('DiagnosticLog.recordProcess("tui.workerTargetResolved"')
    expect(thread).toContain('DiagnosticLog.recordProcess("tui.backendHandshakeStarted"')
    expect(thread).toContain('DiagnosticLog.recordProcess("tui.backendReady"')
    expect(thread).toContain('DiagnosticLog.recordProcess("tui.workerReady"')
    expect(thread).toContain('DiagnosticLog.recordProcess("tui.threadTransportSelected"')
    expect(thread).toContain('DiagnosticLog.recordProcess("tui.appImportStarted"')
    expect(thread).toContain('DiagnosticLog.recordProcess("tui.appImportReady"')
    expect(thread).toContain('DiagnosticLog.recordProcess("tui.appImportFailed"')
    expect(app).toContain("beginTuiStartup")
    expect(app).toContain('recordTuiStartupOnce("tui.startup.rendererProfile", renderProfile)')
    expect(app).toContain("tui.startup.renderDispatched")
    expect(app).toContain('createTuiStartupSpan("tui.startup.sessionRouteImport"')
    expect(sync).toContain("createSpan: createTuiStartupSpan")
    expect(sync).toContain("recordStartup: recordTuiStartupOnce")
    expect(sync).toContain("createRuntimeSyncProbeScheduler")
    expect(sync).toContain("scheduleRuntimeProbe: runtimeProbeScheduler.schedule")
    expect(bootstrapRunner).toContain('input.createSpan("tui.startup.bootstrap")')
    expect(bootstrapRunner).toContain('createNamedSpan("tui.startup.bootstrapCore")')
    expect(bootstrapRunner).toContain('createNamedSpan("tui.startup.bootstrapDeferred")')
    expect(bootstrapFlow).toContain('input.recordStartup("tui.startup.sessionListReady")')
    expect(bootstrapFlow).toContain("AX_CODE_TUI_DEFERRED_BOOTSTRAP_DELAY_MS")
    expect(bootstrapFlow).toContain("AX_CODE_TUI_DEFERRED_BOOTSTRAP_CONCURRENCY")
    expect(bootstrapPhasePlan).toContain('input.recordStartup("tui.startup.bootstrapDeferredReady"')
    expect(home).toContain('recordTuiStartupOnce("tui.startup.homeMounted"')
    expect(home).toContain('recordTuiStartupOnce("tui.startup.homePromptReady"')
    expect(session).toContain('recordTuiStartupOnce("tui.startup.sessionMounted"')
  })

  test("keeps the OpenTUI worker startup bounded with a readiness handshake", async () => {
    const thread = await fs.readFile(THREAD_SRC, "utf8")
    const worker = await fs.readFile(WORKER_SRC, "utf8")

    expect(thread).toContain("DEFAULT_TUI_WORKER_READY_TIMEOUT_MS = 10_000")
    expect(thread).toContain("DEFAULT_TUI_UPGRADE_CHECK_DELAY_MS = 30_000")
    expect(thread).toContain("DEFAULT_TUI_BACKEND_SHUTDOWN_TIMEOUT_MS = 5_000")
    expect(thread).toContain("DEFAULT_TUI_BACKEND_TERMINATE_GRACE_MS = 1_000")
    expect(thread).toContain("AX_CODE_TUI_WORKER_READY_TIMEOUT_MS")
    expect(thread).toContain("AX_CODE_TUI_UPGRADE_CHECK_DELAY_MS")
    expect(thread).toContain("AX_CODE_TUI_BACKEND_TRANSPORT")
    expect(thread).toContain('runtimeMode() === "compiled" ? "process" : "worker"')
    expect(thread).toContain('args: ["tui-backend", "--stdio"]')
    expect(thread).toContain("spawn(command.command, command.args")
    expect(thread).toContain('client.call("health", undefined)')
    expect(thread).toContain("TUI backend did not become ready")
    expect(thread).toContain('DiagnosticLog.recordProcess("tui.backendTargetResolved"')
    expect(thread).toContain('DiagnosticLog.recordProcess("tui.backendSpawned"')
    expect(thread).toContain('DiagnosticLog.recordProcess("tui.backendHandshakeFailed"')
    expect(thread).toContain('DiagnosticLog.recordProcess("tui.workerHandshakeFailed"')
    expect(thread).toContain('DiagnosticLog.recordProcess("tui.backendProtocolNoise"')
    expect(thread).toContain('DiagnosticLog.recordProcess("tui.backendProcessStdinClosed"')
    expect(thread).toContain('child.kill("SIGKILL")')
    expect(thread).toContain("worker.terminate()")
    expect(worker).toContain("health()")
    expect(worker).toContain("runtimeMode()")
    expect(worker).toContain("startTuiBackend")
    expect(worker).toContain("isWorkerEntrypoint")
    expect(worker).toContain("Rpc.listenStdio(rpc)")
    expect(worker).toContain('DiagnosticLog.recordProcess("backend.signalExit"')
  })

  test("surfaces workspace sync failures instead of leaving rejected RPC calls detached", async () => {
    const thread = await fs.readFile(THREAD_SRC, "utf8")

    expect(thread).toContain('client.call("setWorkspace", { workspaceID }).catch((error) => {')
    expect(thread).toContain('log.warn("failed to set workspace"')
    expect(thread).toContain('DiagnosticLog.recordProcess("tui.setWorkspaceFailed"')
  })

  test("worker target() resolves all three layouts: compiled binary, source-bundle, source-dev", async () => {
    // Regression guard for ADR-002 source-bundle. The bundle emits flat
    // worker.js next to index.js (build-source.ts uses `naming.entry =
    // "[name].[ext]"`), so target() must probe ./worker.js BEFORE
    // falling through to ./worker.ts. Without this, a packaged source-
    // bundle install fails at TUI launch with a ModuleNotFound for
    // worker.ts that does not exist in the tarball — and the install-
    // matrix smoke does not catch it because it only exercises non-TUI
    // commands (--version, doctor, debug config).
    const thread = await fs.readFile(THREAD_SRC, "utf8")

    // Compiled-binary path (bunfs-rooted absolute string, set by build.ts)
    expect(thread).toContain("AX_CODE_WORKER_PATH")
    // Compiled-binary-style nested layout (cli/cmd/tui/worker.js)
    expect(thread).toContain('new URL("./cli/cmd/tui/worker.js", import.meta.url)')
    // Source-bundle flat layout (worker.js sibling to bundled index.js)
    expect(thread).toContain('new URL("./worker.js", import.meta.url)')
    // Source/dev raw .ts layout (worker.ts sibling to thread.ts)
    expect(thread).toContain('new URL("./worker.ts", import.meta.url)')
  })

  test("keeps the OpenTUI app import diagnostic-only before renderer startup", async () => {
    const thread = await fs.readFile(THREAD_SRC, "utf8")
    const explain = await fs.readFile(DEBUG_EXPLAIN_SRC, "utf8")

    expect(thread).toContain('import("./app")')
    expect(thread).toContain('DiagnosticLog.recordProcess("tui.appImportStarted"')
    expect(thread).toContain('DiagnosticLog.recordProcess("tui.appImportReady"')
    expect(thread).toContain('DiagnosticLog.recordProcess("tui.appImportFailed"')
    expect(thread).toContain("TUI app failed to load.")
    expect(thread).toContain("elapsedMs")
    expect(thread).not.toContain("DEFAULT_TUI_APP_IMPORT_TIMEOUT_MS")
    expect(thread).not.toContain('withTimeout(\n          import("./app")')
    expect(explain).toContain('case "tui.appImportFailed":')
    expect(explain).toContain("tui.appImportReady")
  })
})
