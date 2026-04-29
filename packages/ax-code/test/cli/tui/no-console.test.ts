import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"

const TUI_SRC = path.resolve(import.meta.dir, "../../../src/cli/cmd/tui")
const APP_SRC = path.join(TUI_SRC, "app.tsx")
const RENDERER_SRC = path.join(TUI_SRC, "renderer.ts")
const PROMPT_SRC = path.join(TUI_SRC, "component/prompt/index.tsx")
const SESSION_HEADER_SRC = path.join(TUI_SRC, "routes/session/header.tsx")
const SESSION_FOOTER_SRC = path.join(TUI_SRC, "routes/session/footer.tsx")
const SESSION_DIALOG_SRC = path.join(TUI_SRC, "routes/session/dialog-message.tsx")
const TIMELINE_FORK_DIALOG_SRC = path.join(TUI_SRC, "routes/session/dialog-fork-from-timeline.tsx")
const PROVIDER_DIALOG_SRC = path.join(TUI_SRC, "component/dialog-provider.tsx")
const SYNC_SRC = path.join(TUI_SRC, "context/sync.tsx")
const WORKSPACE_SESSION_LIST_SRC = path.join(TUI_SRC, "component/workspace/dialog-session-list.tsx")
const THEME_SRC = path.join(TUI_SRC, "context/theme.tsx")
const SIDEBAR_SRC = path.join(TUI_SRC, "routes/session/sidebar.tsx")
const CONSOLE_RE = /\bconsole\.(?:log|error|warn|debug)\b/

async function files(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const result: string[] = []

  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      result.push(...(await files(full)))
    } else if (/\.[cm]?[tj]sx?$/.test(entry.name)) {
      result.push(full)
    }
  }

  return result
}

describe("tui console hygiene", () => {
  test("does not write directly to console from TUI source", async () => {
    const offenders: string[] = []

    for (const file of await files(TUI_SRC)) {
      const text = await fs.readFile(file, "utf8")
      if (CONSOLE_RE.test(text)) offenders.push(path.relative(TUI_SRC, file))
    }

    expect(offenders).toEqual([])
  })

  test("submits prompts through the async endpoint", async () => {
    const text = await fs.readFile(PROMPT_SRC, "utf8")

    expect(text).toContain("submitAsyncRoute")
    expect(text).toContain('path: "prompt_async"')
    expect(text).toContain('path: "command_async"')
    expect(text).toContain('path: "shell_async"')
    expect(text).not.toContain("sdk.client.session.prompt(")
  })

  test("keeps render options owned by the renderer adapter", async () => {
    const app = await fs.readFile(APP_SRC, "utf8")
    const renderer = await fs.readFile(RENDERER_SRC, "utf8")

    expect(app).not.toMatch(/import\s*\{[^}]*\brender\b[^}]*\}\s*from\s*["@']@opentui\/solid["@']/)
    expect(app).toContain("renderTui(")
    expect(renderer).toContain("createTuiRenderOptions")
    expect(renderer).toContain("render(root, createTuiRenderOptions(options))")
  })

  test("keeps resize input recovery wired through the app shell", async () => {
    const app = await fs.readFile(APP_SRC, "utf8")

    expect(app).toContain("installResizeInputGuard()")
    expect(app).toContain("useResizeInputRecovery(dimensions)")
  })

  test("does not assume the session header data has loaded", async () => {
    const text = await fs.readFile(SESSION_HEADER_SRC, "utf8")

    expect(text).not.toContain("sync.session.get(route.sessionID)!")
  })

  test("keeps the session header free of token and throughput counters", async () => {
    const text = await fs.readFile(SESSION_HEADER_SRC, "utf8")

    expect(text).not.toContain("ContextInfo")
    expect(text).not.toContain("tok/s")
    expect(text).not.toContain("Usage.last(")
  })

  test("keeps empty footer signals hidden instead of showing zero-value chips", async () => {
    const footer = await fs.readFile(SESSION_FOOTER_SRC, "utf8")

    expect(footer).toContain("dimensions().width >= 90 && lsp().length > 0")
    expect(footer).toContain("showStatusSeparator")
  })

  test("keeps stalled prompt status static and stop copy direct", async () => {
    const prompt = await fs.readFile(PROMPT_SRC, "utf8")

    expect(prompt).toContain('when={status().type === "busy" && busyStatus()?.stale}')
    expect(prompt).toContain("again to force stop")
    expect(prompt).toContain("to stop")
  })

  test("does not assume fork responses contain session data", async () => {
    const messageDialog = await fs.readFile(SESSION_DIALOG_SRC, "utf8")
    const timelineDialog = await fs.readFile(TIMELINE_FORK_DIALOG_SRC, "utf8")
    const providerDialog = await fs.readFile(PROVIDER_DIALOG_SRC, "utf8")

    expect(messageDialog).not.toContain("result.data!")
    expect(timelineDialog).not.toContain("forked.data!")
    expect(providerDialog).not.toContain("result.data!")
  })

  test("does not assume non-blocking sync responses contain data", async () => {
    const sync = await fs.readFile(SYNC_SRC, "utf8")

    expect(sync).not.toContain('sdk.client.lsp.status().then((x) => setStore("lsp", reconcile(x.data!)))')
    expect(sync).not.toContain('sdk.client.mcp.status().then((x) => setStore("mcp", reconcile(x.data!)))')
    expect(sync).not.toContain('sdk.client.formatter.status().then((x) => setStore("formatter", reconcile(x.data!)))')
    expect(sync).not.toContain('setStore("session_status", reconcile(x.data!))')
    expect(sync).not.toContain('sdk.client.path.get().then((x) => setStore("path", reconcile(x.data!)))')
    expect(sync).not.toContain("providersPromise.then((x) => x.data!)")
    expect(sync).not.toContain("providerListPromise.then((x) => x.data!)")
    expect(sync).not.toContain("configPromise.then((x) => x.data!)")
  })

  test("does not double-read optional workspace search resources", async () => {
    const workspaceSessionList = await fs.readFile(WORKSPACE_SESSION_LIST_SRC, "utf8")

    expect(workspaceSessionList).not.toContain("if (searchResults()) return searchResults()!")
  })

  test("keeps system theme generation tolerant of missing palette entries", async () => {
    const theme = await fs.readFile(THEME_SRC, "utf8")

    expect(theme).not.toContain("colors.palette[0]!")
    expect(theme).not.toContain("colors.palette[7]!")
  })

  test("opens sidebar actions on mouseup after suppressing header toggle", async () => {
    const sidebar = await fs.readFile(SIDEBAR_SRC, "utf8")

    expect(sidebar).toMatch(
      /onMouseUp=\{\(e: any\) => \{\s+e\.stopPropagation\(\)\s+command\.trigger\("session\.activity"\)/,
    )
    expect(sidebar).toMatch(
      /onMouseUp=\{\(e: any\) => \{\s+e\.stopPropagation\(\)\s+command\.trigger\("session\.undo"\)/,
    )
  })

  test("autocomplete scroll follows child positions instead of a stale raw scrollTop snapshot", async () => {
    const autocomplete = await fs.readFile(path.join(TUI_SRC, "component/prompt/autocomplete.tsx"), "utf8")

    expect(autocomplete).toContain("scroll.getChildren()")
    expect(autocomplete).toContain("scroll.y")
    expect(autocomplete).not.toContain("scroll.scrollTop")
  })
})
