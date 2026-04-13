import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"

const TUI_SRC = path.resolve(import.meta.dir, "../../../src/cli/cmd/tui")
const APP_SRC = path.join(TUI_SRC, "app.tsx")
const RENDERER_SRC = path.join(TUI_SRC, "renderer.ts")
const PROMPT_SRC = path.join(TUI_SRC, "component/prompt/index.tsx")
const SESSION_HEADER_SRC = path.join(TUI_SRC, "routes/session/header.tsx")
const SESSION_DIALOG_SRC = path.join(TUI_SRC, "routes/session/dialog-message.tsx")
const TIMELINE_FORK_DIALOG_SRC = path.join(TUI_SRC, "routes/session/dialog-fork-from-timeline.tsx")
const CONSOLE_RE = /\bconsole\.(?:log|error|warn|debug)\b/

async function files(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const result: string[] = []

  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      result.push(...await files(full))
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

    expect(text).toContain("sdk.client.session.promptAsync")
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

  test("does not assume the session header data has loaded", async () => {
    const text = await fs.readFile(SESSION_HEADER_SRC, "utf8")

    expect(text).not.toContain("sync.session.get(route.sessionID)!")
  })

  test("does not assume fork responses contain session data", async () => {
    const messageDialog = await fs.readFile(SESSION_DIALOG_SRC, "utf8")
    const timelineDialog = await fs.readFile(TIMELINE_FORK_DIALOG_SRC, "utf8")

    expect(messageDialog).not.toContain("result.data!")
    expect(timelineDialog).not.toContain("forked.data!")
  })
})
