import { describe, expect, test } from "vitest"
import path from "path"
import fs from "fs/promises"
import {
  BASH_LIVE_WINDOW_LINES,
  SESSION_TOOL_RENDERER_KEYS,
  bashDisplayMode,
  bashLiveWindow,
  coalescedToolLabel,
  isKnownSessionToolRenderer,
  sessionToolRendererKey,
} from "../../../src/cli/tui/routes/session/tool-rendering"
import { scheduleTaskLine } from "../../../src/cli/tui/routes/session/tool-renderers/schedule-view"

describe("tui session tool rendering policy", () => {
  test("maps every specialized renderer key to itself", () => {
    for (const key of SESSION_TOOL_RENDERER_KEYS) {
      if (key === "generic") continue
      expect(sessionToolRendererKey(key)).toBe(key)
      expect(isKnownSessionToolRenderer(key)).toBe(true)
    }
  })

  test("falls back to the generic renderer for unknown tools", () => {
    expect(sessionToolRendererKey("custom_tool")).toBe("generic")
    expect(sessionToolRendererKey("")).toBe("generic")
    expect(isKnownSessionToolRenderer("custom_tool")).toBe(false)
  })

  test("routes schedule_task to its receipt renderer", () => {
    expect(sessionToolRendererKey("schedule_task")).toBe("schedule_task")
    expect(isKnownSessionToolRenderer("schedule_task")).toBe(true)
    expect(scheduleTaskLine({ running: true, title: "Tokyo weather" })).toBe("Scheduling Tokyo weather")
    expect(scheduleTaskLine({ running: false, title: "Tokyo weather", id: "sch_test", nextRunAt: 1 })).toContain(
      "Scheduled · Tokyo weather · sch_test · next ",
    )
  })

  test("does not route the ensemble modes to the hidden generic renderer", () => {
    // Regression guard: council/arena results must render through their own
    // metadata-driven renderers, never GenericTool (whose output is hidden by
    // default via generic_tool_output_visibility).
    expect(sessionToolRendererKey("council")).toBe("council")
    expect(sessionToolRendererKey("arena")).toBe("arena")
    expect(isKnownSessionToolRenderer("council")).toBe(true)
    expect(isKnownSessionToolRenderer("arena")).toBe(true)
  })

  test("keeps coalesced tool labels stable", () => {
    expect(coalescedToolLabel("read", 3)).toBe("Read · 3 files")
    expect(coalescedToolLabel("list", 2)).toBe("List · 2 directories")
    expect(coalescedToolLabel("glob", 4)).toBe("Glob · 4 searches")
    expect(coalescedToolLabel("grep", 5)).toBe("Grep · 5 searches")
    expect(coalescedToolLabel("custom_tool", 6)).toBe("custom_tool · 6")
  })

  test("a bash card keeps its block shape from the first live snapshot", () => {
    // The row must not change type when the call finishes. The old rule kept a
    // one-liner while running and swapped in a bordered block at completion, so
    // every finished command shifted the transcript by the block's chrome
    // (border, padding, margin). The block now appears as soon as the tool has
    // published a live snapshot, which it does from the first tick.
    expect(bashDisplayMode({ hasOutput: false })).toBe("inline")
    expect(bashDisplayMode({ hasOutput: true })).toBe("block")
  })

  test("the running window shows the newest output inside the finished row budget", () => {
    const short = ["one", "two", "three"]
    expect(bashLiveWindow(short)).toEqual({ text: "one\ntwo\nthree", hidden: 0 })

    const long = Array.from({ length: 25 }, (_, index) => `line ${index + 1}`)
    const window = bashLiveWindow(long)
    expect(window.text.split("\n")).toHaveLength(BASH_LIVE_WINDOW_LINES)
    expect(window.text.startsWith("line 16")).toBe(true)
    expect(window.hidden).toBe(25 - BASH_LIVE_WINDOW_LINES)
  })

  test("keeps extracted renderer modules independent from the route index", async () => {
    const root = path.join(import.meta.dirname, "../../../src/cli/tui/routes/session/tool-renderers")
    for (const file of [
      "basic.tsx",
      "dre.tsx",
      "ensemble.tsx",
      "ensemble-view.ts",
      "file-edits.tsx",
      "generic.tsx",
      "index.tsx",
      "primitives.tsx",
      "session.tsx",
      "task.tsx",
      "schedule.tsx",
      "schedule-view.ts",
    ]) {
      const text = await fs.readFile(path.join(root, file), "utf8")
      expect(text).not.toMatch(/from\s+["']\.\.\/index["']/)
      expect(text).not.toMatch(/from\s+["']\.\.\/index\.tsx["']/)
    }
  })
})
