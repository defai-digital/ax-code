import { describe, expect, test } from "vitest"
import { LatestDirectoryLoadTracker } from "./latestDirectoryLoadTracker"

describe("LatestDirectoryLoadTracker", () => {
  test("only treats the newest request for a directory as current", () => {
    const tracker = new LatestDirectoryLoadTracker()

    const stale = tracker.begin("/repo")
    const current = tracker.begin("/repo")

    expect(tracker.isCurrent(stale)).toBe(false)
    expect(tracker.isCurrent(current)).toBe(true)
  })

  test("does not let a stale completion clear the active request", () => {
    const tracker = new LatestDirectoryLoadTracker()

    const stale = tracker.begin("/repo")
    const current = tracker.begin("/repo")

    expect(tracker.complete(stale)).toBe(false)
    expect(tracker.isCurrent(current)).toBe(true)
    expect(tracker.complete(current)).toBe(true)
    expect(tracker.isCurrent(current)).toBe(false)
  })

  test("reset invalidates pending requests", () => {
    const tracker = new LatestDirectoryLoadTracker()
    const pending = tracker.begin("/repo")

    tracker.reset()

    expect(tracker.isCurrent(pending)).toBe(false)
    expect(tracker.complete(pending)).toBe(false)
  })
})
