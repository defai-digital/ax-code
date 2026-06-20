import { describe, expect, test } from "vitest"
import fs from "fs/promises"
import path from "path"
import { TUI_RENDERER_CONTRACT, TUI_RENDERER_CONTRACT_REQUIRED_AREAS } from "../../../src/cli/cmd/tui/renderer-contract"
import { TUI_PERFORMANCE_CRITERIA } from "../../../src/cli/cmd/tui/performance-criteria"
import { resolveSessionFirstRoute } from "../../../src/cli/cmd/tui/navigation/launch-policy"
import { resolveDesktopHandoff } from "../../../src/cli/cmd/tui/navigation/desktop-handoff"

const SRC_ROOT = path.resolve(import.meta.dirname, "../../../src")
const TUI_SRC = path.join(SRC_ROOT, "cli/cmd/tui")
const OPENTUI_RE = /(?:from\s+["'](?:@opentui\/|opentui-spinner)|import\s+["'](?:@opentui\/|opentui-spinner))/
const SPINNER_SOLID_RE = /(?:from\s+["']opentui-spinner\/solid["']|import\s+["']opentui-spinner\/solid["'])/
const OPENTUI_ALLOWED_OUTSIDE_TUI = new Set([
  path.join(SRC_ROOT, "cli/cmd/doctor.ts"),
  // Entry point must register the OpenTUI Solid transform plugin before
  // boot for the source-bundle distribution (ADR-002), where bunfig.toml
  // preloads aren't in scope. See comment in src/index.ts.
  path.join(SRC_ROOT, "index.ts"),
])

const PURE_TUI_FILES = [
  "performance-criteria.ts",
  "renderer-contract.ts",
  "renderer-decision.ts",
  "routes/session/footer-view-model.ts",
  "routes/session/display.ts",
  "routes/session/format.ts",
  "routes/session/messages.ts",
  "routes/session/navigation.ts",
  "routes/session/usage.ts",
  "routes/session/view-model.ts",
  "ui/dialog-select-view-model.ts",
  "component/prompt/view-model.ts",
  "navigation/launch-policy.ts",
  "navigation/desktop-handoff.ts",
].map((file) => path.join(TUI_SRC, file))

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

describe("tui renderer replacement contract", () => {
  test("covers every required renderer area before replacement work", () => {
    const areas = new Set(TUI_RENDERER_CONTRACT.map((item) => item.area))

    for (const area of TUI_RENDERER_CONTRACT_REQUIRED_AREAS) {
      expect(areas.has(area)).toBe(true)
    }
  })

  test("keeps direct OpenTUI imports inside the TUI surface", async () => {
    const offenders: string[] = []

    for (const file of await files(SRC_ROOT)) {
      const text = await fs.readFile(file, "utf8")
      if (!OPENTUI_RE.test(text)) continue
      if (!file.startsWith(TUI_SRC + path.sep) && !OPENTUI_ALLOWED_OUTSIDE_TUI.has(file)) {
        offenders.push(path.relative(SRC_ROOT, file))
      }
    }

    expect(offenders).toEqual([])
  })

  test("keeps the opentui-spinner solid adapter isolated", async () => {
    const offenders: string[] = []
    const adapter = path.join(TUI_SRC, "component/spinner.tsx")

    for (const file of await files(TUI_SRC)) {
      const text = await fs.readFile(file, "utf8")
      if (SPINNER_SOLID_RE.test(text) && file !== adapter) offenders.push(path.relative(TUI_SRC, file))
    }

    expect(offenders).toEqual([])
  })

  test("detects every opentui-spinner solid import form", () => {
    expect(SPINNER_SOLID_RE.test('import "opentui-spinner/solid"')).toBe(true)
    expect(SPINNER_SOLID_RE.test('import spinner from "opentui-spinner/solid"')).toBe(true)
    expect(SPINNER_SOLID_RE.test('import { spinner } from "opentui-spinner/solid"')).toBe(true)
  })

  test("keeps renderer-neutral planning helpers independent of OpenTUI", async () => {
    const offenders: string[] = []

    for (const file of PURE_TUI_FILES) {
      const text = await fs.readFile(file, "utf8")
      if (OPENTUI_RE.test(text)) offenders.push(path.relative(TUI_SRC, file))
    }

    expect(offenders).toEqual([])
  })

  test("tracks long-term replacement criteria for phase 2 workloads", () => {
    expect(TUI_PERFORMANCE_CRITERIA.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        "input.paste-echo",
        "terminal.resize-stability",
        "mouse.click-release",
        "selection.drag-stability",
        "layout.multi-pane",
        "transcript.rich-rendering",
        "plugins.ui-slots",
        "visualization.terminal-native",
      ]),
    )
  })

  test("includes routing contract requirements for ADR-035", () => {
    const routingItems = TUI_RENDERER_CONTRACT.filter((item) => item.area === "routing")
    const ids = routingItems.map((item) => item.id)
    expect(ids).toContain("routing.session-first")
    expect(ids).toContain("routing.dashboard-free")
  })

  test("asserts session-first launch policy never returns dashboard route (ADR-035)", () => {
    const inputs = [
      { explicitSessionID: undefined, explicitPrompt: undefined, recentSessionIDs: [], hasProjectContext: false },
      { explicitSessionID: undefined, explicitPrompt: undefined, recentSessionIDs: [], hasProjectContext: true },
      { explicitSessionID: "sess-1", explicitPrompt: undefined, recentSessionIDs: [], hasProjectContext: false },
      { explicitSessionID: undefined, explicitPrompt: "hi", recentSessionIDs: [], hasProjectContext: false },
      {
        explicitSessionID: undefined,
        explicitPrompt: undefined,
        recentSessionIDs: ["recent-1"],
        hasProjectContext: true,
      },
    ]
    for (const input of inputs) {
      const result = resolveSessionFirstRoute(input)
      expect(result.type === "session" || result.type === "new-session").toBe(true)
    }
  })

  test("asserts desktop handoff exists and routes are dashboard-free (ADR-035)", () => {
    const darwin = resolveDesktopHandoff({ platform: "darwin" })
    expect(darwin.type).toBe("not-installed")

    const linux = resolveDesktopHandoff({ platform: "linux" })
    expect(linux.type).toBe("unsupported")

    const withUrl = resolveDesktopHandoff({ platform: "darwin", desktopUrl: "http://localhost:3000" })
    expect(withUrl.type).toBe("message")
    if (withUrl.type === "message") {
      expect(withUrl.message).toContain("http://localhost:3000")
    }
  })
})
