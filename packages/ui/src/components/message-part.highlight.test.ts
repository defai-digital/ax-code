import { describe, expect, test } from "bun:test"
import { highlightSegments } from "./message-part.highlight"

describe("message part highlight helpers", () => {
  test("splits plain text around file and agent references", () => {
    const text = "read file and ask agent"
    const segments = highlightSegments(
      text,
      [{ source: { text: { start: 5, end: 9 } } } as never],
      [{ source: { start: 18, end: 23 } } as never],
    )

    expect(segments).toEqual([
      { text: "read " },
      { text: "file", type: "file" },
      { text: " and ask " },
      { text: "agent", type: "agent" },
    ])
  })

  test("ignores overlapping later references", () => {
    const text = "abcdef"
    const segments = highlightSegments(
      text,
      [{ source: { text: { start: 1, end: 4 } } } as never],
      [{ source: { start: 2, end: 5 } } as never],
    )

    expect(segments).toEqual([{ text: "a" }, { text: "bcd", type: "file" }, { text: "ef" }])
  })
})
