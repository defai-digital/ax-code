import { describe, expect, test } from "vitest"

import { createTurnCompleteTracker } from "../../../src/cli/cmd/tui/util/turn-complete-tracker"

describe("createTurnCompleteTracker", () => {
  test("fires on busy -> idle for the viewed session", () => {
    const tracker = createTurnCompleteTracker()
    expect(tracker.update("s1", "busy")).toBeUndefined()
    expect(tracker.update("s1", "idle")).toBe("turn-complete:s1:1")
  })

  test("fires on retry -> idle", () => {
    const tracker = createTurnCompleteTracker()
    expect(tracker.update("s1", "retry")).toBeUndefined()
    expect(tracker.update("s1", "idle")).toBe("turn-complete:s1:1")
  })

  test("does not fire for an already-idle session on first observation", () => {
    const tracker = createTurnCompleteTracker()
    expect(tracker.update("s1", "idle")).toBeUndefined()
  })

  test("does not fire on repeated updates with an unchanged status", () => {
    const tracker = createTurnCompleteTracker()
    expect(tracker.update("s1", "busy")).toBeUndefined()
    expect(tracker.update("s1", "busy")).toBeUndefined()
    expect(tracker.update("s1", "busy")).toBeUndefined()
    expect(tracker.update("s1", "idle")).toBe("turn-complete:s1:1")
    expect(tracker.update("s1", "idle")).toBeUndefined()
  })

  test("emits a unique key per busy -> idle transition", () => {
    const tracker = createTurnCompleteTracker()
    tracker.update("s1", "busy")
    const first = tracker.update("s1", "idle")
    tracker.update("s1", "busy")
    const second = tracker.update("s1", "idle")
    expect(first).toBe("turn-complete:s1:1")
    expect(second).toBe("turn-complete:s1:2")
  })

  test("does not mis-fire when switching from a busy session to an idle one", () => {
    const tracker = createTurnCompleteTracker()
    tracker.update("s1", "busy")
    // Route switch: the previously viewed session's busy status must not
    // count as "was working" for the newly viewed session.
    expect(tracker.update("s2", "idle")).toBeUndefined()
  })

  test("tracks the new session after a switch", () => {
    const tracker = createTurnCompleteTracker()
    tracker.update("s1", "busy")
    expect(tracker.update("s2", "busy")).toBeUndefined()
    expect(tracker.update("s2", "idle")).toBe("turn-complete:s2:1")
  })

  test("resets the baseline on non-session routes", () => {
    const tracker = createTurnCompleteTracker()
    tracker.update("s1", "busy")
    expect(tracker.update(undefined, undefined)).toBeUndefined()
    // Back on the same session: busy again, then idle still fires.
    expect(tracker.update("s1", "busy")).toBeUndefined()
    expect(tracker.update("s1", "idle")).toBe("turn-complete:s1:1")
  })

  test("does not fire when the status entry disappears between busy and idle", () => {
    const tracker = createTurnCompleteTracker()
    tracker.update("s1", "busy")
    // session_status entry deleted from the map: status reads as undefined.
    expect(tracker.update("s1", undefined)).toBeUndefined()
    expect(tracker.update("s1", "idle")).toBeUndefined()
  })

  test("keys never collide across sessions", () => {
    const tracker = createTurnCompleteTracker()
    tracker.update("s1", "busy")
    const first = tracker.update("s1", "idle")
    tracker.update("s2", "busy")
    const second = tracker.update("s2", "idle")
    expect(first).not.toBe(second)
  })
})
