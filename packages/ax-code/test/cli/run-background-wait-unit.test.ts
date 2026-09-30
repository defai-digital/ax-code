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
