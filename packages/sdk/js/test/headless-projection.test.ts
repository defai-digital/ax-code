import { describe, expect, test } from "vitest"
import { applyHeadlessProjectionEvent, createHeadlessProjectionState, type HeadlessRuntimeEvent } from "../src/headless.js"

const send = (state: unknown, event: unknown) =>
  applyHeadlessProjectionEvent(state as never, event as HeadlessRuntimeEvent)

describe("headless projection complete snapshots", () => {
  test("a complete snapshot that drops a field clears it", () => {
    const state = createHeadlessProjectionState<{ id: string; title?: string; revert?: { messageID: string } }>()

    send(state, {
      type: "session.updated",
      properties: { info: { id: "sess-1", title: "app", revert: { messageID: "msg-9" } } },
    })
    expect(state.session[0]?.revert).toEqual({ messageID: "msg-9" })

    // JSON omits cleared optional fields, so the absent key must delete it.
    send(state, { type: "session.updated", properties: { info: { id: "sess-1", title: "app" } } })
    expect(Object.prototype.hasOwnProperty.call(state.session[0]!, "revert")).toBe(false)
  })

  test("the projected task queue is bounded newest-biased", () => {
    const state = createHeadlessProjectionState()
    for (let i = 0; i < 520; i++) {
      send(state, { type: "task.queue.created", properties: { item: { id: `tsk_${String(i).padStart(4, "0")}` } } })
    }
    expect(state.task_queue).toHaveLength(500)
    // The 20 lowest ids are evicted; the newest remain.
    expect(state.task_queue[0]?.id).toBe("tsk_0020")
    expect(state.task_queue.at(-1)?.id).toBe("tsk_0519")
  })
})
