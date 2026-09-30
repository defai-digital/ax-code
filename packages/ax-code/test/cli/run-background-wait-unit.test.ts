import { expect, test } from "vitest"
import { waitForRunBackground, RunBackgroundWaitError } from "../../src/cli/cmd/run-background-wait"

test("ordinary and scheduled-only runs finish without waiting", async () => {
  let messageReads = 0
  const sdk = {
    taskQueue: {
      list: async () => ({
        data: [{ kind: "automation", payload: { parentSessionID: "ses_run" }, time: { created: Date.now() } }],
      }),
    },
    session: {
      messages: async () => {
        messageReads++
        return { data: [] }
      },
    },
  }
  const started = Date.now()
  const result = await waitForRunBackground({
    sdk: sdk as never,
    sessionID: "ses_run",
    startedAt: started,
    seconds: 1,
    signal: new AbortController().signal,
  })
  expect(result).toBeUndefined()
  expect(messageReads).toBe(0)
  expect(Date.now() - started).toBeLessThan(500)
})

test("a stalled child reports an incomplete run at the wait deadline", async () => {
  const sdk = {
    taskQueue: {
      list: async () => ({
        data: [
          {
            kind: "subagent",
            status: "running",
            payload: { source: "task", parentSessionID: "ses_run" },
            time: { created: Date.now() },
          },
        ],
      }),
    },
    session: { messages: async () => ({ data: [] }) },
  }
  await expect(
    waitForRunBackground({
      sdk: sdk as never,
      sessionID: "ses_run",
      startedAt: Date.now() - 1,
      seconds: 1,
      signal: new AbortController().signal,
    }),
  ).rejects.toBeInstanceOf(RunBackgroundWaitError)
})

test("a blocked queue read cannot outlive the background deadline", async () => {
  const sdk = {
    taskQueue: { list: async () => new Promise<never>(() => {}) },
  }
  await expect(
    waitForRunBackground({
      sdk: sdk as never,
      sessionID: "ses_run",
      startedAt: Date.now(),
      seconds: 1,
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow("Background work did not settle within 1 seconds.")
})

test("a blocked message read cannot outlive the background deadline", async () => {
  const created = Date.now()
  const sdk = {
    taskQueue: {
      list: async () => ({
        data: [
          {
            id: "tsk_one",
            kind: "subagent",
            status: "completed",
            payload: { source: "task", parentSessionID: "ses_run", deliveryStatus: "delivered" },
            time: { created },
          },
        ],
      }),
    },
    session: { messages: async () => new Promise<never>(() => {}) },
  }
  await expect(
    waitForRunBackground({
      sdk: sdk as never,
      sessionID: "ses_run",
      startedAt: created,
      seconds: 1,
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow("Background work did not settle within 1 seconds.")
})

test("parallel children require a parent answer after the last handoff", async () => {
  const created = Date.now()
  let secondAnswer = false
  const rows = ["tsk_one", "tsk_two"].map((id) => ({
    id,
    kind: "subagent",
    status: "completed",
    payload: { source: "task", parentSessionID: "ses_run", deliveryStatus: "delivered" },
    time: { created },
  }))
  const handoff = (id: string) => ({
    info: { role: "user", id: `msg_${id}` },
    parts: [{ type: "text", synthetic: true, metadata: { source: "background_subagent_handoff", taskQueueID: id } }],
  })
  const answer = (id: string) => ({ info: { role: "assistant", id, time: { completed: Date.now() } }, parts: [] })
  const sdk = {
    taskQueue: { list: async () => ({ data: rows }) },
    session: {
      messages: async () => ({
        data: [
          handoff("tsk_one"),
          answer("msg_first"),
          handoff("tsk_two"),
          ...(secondAnswer ? [answer("msg_second")] : []),
        ],
      }),
      status: async () => ({ data: { ses_run: { type: "idle" } } }),
    },
  }
  setTimeout(() => {
    secondAnswer = true
  }, 300)
  const result = await waitForRunBackground({
    sdk: sdk as never,
    sessionID: "ses_run",
    startedAt: created,
    seconds: 2,
    signal: new AbortController().signal,
  })
  expect(result).toBe("msg_second")
})

test("assistant tool-loop messages from one parent turn count as one follow-up", async () => {
  const created = Date.now()
  const taskID = "tsk_one"
  const sdk = {
    taskQueue: {
      list: async () => ({
        data: [
          {
            id: taskID,
            kind: "subagent",
            status: "completed",
            payload: { source: "task", parentSessionID: "ses_run", deliveryStatus: "delivered" },
            time: { created },
          },
        ],
      }),
    },
    session: {
      messages: async () => ({
        data: [
          {
            info: { role: "user", id: "msg_handoff" },
            parts: [
              {
                type: "text",
                synthetic: true,
                metadata: { source: "background_subagent_handoff", taskQueueID: taskID },
              },
            ],
          },
          ...Array.from({ length: 11 }, (_, index) => ({
            info: {
              role: "assistant",
              id: `msg_turn_${index}`,
              parentID: "msg_handoff",
              time: { completed: Date.now() },
            },
            parts: [],
          })),
        ],
      }),
      status: async () => ({ data: { ses_run: { type: "idle" } } }),
    },
  }

  await expect(
    waitForRunBackground({
      sdk: sdk as never,
      sessionID: "ses_run",
      startedAt: created,
      seconds: 2,
      signal: new AbortController().signal,
    }),
  ).resolves.toBe("msg_turn_10")
})

test("more than ten distinct parent follow-up turns remain bounded", async () => {
  const created = Date.now()
  const taskID = "tsk_one"
  const sdk = {
    taskQueue: {
      list: async () => ({
        data: [
          {
            id: taskID,
            kind: "subagent",
            status: "completed",
            payload: { source: "task", parentSessionID: "ses_run", deliveryStatus: "delivered" },
            time: { created },
          },
        ],
      }),
    },
    session: {
      messages: async () => ({
        data: [
          {
            info: { role: "user", id: "msg_handoff" },
            parts: [
              {
                type: "text",
                synthetic: true,
                metadata: { source: "background_subagent_handoff", taskQueueID: taskID },
              },
            ],
          },
          ...Array.from({ length: 11 }, (_, index) => ({
            info: {
              role: "assistant",
              id: `msg_turn_${index}`,
              parentID: `msg_parent_${index}`,
              time: { completed: Date.now() },
            },
            parts: [],
          })),
        ],
      }),
      status: async () => ({ data: { ses_run: { type: "idle" } } }),
    },
  }

  await expect(
    waitForRunBackground({
      sdk: sdk as never,
      sessionID: "ses_run",
      startedAt: created,
      seconds: 2,
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow("Background follow-up turn limit reached (10).")
})
