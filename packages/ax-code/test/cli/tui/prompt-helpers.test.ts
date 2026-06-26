import { describe, expect, test } from "vitest"
import {
  expandPromptTextParts,
  hasUnfinishedTodosInPromptParts,
  isPastedImagePart,
  promptPartExtmarkView,
  relocatePromptPartAfterEditor,
  setPromptPartSourceRange,
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
