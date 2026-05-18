import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import {
  SESSION_TOOL_RENDERER_KEYS,
  coalescedToolLabel,
  isKnownSessionToolRenderer,
  sessionToolRendererKey,
} from "../../src/cli/cmd/tui/routes/session/tool-rendering"

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

  test("keeps extracted renderer modules independent from the route index", async () => {
    const root = path.join(import.meta.dir, "../../src/cli/cmd/tui/routes/session/tool-renderers")
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
