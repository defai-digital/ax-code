import { describe, expect, test } from "vitest"
import { stringWidth } from "../../../src/bun/node-compat"
import {
  isTranscriptEscape,
  transcriptFollowLabel,
  updateTranscriptFollow,
} from "../../../src/cli/tui/routes/session/transcript-follow"

const initial = { sessionID: "a", away: false, unread: false }
const reading = { scrollTop: 20, scrollHeight: 100, viewportHeight: 25 }

describe("transcript follow", () => {
  test("scrolling away shows a return affordance without inventing new activity", () => {
    expect(updateTranscriptFollow(initial, "a", reading)).toEqual({ sessionID: "a", away: true, unread: false })
    expect(updateTranscriptFollow(initial, "a", { ...reading, scrollTop: 74 }).away).toBe(true)
  })
  test("same-height streaming and tool updates mark unread only in the visible session", () => {
    const away = updateTranscriptFollow(initial, "a", reading)
    expect(updateTranscriptFollow(away, "a", reading, "b")).toBe(away)
    const unread = updateTranscriptFollow(away, "a", reading, "a")
    expect(unread.unread).toBe(true)
    expect(updateTranscriptFollow(unread, "a", reading)).toBe(unread)
    expect(reading.scrollTop).toBe(20)
  })
  test("resize and history prepend do not create unread output", () => {
    const away = updateTranscriptFollow(initial, "a", reading)
    expect(updateTranscriptFollow(away, "a", { ...reading, viewportHeight: 15 }).unread).toBe(false)
    expect(updateTranscriptFollow(away, "a", { ...reading, scrollHeight: 200, scrollTop: 120 }).unread).toBe(false)
  })
  test("bottom arrival clears unread, and subsequent live output at bottom stays read", () => {
    const unread = updateTranscriptFollow(initial, "a", reading, "a")
    const bottom = { ...reading, scrollTop: 75 }
    expect(updateTranscriptFollow(unread, "a", bottom)).toEqual(initial)
    expect(updateTranscriptFollow(initial, "a", bottom, "a")).toBe(initial)
  })
  test("navigation, empty, destroyed and zero-height viewports clear old activity", () => {
    const unread = updateTranscriptFollow(initial, "a", reading, "a")
    expect(updateTranscriptFollow(unread, "b", reading, "a")).toEqual({ sessionID: "b", away: true, unread: false })
    for (const viewport of [undefined, { ...reading, scrollHeight: 10 }, { ...reading, viewportHeight: 0 }]) {
      expect(updateTranscriptFollow(unread, "a", viewport)).toEqual(initial)
    }
  })
  test("only unmodified Escape returns to the transcript end", () => {
    expect(isTranscriptEscape({ name: "escape" })).toBe(true)
    expect(isTranscriptEscape({ name: "end" })).toBe(false)
    for (const modifier of ["ctrl", "meta", "shift", "option", "super", "hyper"]) {
      expect(isTranscriptEscape({ name: "escape", [modifier]: true })).toBe(false)
    }
  })
  test("localized labels fit narrow terminals without losing the return arrow", () => {
    for (const columns of [0, 1, 8, 9, 20, 40, 80]) {
      for (const unread of [false, true]) {
        const label = transcriptFollowLabel({ columns, unread, activity: "有新動態", bottom: "回到底部" })
        expect(stringWidth(label)).toBeLessThanOrEqual(columns)
        if (columns > 0) expect(label).toContain("↓")
      }
    }
    expect(
      transcriptFollowLabel({ columns: 80, unread: true, activity: "New activity", bottom: "Back to bottom" }),
    ).toBe("New activity · ↓ Back to bottom · esc")
  })
})
