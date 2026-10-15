import { describe, expect, test } from "vitest"
import fs from "fs/promises"
import path from "path"
import { hidesCompletedToolWhenDetailsOff } from "../../../src/cli/tui/routes/session/tool-rendering"

const TRANSCRIPT_SRC = path.join(import.meta.dirname, "../../../src/cli/tui/routes/session/transcript.tsx")

describe("tool details visibility", () => {
  test("keeps review-surface tools visible when tool details are off", () => {
    expect(hidesCompletedToolWhenDetailsOff("edit")).toBe(false)
    expect(hidesCompletedToolWhenDetailsOff("write")).toBe(false)
    expect(hidesCompletedToolWhenDetailsOff("apply_patch")).toBe(false)
    expect(hidesCompletedToolWhenDetailsOff("bash")).toBe(false)
  })

  test("still hides informational tools when tool details are off", () => {
    expect(hidesCompletedToolWhenDetailsOff("read")).toBe(true)
    expect(hidesCompletedToolWhenDetailsOff("glob")).toBe(true)
    expect(hidesCompletedToolWhenDetailsOff("grep")).toBe(true)
    expect(hidesCompletedToolWhenDetailsOff("list")).toBe(true)
    expect(hidesCompletedToolWhenDetailsOff("task")).toBe(true)
    expect(hidesCompletedToolWhenDetailsOff("webfetch")).toBe(true)
    expect(hidesCompletedToolWhenDetailsOff("mcp__server__tool")).toBe(true)
    expect(hidesCompletedToolWhenDetailsOff("")).toBe(true)
  })

  test("the transcript hiding rule routes through the keep-visible helper", async () => {
    const src = await fs.readFile(TRANSCRIPT_SRC, "utf8")
    const start = src.indexOf("const shouldHide = createMemo")
    const end = src.indexOf("const toolprops", start)
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    const block = src.slice(start, end)

    // The blanket rule used to hide every completed tool, which made an
    // entire turn's edits and shell commands invisible.
    expect(block).toContain("if (!hidesCompletedToolWhenDetailsOff(props.part.tool)) return false")
  })
})
