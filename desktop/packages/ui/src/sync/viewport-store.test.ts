import { beforeEach, describe, expect, test } from "vitest"
import { useViewportStore } from "./viewport-store"

describe("viewport-store sessionMemoryState", () => {
  beforeEach(() => {
    useViewportStore.setState({ sessionMemoryState: new Map(), isSyncing: false })
  })

  test("records viewport anchors per session", () => {
    useViewportStore.getState().updateViewportAnchor("ses_1", 42)
    const entry = useViewportStore.getState().sessionMemoryState.get("ses_1")
    expect(entry?.viewportAnchor).toBe(42)
  })

  test("caps the map and evicts the least-recently-accessed sessions", () => {
    const { updateViewportAnchor } = useViewportStore.getState()
    // Insert 250 distinct sessions; oldest-inserted are also least-recently
    // accessed, so they must be the ones evicted down to the 200 cap.
    for (let i = 0; i < 250; i++) {
      updateViewportAnchor(`ses_${i}`, i)
    }

    const map = useViewportStore.getState().sessionMemoryState
    expect(map.size).toBe(200)
    // First 50 evicted, most recent retained.
    expect(map.has("ses_0")).toBe(false)
    expect(map.has("ses_49")).toBe(false)
    expect(map.has("ses_50")).toBe(true)
    expect(map.has("ses_249")).toBe(true)
  })

  test("evicts the full excess when the map starts far over cap (single update)", () => {
    // Seed the map well past the cap (as a persist rehydration would), then do
    // ONE update. Eviction must bring it all the way down to the cap — a loop
    // bound that re-reads the shrinking map.size would only remove half.
    const seeded = new Map()
    for (let i = 0; i < 300; i++) {
      seeded.set(`old_${i}`, {
        viewportAnchor: i,
        isStreaming: false,
        lastAccessedAt: i, // ascending → old_0 is least-recently accessed
        backgroundMessageCount: 0,
      })
    }
    useViewportStore.setState({ sessionMemoryState: seeded })

    useViewportStore.getState().updateViewportAnchor("fresh", 1)

    const map = useViewportStore.getState().sessionMemoryState
    expect(map.size).toBe(200)
    expect(map.has("fresh")).toBe(true)
    expect(map.has("old_0")).toBe(false)
  })
})
