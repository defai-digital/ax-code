import { describe, expect, test } from "bun:test"
import { isPromptExitCommand, promptSubmissionView } from "../../../src/cli/cmd/tui/component/prompt/view-model"

describe("tui prompt view model", () => {
  test("recognizes prompt exit commands after trimming", () => {
    expect(isPromptExitCommand(" exit ")).toBe(true)
    expect(isPromptExitCommand("quit")).toBe(true)
    expect(isPromptExitCommand(":q")).toBe(true)
    expect(isPromptExitCommand("exit now")).toBe(false)
  })

  test("expands pasted text parts inline before prompt submission", () => {
    const view = promptSubmissionView({
      text: "before [Pasted] after @file",
      extmarks: [
        { id: 10, start: 7, end: 15 },
        { id: 11, start: 22, end: 27 },
      ],
      extmarkToPartIndex: new Map([
        [10, 0],
        [11, 1],
      ]),
      parts: [
        {
          type: "text",
          text: "line 1\nline 2",
          source: { text: { start: 7, end: 15, value: "[Pasted]" } },
        },
        {
          type: "file",
          filename: "a.ts",
          url: "file:///repo/a.ts",
          mime: "text/plain",
          source: { text: { start: 22, end: 27, value: "@file" } },
        },
      ] as any,
    })

    expect(view.text).toBe("before line 1\nline 2 after @file")
    expect(view.parts).toEqual([
      {
        type: "file",
        filename: "a.ts",
        url: "file:///repo/a.ts",
        mime: "text/plain",
        source: { text: { start: 22, end: 27, value: "@file" } },
      },
    ] as any)
  })
})
