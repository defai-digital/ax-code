import { describe, expect, test } from "vitest"
import path from "path"
import fs from "fs/promises"
import {
  SESSION_TOOL_RENDERER_KEYS,
  bashDisplayMode,
  coalescedToolLabel,
  isKnownSessionToolRenderer,
  sessionToolRendererKey,
} from "../../../src/cli/cmd/tui/routes/session/tool-rendering"

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

  test("keeps coalesced tool labels stable", () => {
    expect(coalescedToolLabel("read", 3)).toBe("Read · 3 files")
    expect(coalescedToolLabel("list", 2)).toBe("List · 2 directories")
    expect(coalescedToolLabel("glob", 4)).toBe("Glob · 4 searches")
    expect(coalescedToolLabel("grep", 5)).toBe("Grep · 5 searches")
    expect(coalescedToolLabel("custom_tool", 6)).toBe("custom_tool · 6")
  })

  test("bash rows stay a stable one-liner while running, block only after completion", () => {
    // Streamed output must not grow the transcript mid-call (transcript reflow
    // per output chunk); the block appears exactly once, when the call ends.
    expect(bashDisplayMode({ running: true, hasOutput: false })).toBe("inline")
    expect(bashDisplayMode({ running: true, hasOutput: true })).toBe("inline")
    expect(bashDisplayMode({ running: false, hasOutput: false })).toBe("inline")
    expect(bashDisplayMode({ running: false, hasOutput: true })).toBe("block")
  })

  test("keeps extracted renderer modules independent from the route index", async () => {
    const root = path.join(import.meta.dirname, "../../../src/cli/cmd/tui/routes/session/tool-renderers")
    for (const file of [
      "basic.tsx",
      "dre.tsx",
      "file-edits.tsx",
      "generic.tsx",
      "index.tsx",
      "primitives.tsx",
      "session.tsx",
      "task.tsx",
    ]) {
      const text = await fs.readFile(path.join(root, file), "utf8")
      expect(text).not.toMatch(/from\s+["']\.\.\/index["']/)
      expect(text).not.toMatch(/from\s+["']\.\.\/index\.tsx["']/)
    }
  })
})
