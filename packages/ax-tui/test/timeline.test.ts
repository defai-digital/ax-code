import { afterEach, expect, test, vi } from "vitest"
import { Timeline, createTimeline, engine } from "../src/animation/Timeline.js"

afterEach(() => {
  engine.clear()
  engine.detach()
})

test("paused parents cannot start a scheduled child", () => {
  const target = { x: 0 }
  const parent = new Timeline({ autoplay: false })
  const child = new Timeline({ autoplay: false }).add(target, { x: 10, duration: 100 })
  parent.sync(child, 10)
  parent.update(50)
  expect(child.isPlaying).toBe(false)
  expect(child.currentTime).toBe(0)
  expect(target.x).toBe(0)
})

test("sync rejects self references and ancestor cycles", () => {
  const a = new Timeline()
  const b = new Timeline()
  expect(() => a.sync(a)).toThrow(/cyc/i)
  a.sync(b)
  expect(() => b.sync(a)).toThrow(/cyc/i)
})

test("attaching the engine activates already running timelines", () => {
  createTimeline()
  const renderer = { setFrameCallback: vi.fn(), removeFrameCallback: vi.fn(), requestLive: vi.fn(), dropLive: vi.fn() }
  engine.attach(renderer as never)
  expect(renderer.requestLive).toHaveBeenCalledOnce()
  engine.detach()
  expect(renderer.dropLive).toHaveBeenCalledOnce()
})

test("parent duration caps child progress and callbacks on an overshooting frame", () => {
  const target = { x: 0 }
  const child = new Timeline({ duration: 1000 }).add(target, { x: 100, duration: 1000 })
  const beyondEnd = vi.fn()
  const parent = new Timeline({ duration: 100 }).sync(child).call(beyondEnd, 150).play()
  parent.update(200)
  expect(parent.currentTime).toBe(100)
  expect(child.currentTime).toBe(100)
  expect(target.x).toBe(10)
  expect(beyondEnd).not.toHaveBeenCalled()
})

test("loop overshoot advances children from the next cycle's origin", () => {
  const target = { x: 0 }
  const child = new Timeline({ duration: 100 }).add(target, { x: 10, duration: 100 })
  const callback = vi.fn()
  const parent = new Timeline({ duration: 100, loop: true }).sync(child).call(callback, 20).play()
  parent.update(125)
  expect(parent.currentTime).toBe(25)
  expect(child.currentTime).toBe(25)
  expect(target.x).toBe(2.5)
  expect(callback).toHaveBeenCalledTimes(2)
  parent.pause()
  parent.update(50)
  expect(child.currentTime).toBe(25)
  parent.play().update(25)
  expect(child.currentTime).toBe(50)
  expect(target.x).toBe(5)
})

test("syncing the only running timeline to a paused parent releases live rendering", () => {
  const child = createTimeline()
  const renderer = { setFrameCallback: vi.fn(), removeFrameCallback: vi.fn(), requestLive: vi.fn(), dropLive: vi.fn() }
  engine.attach(renderer as never)
  expect(renderer.requestLive).toHaveBeenCalledOnce()
  new Timeline({ autoplay: false }).sync(child)
  expect(renderer.dropLive).toHaveBeenCalledOnce()
})

test("resuming a parent preserves completed children until an explicit restart", () => {
  const target = { x: 0 }
  const onComplete = vi.fn()
  const child = new Timeline({ duration: 100, onComplete }).add(target, { x: 10, duration: 100 })
  const parent = new Timeline({ duration: 1000 }).sync(child).play()
  parent.update(200)
  expect(child.isComplete).toBe(true)
  expect(onComplete).toHaveBeenCalledOnce()

  parent.pause().play()
  parent.update(50)
  expect(child.isComplete).toBe(true)
  expect(child.currentTime).toBe(100)
  expect(target.x).toBe(10)
  expect(onComplete).toHaveBeenCalledOnce()

  parent.restart().update(50)
  expect(child.isComplete).toBe(false)
  expect(child.currentTime).toBe(50)
  expect(target.x).toBe(5)
  parent.update(50)
  expect(onComplete).toHaveBeenCalledTimes(2)
})

test.each([
  { loop: 1, alternate: false, endTime: 100, endValue: 10 },
  { loop: 2, alternate: true, endTime: 250, endValue: 0 },
])(
  "once animations finish at the final duration without requiring a callback: $loop loops",
  ({ loop, alternate, endTime, endValue }) => {
    const target = { x: 0 }
    const timeline = new Timeline({ duration: 1000 })
      .once(target, { x: 10, duration: 100, loopDelay: 50, loop, alternate })
      .play()
    timeline.update(endTime - 1)
    expect(timeline.items).toHaveLength(1)
    timeline.update(1)
    expect(target.x).toBe(endValue)
    expect(timeline.items).toHaveLength(0)
  },
)

test("an explicit zero duration completes immediately instead of falling back to 1000", () => {
  const onComplete = vi.fn()
  const timeline = new Timeline({ duration: 0, onComplete }).play()
  timeline.update(0)
  expect(timeline.isComplete).toBe(true)
  expect(onComplete).toHaveBeenCalledOnce()
})

test("a zero-duration looping timeline does not recurse forever on an update", () => {
  const timeline = new Timeline({ duration: 0, loop: true }).play()
  expect(() => timeline.update(10)).not.toThrow()
})

test("numeric string start times resolve to their offset in add and call", () => {
  const target = { x: 0 }
  const callback = vi.fn()
  const timeline = new Timeline({ autoplay: false })
    .add(target, { x: 10, duration: 100 }, "200")
    .call(callback, "500")
  timeline.play()
  timeline.update(199)
  expect(target.x).toBe(0)
  expect(callback).not.toHaveBeenCalled()
  timeline.update(1)
  expect(target.x).toBe(0)
  timeline.update(50)
  expect(target.x).toBe(5)
  expect(callback).not.toHaveBeenCalled()
  timeline.update(250)
  expect(target.x).toBe(10)
  expect(callback).toHaveBeenCalledOnce()
})

test("unparseable string start times fall back to the start of the timeline", () => {
  const callback = vi.fn()
  const timeline = new Timeline({ autoplay: false }).call(callback, "later")
  timeline.play()
  timeline.update(0)
  expect(callback).toHaveBeenCalledOnce()
})

test("looping timelines replay callbacks in every crossed cycle", () => {
  const callback = vi.fn()
  const timeline = new Timeline({ duration: 1000, loop: true }).call(callback, 800).play()
  timeline.update(2500)
  expect(callback).toHaveBeenCalledTimes(2)
  expect(timeline.currentTime).toBe(500)
})
