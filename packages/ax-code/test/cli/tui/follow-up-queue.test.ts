import { describe, expect, test } from "vitest"
import { followUpText, isQueueableStatus } from "../../../src/cli/tui/component/prompt/follow-up-queue"

describe("follow-up composer input", () => {
  test("queues only busy and retrying sessions", () => {
    expect(isQueueableStatus("busy")).toBe(true)
    expect(isQueueableStatus("retry")).toBe(true)
    expect(isQueueableStatus("idle")).toBe(false)
    expect(isQueueableStatus(undefined)).toBe(false)
  })
  test("preserves leading whitespace and an empty first text part during edits", () => {
    expect(followUpText({ parts: [{ type: "file" }, { type: "text", text: "  code\n" }] })).toBe("  code\n")
    expect(
      followUpText({
        parts: [
          { type: "text", text: "" },
          { type: "text", text: "Other" },
        ],
      }),
    ).toBe("")
    expect(followUpText({ parts: [{ type: "file" }] })).toBe("")
  })
})
