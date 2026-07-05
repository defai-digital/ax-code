import { describe, expect, test } from "vitest"
import { getStaticGroupToolName, isExpandableTool, isStandaloneTool, isStaticTool, normalizeToolName } from "./toolRenderUtils"

describe("normalizeToolName", () => {
  test("normalizes casing, provider prefixes, and streaming suffixes", () => {
    expect(normalizeToolName(" Bash:12 ")).toBe("bash")
    expect(normalizeToolName("server.apply_patch:3")).toBe("apply_patch")
    expect(normalizeToolName("")).toBe("")
    expect(normalizeToolName(null)).toBe("")
  })
})

describe("tool render classification", () => {
  test("classifies expandable, standalone, and static tools after normalization", () => {
    expect(isExpandableTool("server.bash:1")).toBe(true)
    expect(isStandaloneTool("task")).toBe(true)
    expect(isStaticTool("grep")).toBe(true)
    expect(getStaticGroupToolName("ripgrep")).toBe("grep")
  })
})
