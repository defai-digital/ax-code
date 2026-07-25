import { beforeEach, describe, expect, it } from "vitest"
import { MESSAGE_QUEUE_MAX_PER_SESSION, useMessageQueueStore } from "./messageQueueStore"

describe("messageQueueStore", () => {
  beforeEach(() => {
    useMessageQueueStore.getState().clearAllQueues()
  })

  it("clearSessions drops queues for deleted sessions only", () => {
    useMessageQueueStore.getState().addToQueue("ses_deleted", { content: "stale" })
    useMessageQueueStore.getState().addToQueue("ses_kept", { content: "live" })

    useMessageQueueStore.getState().clearSessions(["ses_deleted", "ses_unknown"])

    expect(useMessageQueueStore.getState().getQueueForSession("ses_deleted")).toHaveLength(0)
    expect(useMessageQueueStore.getState().queuedMessages["ses_deleted"]).toBeUndefined()
    expect(useMessageQueueStore.getState().getQueueForSession("ses_kept")).toHaveLength(1)
  })

  it("caps per-session queue length at MESSAGE_QUEUE_MAX_PER_SESSION", () => {
    const sessionId = "ses_cap"
    for (let i = 0; i < MESSAGE_QUEUE_MAX_PER_SESSION + 10; i++) {
      useMessageQueueStore.getState().addToQueue(sessionId, { content: `msg-${i}` })
    }
    const queue = useMessageQueueStore.getState().getQueueForSession(sessionId)
    expect(queue).toHaveLength(MESSAGE_QUEUE_MAX_PER_SESSION)
    // Oldest entries dropped; newest retained.
    expect(queue[0]?.content).toBe("msg-10")
    expect(queue[queue.length - 1]?.content).toBe(`msg-${MESSAGE_QUEUE_MAX_PER_SESSION + 9}`)
  })
})
