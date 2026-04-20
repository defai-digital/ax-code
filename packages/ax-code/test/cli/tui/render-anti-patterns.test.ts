import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"

const TUI_ROOT = path.resolve(import.meta.dir, "../../../src/cli/cmd/tui")
const APP_SRC = path.join(TUI_ROOT, "app.tsx")
const HELPER_SRC = path.join(TUI_ROOT, "context/helper.tsx")
const RENDERER_SRC = path.join(TUI_ROOT, "renderer.ts")
const SESSION_ROUTE_SRC = path.join(TUI_ROOT, "routes/session/index.tsx")
const SIDEBAR_SRC = path.join(TUI_ROOT, "routes/session/sidebar.tsx")
const THEME_DIALOG_SRC = path.join(TUI_ROOT, "component/dialog-theme-list.tsx")
const DIALOG_PROVIDER_SRC = path.join(TUI_ROOT, "component/dialog-provider.tsx")
const AUTOCOMPLETE_SRC = path.join(TUI_ROOT, "component/prompt/autocomplete.tsx")
const DIALOG_SELECT_SRC = path.join(TUI_ROOT, "ui/dialog-select.tsx")
const DIALOG_SRC = path.join(TUI_ROOT, "ui/dialog.tsx")
const DIALOG_PROMPT_SRC = path.join(TUI_ROOT, "ui/dialog-prompt.tsx")
const DIALOG_EXPORT_OPTIONS_SRC = path.join(TUI_ROOT, "ui/dialog-export-options.tsx")
const SYNC_SRC = path.join(TUI_ROOT, "context/sync.tsx")
const HOME_SRC = path.join(TUI_ROOT, "routes/home.tsx")
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

  test("avoids async createEffect in the session startup path", async () => {
    const session = await fs.readFile(SESSION_ROUTE_SRC, "utf8")

    expect(session).not.toContain("createEffect(async")
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
    const sync = await fs.readFile(SYNC_SRC, "utf8")

    expect(sync).toContain("const coreBootstrapTasks = [")
    expect(sync).toContain("const deferredBootstrapTasks = [")
    expect(sync).toContain('"tui bootstrap debug-engine"')
    expect(sync).toContain('"tui bootstrap worktree.list"')
    expect(sync).toContain('"tui bootstrap mcp.status"')
    expect(sync).toContain('setStore("status", "complete")')
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
    expect(dialogSelect).not.toContain("setTimeout(")
  })

  test("keeps dialog focus handoff work on cancellable microtasks", async () => {
    for (const file of [DIALOG_SRC, DIALOG_PROMPT_SRC, DIALOG_EXPORT_OPTIONS_SRC]) {
      const text = await fs.readFile(file, "utf8")

      expect(text).toContain("scheduleMicrotaskTask")
      expect(text).not.toContain("setTimeout(")
    }
  })

  test("keeps doctor checking the OpenTUI preload dependency with bundled-runtime awareness", async () => {
    const doctor = await fs.readFile(DOCTOR_PRELOAD_SRC, "utf8")

    expect(doctor).toContain("Bun.resolveSync")
    expect(doctor).toContain('"@opentui/solid/preload"')
    expect(doctor).toContain("Bundled runtime")
    expect(doctor).toContain("source/dev TUI may fail to start")
  })
})
