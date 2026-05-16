import { describe, expect, test } from "bun:test"
import { messageScroll, nextVisibleMessage, visibleMessages } from "../../src/cli/cmd/tui/routes/session/navigation"

describe("tui session navigation", () => {
  test("filters visible messages to real text content", () => {
    expect(
      visibleMessages(
        [{ id: "a", y: 30 }, { id: "b", y: 10 }, { id: "c", y: 20 }, { y: 40 }],
        [{ id: "a" }, { id: "b" }, { id: "c" }],
        {
          a: [{ type: "text", synthetic: true }],
          b: [{ type: "text" }],
          c: [{ type: "tool" }, { type: "text", ignored: true }],
        },
      ).map((item) => item.id),
    ).toEqual(["b"])
  })

  test("finds the next visible message below the current scroll position", () => {
    expect(
      nextVisibleMessage({
        direction: "next",
        children: [
          { id: "a", y: 5 },
          { id: "b", y: 25 },
          { id: "c", y: 60 },
        ],
        messages: [{ id: "a" }, { id: "b" }, { id: "c" }],
        parts: {
          a: [{ type: "text" }],
          b: [{ type: "text" }],
          c: [{ type: "text" }],
        },
        scrollTop: 10,
      }),
    ).toBe("b")
  })

  test("finds the previous visible message above the current scroll position", () => {
    expect(
      nextVisibleMessage({
        direction: "prev",
        children: [
          { id: "a", y: 5 },
          { id: "b", y: 25 },
          { id: "c", y: 60 },
        ],
        messages: [{ id: "a" }, { id: "b" }, { id: "c" }],
        parts: {
          a: [{ type: "text" }],
          b: [{ type: "text" }],
          c: [{ type: "text" }],
        },
        scrollTop: 40,
      }),
    ).toBe("b")
  })

  test("falls back to page scroll when no message target exists", () => {
    expect(messageScroll({ direction: "next", scrollTop: 20, height: 80 })).toBe(80)
    expect(messageScroll({ direction: "prev", scrollTop: 20, height: 80 })).toBe(-80)
  })

  test("scrolls to the target child when present", () => {
    expect(messageScroll({ direction: "next", target: { id: "x", y: 60 }, scrollTop: 20, height: 80 })).toBe(39)
  })
})
