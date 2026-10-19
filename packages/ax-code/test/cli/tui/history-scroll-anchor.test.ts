import { describe, expect, test } from "vitest"
import { captureScrollAnchor, restoredScrollTop } from "../../../src/cli/tui/routes/session/history-scroll-anchor"

describe("history scroll anchor", () => {
  test("captures the offset and content height when the view is not pinned", () => {
    expect(
      captureScrollAnchor({
        scrollTop: 40,
        scrollHeight: 200,
        viewport: { height: 50 },
      }),
    ).toEqual({ top: 40, height: 200, atBottom: false })
  })

  test("marks the view pinned when scrollTop reaches the bottom edge", () => {
    expect(
      captureScrollAnchor({
        scrollTop: 150,
        scrollHeight: 200,
        viewport: { height: 50 },
      }),
    ).toEqual({ top: 150, height: 200, atBottom: true })
  })

  test("treats a short transcript as pinned to the bottom", () => {
    expect(
      captureScrollAnchor({
        scrollTop: 0,
        scrollHeight: 20,
        viewport: { height: 50 },
      }).atBottom,
    ).toBe(true)
  })

  test("keeps a position one row above the bottom unpinned", () => {
    const anchor = captureScrollAnchor({
      scrollTop: 149,
      scrollHeight: 200,
      viewport: { height: 50 },
    })
    expect(anchor.atBottom).toBe(false)
    expect(restoredScrollTop(anchor, 260)).toBe(209)
  })

  test("shifts scrollTop by the content growth when the view is not pinned", () => {
    const anchor = captureScrollAnchor({
      scrollTop: 40,
      scrollHeight: 200,
      viewport: { height: 50 },
    })
    expect(restoredScrollTop(anchor, 260)).toBe(100)
  })

  test("leaves a bottom-pinned view to sticky scroll", () => {
    const anchor = captureScrollAnchor({
      scrollTop: 150,
      scrollHeight: 200,
      viewport: { height: 50 },
    })
    expect(restoredScrollTop(anchor, 260)).toBeUndefined()
  })
})
