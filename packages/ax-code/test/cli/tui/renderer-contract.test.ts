import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { TUI_RENDERER_CONTRACT, TUI_RENDERER_CONTRACT_REQUIRED_AREAS } from "../../../src/cli/cmd/tui/renderer-contract"
import { TUI_PERFORMANCE_CRITERIA } from "../../../src/cli/cmd/tui/performance-criteria"

const SRC_ROOT = path.resolve(import.meta.dir, "../../../src")
const TUI_SRC = path.join(SRC_ROOT, "cli/cmd/tui")
const OPENTUI_RE = /(?:from\s+["'](?:@opentui\/|opentui-spinner)|import\s+["'](?:@opentui\/|opentui-spinner))/
const OPENTUI_ADAPTER_FILES = new Set([path.join(TUI_SRC, "renderer-adapter/opentui.ts")])
const RENDERER_TYPES_FILE = path.join(TUI_SRC, "renderer-adapter/types.ts")

const PURE_TUI_FILES = [
  "performance-criteria.ts",
  "renderer-contract.ts",
  "renderer-decision.ts",
  "input/focus-manager.ts",
  "input/keymap.ts",
  "input/command-dispatch.ts",
  "input/prompt-editor.ts",
  "state/actions.ts",
  "state/app-state.ts",
  "state/event-map.ts",
  "state/event-queue.ts",
  "state/reducer.ts",
  "state/selectors.ts",
  "state/store.ts",
  "routes/session/footer-view-model.ts",
  "routes/session/header-view-model.ts",
  "routes/session/display.ts",
  "routes/session/format.ts",
  "routes/session/messages.ts",
  "routes/session/navigation.ts",
  "routes/session/usage.ts",
  "routes/session/view-model.ts",
  "ui/dialog-select-view-model.ts",
  "component/prompt/view-model.ts",
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

  test("keeps direct OpenTUI imports inside the OpenTUI renderer adapter", async () => {
    const offenders: string[] = []

    for (const file of await files(SRC_ROOT)) {
      const text = await fs.readFile(file, "utf8")
      if (!OPENTUI_RE.test(text)) continue
      if (!OPENTUI_ADAPTER_FILES.has(file)) {
        offenders.push(path.relative(SRC_ROOT, file))
      }
    }

    expect(offenders).toEqual([])
  })

  test("keeps pure TUI contracts and view models renderer-independent", async () => {
    const offenders: string[] = []

    for (const file of PURE_TUI_FILES) {
      const text = await fs.readFile(file, "utf8")
      if (OPENTUI_RE.test(text)) offenders.push(path.relative(TUI_SRC, file))
    }

    expect(offenders).toEqual([])
  })

  test("keeps renderer-neutral adapter types independent of OpenTUI", async () => {
    const text = await fs.readFile(RENDERER_TYPES_FILE, "utf8")

    expect(OPENTUI_RE.test(text)).toBe(false)
    expect(text).toContain("TuiKeyEvent")
    expect(text).toContain("TuiTextRun")
    expect(text).toContain("TuiFocusOwner")
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
})
