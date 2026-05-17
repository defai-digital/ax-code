import { describe, expect, test } from "bun:test"
import { dreGraphActivityToolLabels, summarizeDreGraphActivityTools } from "../../src/quality/dre-graph-activity"

describe("quality.dre-graph-activity", () => {
  test("summarizes activity into a compact human-readable sentence", () => {
    expect(
      summarizeDreGraphActivityTools([
        { name: "read", args: "src/session/prompt.ts" },
        { name: "read", args: "README.md" },
        { name: "edit", args: "src/session/prompt.ts" },
        { name: "grep", args: "TODO" },
        { name: "bash", args: "bun test" },
        { name: "web_fetch", args: "https://example.com" },
        { name: "unknown_tool", args: "" },
      ]),
    ).toBe("read prompt.ts, README.md · edited prompt.ts · searched 1× · ran 1 command · fetched 1 URL · 1 misc")
  })

  test("collapses larger read and edit groups", () => {
    expect(
      summarizeDreGraphActivityTools([
        { name: "read", args: "a.ts" },
        { name: "cat", args: "b.ts" },
        { name: "view", args: "c.ts" },
        { name: "write", args: "a.ts" },
        { name: "apply_patch", args: "b.ts" },
        { name: "edit", args: "c.ts" },
      ]),
    ).toBe("read 3 files · edited 3 files")
  })

  test("returns stable top tool labels", () => {
    expect(
      dreGraphActivityToolLabels([
        { name: "read" },
        { name: "bash" },
        { name: "read" },
        { name: "grep" },
        { name: "grep" },
        { name: "grep" },
        { name: "edit" },
      ]),
    ).toEqual(["grep ×3", "read ×2", "bash", "edit"])
  })

  test("labels empty activity explicitly", () => {
    expect(summarizeDreGraphActivityTools([])).toBe("no tool calls")
    expect(dreGraphActivityToolLabels([])).toEqual([])
  })
})
