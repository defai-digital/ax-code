import { describe, expect, test } from "vitest"
import {
  displayOffsetFromStringIndex,
  endDisplayOffset,
  expandPromptTextParts,
  hasUnfinishedTodosInPromptParts,
  isPastedImagePart,
  promptHistoryNavigationAllowed,
  promptPartExtmarkView,
  relocatePromptPartAfterEditor,
  setPromptPartSourceRange,
  stringIndexFromDisplayOffset,
} from "../../../src/cli/cmd/tui/component/prompt/prompt-helpers"
import type { PromptInfo } from "../../../src/cli/cmd/tui/component/prompt/prompt-info"

describe("prompt helpers", () => {
  test("expands sourced text parts using display offsets", () => {
    const parts: PromptInfo["parts"] = [
      {
        type: "text",
        text: "世界",
        source: {
          text: {
            start: 6,
            end: 8,
            value: "xx",
          },
        },
      },
    ]

    expect(expandPromptTextParts("hello xx", parts)).toBe("hello 世界")
  })

  test("converts display offsets to string indices with CJK width and newline as 1", () => {
    // "你好" is 2 UTF-16 units but 4 display columns; "\n" is 1 buffer unit.
    expect(stringIndexFromDisplayOffset("你好 x", 5)).toBe(3)
    expect(stringIndexFromDisplayOffset("a\nb", 2)).toBe(2)
    expect(stringIndexFromDisplayOffset("你\n好", 3)).toBe(2)
    expect(stringIndexFromDisplayOffset("abc", 99)).toBe(3)
    expect(stringIndexFromDisplayOffset("abc", -1)).toBe(0)
  })

  test("converts string indices to display offsets symmetrically", () => {
    expect(displayOffsetFromStringIndex("你好 x", 3)).toBe(5)
    expect(displayOffsetFromStringIndex("a\nb", 2)).toBe(2)
    expect(displayOffsetFromStringIndex("你\n好", 2)).toBe(3)
    expect(displayOffsetFromStringIndex("abc", 0)).toBe(0)
  })

  test("end display offset counts newlines the buffer counts", () => {
    expect(endDisplayOffset("line1\nline2")).toBe(11)
    expect(endDisplayOffset("你好\nx")).toBe(6)
    expect(endDisplayOffset("")).toBe(0)
  })

  test("expands sourced text parts on later lines of multi-line prompts", () => {
    const parts: PromptInfo["parts"] = [
      {
        type: "text",
        text: "PASTED",
        source: {
          text: {
            // "line1" = 5 columns + "\n" = 1 → placeholder starts at 6.
            start: 6,
            end: 14,
            value: "[pasted]",
          },
        },
      },
    ]

    expect(expandPromptTextParts("line1\n[pasted]", parts)).toBe("line1\nPASTED")
  })

  test("expands sourced text parts after wide characters", () => {
    const parts: PromptInfo["parts"] = [
      {
        type: "text",
        text: "世界",
        source: {
          text: {
            // "你好 " = 5 display columns but only 3 UTF-16 units.
            start: 5,
            end: 7,
            value: "xx",
          },
        },
      },
    ]

    expect(expandPromptTextParts("你好 xx end", parts)).toBe("你好 世界 end")
  })

  test("detects pasted inline image parts", () => {
    expect(
      isPastedImagePart({
        type: "file",
        mime: "image/png",
        url: "data:image/png;base64,abc",
        filename: "image.png",
        source: {
          type: "file",
          path: "/tmp/image.png",
          text: { value: "image.png", start: 0, end: 9 },
        },
      }),
    ).toBe(true)
    expect(
      isPastedImagePart({
        type: "file",
        mime: "image/png",
        url: "file:///tmp/image.png",
        filename: "image.png",
        source: {
          type: "file",
          path: "/tmp/image.png",
          text: { value: "image.png", start: 0, end: 9 },
        },
      }),
    ).toBe(false)
  })

  test("checks the latest completed todowrite result for active todos", () => {
    const messages = [{ id: "m1" }, { id: "m2" }]
    const partsByMessage = {
      m1: [
        {
          type: "tool",
          tool: "todowrite",
          state: {
            status: "completed",
            metadata: {
              todos: [{ status: "completed" }],
            },
          },
        },
      ],
      m2: [
        {
          type: "tool",
          tool: "todowrite",
          state: {
            status: "completed",
            metadata: {
              todos: [{ status: "pending" }],
            },
          },
        },
      ],
    }

    expect(hasUnfinishedTodosInPromptParts(messages, partsByMessage)).toBe(true)
  })

  test("relocates virtual file source ranges after editor changes", () => {
    const part: PromptInfo["parts"][number] = {
      type: "file",
      mime: "text/plain",
      url: "file:///tmp/a.txt",
      filename: "a.txt",
      source: {
        type: "file",
        path: "/tmp/a.txt",
        text: { value: "a.txt", start: 0, end: 5 },
      },
    }

    const relocated = relocatePromptPartAfterEditor(part, "open a.txt now")

    expect(relocated).toMatchObject({
      source: {
        text: {
          start: 5,
          end: 10,
        },
      },
    })
    expect(relocatePromptPartAfterEditor(part, "deleted")).toBeNull()
  })

  test("relocates virtual source ranges in display units after wide characters and newlines", () => {
    const part: PromptInfo["parts"][number] = {
      type: "file",
      mime: "text/plain",
      url: "file:///tmp/a.txt",
      filename: "a.txt",
      source: {
        type: "file",
        path: "/tmp/a.txt",
        text: { value: "a.txt", start: 0, end: 5 },
      },
    }

    // "你好\n" is 3 UTF-16 units but 5 buffer units (2+2 wide chars + newline).
    expect(relocatePromptPartAfterEditor(part, "你好\na.txt")).toMatchObject({
      source: {
        text: {
          start: 5,
          end: 10,
        },
      },
    })
  })

  test("blocks history navigation from a non-empty draft even when it matches the oldest entry", () => {
    const history = [{ input: "same" }, { input: "newest" }]

    // Index 0 is the draft position; history.at(0) is the *oldest* entry.
    expect(promptHistoryNavigationAllowed({ index: 0, draft: "same", history })).toBe(false)
    expect(promptHistoryNavigationAllowed({ index: 0, draft: "", history })).toBe(true)
  })

  test("allows history navigation while recalled text is unchanged", () => {
    const history = [{ input: "oldest" }, { input: "newest" }]

    expect(promptHistoryNavigationAllowed({ index: -1, draft: "newest", history })).toBe(true)
    expect(promptHistoryNavigationAllowed({ index: -1, draft: "edited", history })).toBe(false)
    expect(promptHistoryNavigationAllowed({ index: -1, draft: "", history })).toBe(true)
    expect(promptHistoryNavigationAllowed({ index: -5, draft: "", history })).toBe(false)
  })

  test("maps prompt parts to extmark views and syncs source ranges", () => {
    const part: PromptInfo["parts"][number] = {
      type: "text",
      text: "summary",
      source: {
        text: {
          value: "summary",
          start: 2,
          end: 9,
        },
      },
    }

    expect(promptPartExtmarkView(part, { fileStyleId: 1, pasteStyleId: 2, agentStyleId: 3 })).toEqual({
      start: 2,
      end: 9,
      virtualText: "summary",
      styleId: 2,
    })

    expect(setPromptPartSourceRange(part, 4, 11)).toBe(true)
    expect(part.source?.text.start).toBe(4)
    expect(part.source?.text.end).toBe(11)
  })
})
