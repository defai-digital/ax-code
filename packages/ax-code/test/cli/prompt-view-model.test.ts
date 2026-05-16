import { describe, expect, test } from "bun:test"
import { promptSubmissionView } from "../../src/cli/cmd/tui/component/prompt/view-model"

describe("promptSubmissionView", () => {
  test("reconstructs prompt text from ordered extmarks", () => {
    const result = promptSubmissionView({
      text: "A [file] B [tag]",
      parts: [
        { type: "text", text: "src/app.ts" },
        { type: "file", filename: "src/app.ts" },
        { type: "text", text: "@workspace" },
      ] as any,
      extmarks: [
        { id: 1, start: 2, end: 8 },
        { id: 2, start: 11, end: 16 },
      ],
      extmarkToPartIndex: new Map([
        [1, 0],
        [2, 2],
      ]),
    })

    expect(result.text).toBe("A src/app.ts B @workspace")
    expect(result.parts).toHaveLength(1)
    expect(result.parts[0]).toMatchObject({ type: "file", filename: "src/app.ts" })
  })

  test("skips overlapping extmarks instead of corrupting output", () => {
    const result = promptSubmissionView({
      text: "0123456789",
      parts: [
        { type: "text", text: "LEFT" },
        { type: "text", text: "RIGHT" },
      ] as any,
      extmarks: [
        { id: 1, start: 2, end: 7 },
        { id: 2, start: 5, end: 9 },
      ],
      extmarkToPartIndex: new Map([
        [1, 0],
        [2, 1],
      ]),
    })

    expect(result.text).toBe("01LEFT789")
  })
})
