import { describe, expect, test } from "bun:test"
import { isSummarizedPastePart, summarizedPasteViews } from "../../../src/cli/cmd/tui/component/prompt/paste-view-model"

describe("prompt paste view model", () => {
  test("classifies summarized paste parts", () => {
    expect(
      isSummarizedPastePart({
        type: "text",
        text: "one\ntwo\nthree",
        source: {
          text: {
            start: 0,
            end: 17,
            value: "[Pasted ~3 lines]",
          },
        },
      } as any),
    ).toBe(true)

    expect(
      isSummarizedPastePart({
        type: "text",
        text: "plain text",
      } as any),
    ).toBe(false)
  })

  test("builds preview rows from summarized pastes", () => {
    const views = summarizedPasteViews(
      [
        {
          type: "text",
          text: "alpha\nbeta\ngamma\ndelta",
          source: {
            text: {
              start: 0,
              end: 17,
              value: "[Pasted ~4 lines]",
            },
          },
        },
      ] as any,
      2,
    )

    expect(views).toEqual([
      {
        partIndex: 0,
        label: "[Pasted ~4 lines]",
        text: "alpha\nbeta\ngamma\ndelta",
        lineCount: 4,
        previewLines: ["alpha", "beta"],
        hiddenLineCount: 2,
      },
    ])
  })

  test("ignores non-summary virtual text parts such as svg tokens", () => {
    expect(
      summarizedPasteViews([
        {
          type: "text",
          text: "<svg />",
          source: {
            text: {
              start: 0,
              end: 11,
              value: "[SVG: icon.svg]",
            },
          },
        },
      ] as any),
    ).toEqual([])
  })
})
