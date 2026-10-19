import { describe, expect, test } from "vitest"
import {
  captureScrollAnchor,
  restoreScrollAfterPrepend,
  restoredScrollTop,
} from "../../../src/cli/tui/routes/session/history-scroll-anchor"

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

function fakeScroll(top: number, height: number) {
  return {
    scrollTop: top,
    scrollHeight: height,
    calls: [] as number[],
    scrollTo(next: number) {
      this.calls.push(next)
    },
  }
}

function manualScheduler() {
  type Task = { run: () => void; cancelled: boolean }
  const queue: Task[] = []
  const delays: number[] = []
  return {
    delays,
    schedule(fn: () => void, delayMs: number) {
      const task: Task = { run: fn, cancelled: false }
      queue.push(task)
      delays.push(delayMs)
      return () => {
        task.cancelled = true
      }
    },
    runNext() {
      while (queue.length > 0) {
        const task = queue.shift()
        if (!task || task.cancelled) continue
        task.run()
        return true
      }
      return false
    },
    runAll() {
      let guard = 0
      while (this.runNext()) {
        if (++guard > 20) throw new Error("scheduler did not stop")
      }
    },
  }
}

describe("restoreScrollAfterPrepend", () => {
  test("scrolls once the content height changes on the third poll", () => {
    const anchor = captureScrollAnchor({ scrollTop: 40, scrollHeight: 200, viewport: { height: 50 } })
    const scroll = fakeScroll(40, 200)
    const scheduler = manualScheduler()
    let polls = 0
    restoreScrollAfterPrepend({
      scroll,
      anchor,
      isCurrent: () => true,
      schedule: (fn, delayMs) =>
        scheduler.schedule(() => {
          polls++
          if (polls === 3) scroll.scrollHeight = 260
          fn()
        }, delayMs),
    })
    scheduler.runAll()
    expect(polls).toBe(3)
    expect(scroll.calls).toEqual([100])
    expect(scheduler.delays).toEqual([25, 25, 25])
  })

  test("does not scroll when the user moved", () => {
    const anchor = captureScrollAnchor({ scrollTop: 40, scrollHeight: 200, viewport: { height: 50 } })
    const scroll = fakeScroll(40, 200)
    const scheduler = manualScheduler()
    restoreScrollAfterPrepend({
      scroll,
      anchor,
      isCurrent: () => true,
      schedule: (fn, delayMs) =>
        scheduler.schedule(() => {
          scroll.scrollTop = 55
          scroll.scrollHeight = 260
          fn()
        }, delayMs),
    })
    scheduler.runAll()
    expect(scroll.calls).toEqual([])
  })

  test("gives up after the attempt budget when the height never changes", () => {
    const anchor = captureScrollAnchor({ scrollTop: 40, scrollHeight: 200, viewport: { height: 50 } })
    const scroll = fakeScroll(40, 200)
    const scheduler = manualScheduler()
    let polls = 0
    restoreScrollAfterPrepend({
      scroll,
      anchor,
      isCurrent: () => true,
      schedule: (fn, delayMs) =>
        scheduler.schedule(() => {
          polls++
          fn()
        }, delayMs),
    })
    scheduler.runAll()
    expect(polls).toBe(8)
    expect(scroll.calls).toEqual([40])
    expect(scheduler.delays).toHaveLength(8)
  })

  test("cancel stops polling", () => {
    const anchor = captureScrollAnchor({ scrollTop: 40, scrollHeight: 200, viewport: { height: 50 } })
    const scroll = fakeScroll(40, 200)
    const scheduler = manualScheduler()
    let polls = 0
    const cancel = restoreScrollAfterPrepend({
      scroll,
      anchor,
      isCurrent: () => true,
      schedule: (fn, delayMs) =>
        scheduler.schedule(() => {
          polls++
          fn()
        }, delayMs),
    })
    scheduler.runNext()
    expect(polls).toBe(1)
    cancel()
    scheduler.runAll()
    expect(polls).toBe(1)
    expect(scroll.calls).toEqual([])
  })
})
