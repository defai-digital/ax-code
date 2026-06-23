// @vitest-environment node

import { describe, expect, test } from "vitest"
import type { ToolPart as ToolPartType } from "@ax-code/sdk/v2"
import { isActiveToolPart, isFinalizedToolPart } from "./toolPartState"

function toolPart(state: Record<string, unknown>): ToolPartType {
  return {
    id: "tool-1",
    type: "tool",
    tool: "bash",
    state,
  } as ToolPartType
}

describe("tool part state", () => {
  test("treats final statuses as finalized even without an end timestamp", () => {
    expect(isFinalizedToolPart(toolPart({ status: "completed" }))).toBe(true)
    expect(isFinalizedToolPart(toolPart({ status: "error" }))).toBe(true)
  })

  test("keeps active statuses active even if a timestamp is present", () => {
    const part = toolPart({ status: "running", time: { start: 10, end: 20 } })

    expect(isActiveToolPart(part)).toBe(true)
    expect(isFinalizedToolPart(part)).toBe(false)
  })

  test("falls back to valid end timestamps when no status is available", () => {
    expect(isFinalizedToolPart(toolPart({ time: { start: 10, end: 20 } }))).toBe(true)
    expect(isFinalizedToolPart(toolPart({ time: { start: 20, end: 10 } }))).toBe(false)
  })
})
