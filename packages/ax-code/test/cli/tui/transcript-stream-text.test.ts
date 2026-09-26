import { describe, expect, test } from "vitest"
import { stripFenceLines } from "../../../src/cli/tui/routes/session/view-model"

describe("tui transcript streamed text", () => {
  test("drops fence rows so the finished render keeps the same row count", () => {
    // The markdown renderable consumes a fenced block structurally: the fence
    // rows exist while streaming and are gone afterwards unless the streamed
    // text drops them too (measured 5 rows raw vs 3 rows finished).
    const source = ["intro", "", "```ts", "const answer = 42", "```", "", "outro"].join("\n")
    expect(stripFenceLines(source)).toBe(["intro", "", "const answer = 42", "", "outro"].join("\n"))
  })

  test("drops tilde fences and an empty info string", () => {
    expect(stripFenceLines("a\n~~~markdown\nb\n~~~\nc")).toBe("a\nb\nc")
    expect(stripFenceLines("a\n```\nb\n```\nc")).toBe("a\nb\nc")
    expect(stripFenceLines("a\n`  `\nb")).toBe("a\n`  `\nb")
  })

  test("keeps inline runs, indented code, and longer lines intact", () => {
    // An inline span, an indented code block (four spaces is not a fence), and
    // a fence with trailing prose are all content.
    expect(stripFenceLines("text ``` inline")).toBe("text ``` inline")
    expect(stripFenceLines("    ```ts")).toBe("    ```ts")
    expect(stripFenceLines("body\n```ts extra")).toBe("body")
  })

  test("drops a trailing partial fence so its row does not appear and vanish", () => {
    expect(stripFenceLines("body\n`")).toBe("body")
    expect(stripFenceLines("body\n``")).toBe("body")
    expect(stripFenceLines("body\n~")).toBe("body")
    expect(stripFenceLines("body\n```")).toBe("body")
    // Only the last line is treated as a partial fence.
    expect(stripFenceLines("``\nbody")).toBe("``\nbody")
  })

  test("returns the same string when nothing is a fence", () => {
    const text = "# Heading\n\nplain body with `code` and a [link](https://example.com)"
    expect(stripFenceLines(text)).toBe(text)
  })
})
