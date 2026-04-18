import { describe, expect, test } from "bun:test"
import { createEventQueue } from "../../../src/cli/cmd/tui/state/event-queue"
import { createTuiStateStore } from "../../../src/cli/cmd/tui/state/store"

describe("tui headless event queue", () => {
  test("coalesces adjacent deltas for the same target", () => {
    const queue = createEventQueue({ maxDepth: 4 })

    queue.enqueue({
      type: "part.delta.received",
      sessionID: "ses_1",
      messageID: "msg_1",
      partID: "part_1",
      field: "text",
      delta: "A",
    })
    queue.enqueue({
      type: "part.delta.received",
      sessionID: "ses_1",
      messageID: "msg_1",
      partID: "part_1",
      field: "text",
      delta: "BC",
    })

    const flushed = queue.flush()
    expect(flushed).toEqual([
      {
        type: "part.delta.received",
        sessionID: "ses_1",
        messageID: "msg_1",
        partID: "part_1",
        field: "text",
        delta: "ABC",
      },
    ])
    expect(queue.snapshot()).toEqual({
      pending: 0,
      dropped: 0,
      coalesced: 1,
      maxDepth: 4,
    })
  })

  test("caps queue depth during delta storms", () => {
    const queue = createEventQueue({ maxDepth: 2 })

    queue.enqueue({
      type: "part.delta.received",
      sessionID: "ses_1",
      messageID: "msg_1",
      partID: "part_1",
      field: "text",
      delta: "A",
    })
    queue.enqueue({
      type: "part.delta.received",
      sessionID: "ses_1",
      messageID: "msg_1",
      partID: "part_2",
      field: "text",
      delta: "B",
    })
    queue.enqueue({
      type: "part.delta.received",
      sessionID: "ses_1",
      messageID: "msg_1",
      partID: "part_3",
      field: "text",
      delta: "C",
    })

    expect(queue.snapshot()).toEqual({
      pending: 2,
      dropped: 1,
      coalesced: 0,
      maxDepth: 2,
    })
    expect(queue.flush().map((item) => item.partID)).toEqual(["part_2", "part_3"])
  })

  test("reports queue pressure through the external store snapshot", () => {
    const store = createTuiStateStore({ maxQueuedDeltas: 2 })

    store.dispatch({
      type: "part.delta.received",
      sessionID: "ses_1",
      messageID: "msg_1",
      partID: "part_1",
      field: "text",
      delta: "A",
    })
    store.dispatch({
      type: "part.delta.received",
      sessionID: "ses_1",
      messageID: "msg_1",
      partID: "part_2",
      field: "text",
      delta: "B",
    })
    store.dispatch({
      type: "part.delta.received",
      sessionID: "ses_1",
      messageID: "msg_1",
      partID: "part_3",
      field: "text",
      delta: "C",
    })

    expect(store.getSnapshot().eventQueue).toEqual({
      pending: 2,
      dropped: 1,
      coalesced: 0,
      maxDepth: 2,
    })
  })

  test("flushes queued deltas on the next microtask", async () => {
    const store = createTuiStateStore({
      initial: {
        message: {
          ses_1: [
            {
              id: "msg_1",
              sessionID: "ses_1",
              role: "assistant",
              parentID: "msg_0",
              agent: "codex",
              modelID: "gpt-5.4",
              providerID: "openai",
              mode: "chat",
              path: { cwd: "/repo", root: "/repo" },
              tokens: {
                input: 0,
                output: 0,
                reasoning: 0,
                cache: { read: 0, write: 0 },
              },
              time: { created: 1 },
            },
          ],
        },
        part: {
          msg_1: [
            {
              id: "part_1",
              sessionID: "ses_1",
              messageID: "msg_1",
              type: "text",
              text: "A",
            },
          ],
        },
      },
    })

    store.dispatch({
      type: "part.delta.received",
      sessionID: "ses_1",
      messageID: "msg_1",
      partID: "part_1",
      field: "text",
      delta: "BC",
    })
    expect(store.getSnapshot().part.msg_1?.[0]).toMatchObject({ text: "A" })

    await Promise.resolve()

    expect(store.getSnapshot().part.msg_1?.[0]).toMatchObject({ text: "ABC" })
    expect(store.getSnapshot().eventQueue.pending).toBe(0)
  })
})
