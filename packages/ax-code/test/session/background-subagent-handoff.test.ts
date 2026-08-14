import { describe, expect, test } from "vitest"
import {
  childVisibleText,
  formatBackgroundTaskHandoff,
  parseBackgroundTaskHandoffs,
} from "../../src/session/background-subagent-handoff"

describe("background-subagent-handoff", () => {
  test("formats and parses a completed child result without promoting tool output", () => {
    const text = formatBackgroundTaskHandoff({
      taskID: "ses_child",
      title: "Explore the repo",
      state: "completed",
      text: "Auth lives in src/auth/index.ts",
    })

    expect(text).toContain('id="ses_child"')
    expect(text).toContain('state="completed"')
    expect(text).not.toContain("<tool")

    const parsed = parseBackgroundTaskHandoffs(text)
    expect(parsed).toEqual([
      {
        taskID: "ses_child",
        state: "completed",
        title: "Background task completed: Explore the repo",
        resultText: "Auth lives in src/auth/index.ts",
        empty: false,
        failed: false,
        recoveredResultNeedsReview: false,
      },
    ])
  })

  test("marks empty and failed handoffs so the completion gate can block", () => {
    const empty = parseBackgroundTaskHandoffs(
      formatBackgroundTaskHandoff({
        taskID: "ses_empty",
        title: "Review code",
        state: "completed",
        text: "",
      }),
    )
    expect(empty[0]?.empty).toBe(true)
    expect(empty[0]?.failed).toBe(false)

    const failed = parseBackgroundTaskHandoffs(
      formatBackgroundTaskHandoff({
        taskID: "ses_fail",
        title: "Review code",
        state: "error",
        text: "",
        errorMessage: "Subagent timed out after 10 minutes",
      }),
    )
    expect(failed[0]?.failed).toBe(true)
    expect(failed[0]?.empty).toBe(true)
    expect(failed[0]?.resultText).toContain("timed out")
  })

  test("childVisibleText uses the last assistant text and ignores tool parts", () => {
    expect(
      childVisibleText({
        parts: [
          { type: "tool", tool: "bash", state: { output: "secret log" } },
          { type: "text", text: "   first   " },
          { type: "text", text: "visible answer" },
        ],
      }),
    ).toBe("visible answer")
    expect(childVisibleText({ parts: [{ type: "tool", tool: "bash" }] })).toBe("")
  })
})
