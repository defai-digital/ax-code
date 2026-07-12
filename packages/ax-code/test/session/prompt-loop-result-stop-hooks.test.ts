import { describe, expect, test, vi } from "vitest"
import { resolvePromptLoopResult } from "../../src/session/prompt-loop-result"
import type { SessionID } from "../../src/session/schema"

describe("resolvePromptLoopResult Stop hooks", () => {
  test("fires LifecycleHooks Stop when the prompt loop returns an assistant message", async () => {
    const sessionID = "ses_test_stop_hooks" as SessionID
    const runStopHooks = vi.fn(async () => ({ ok: true, blocked: false, outputs: [] }))
    const assistant = {
      info: { role: "assistant" as const, id: "msg_1", sessionID },
      parts: [],
    }

    async function* stream() {
      yield {
        info: { role: "user" as const, id: "msg_0", sessionID },
        parts: [],
      }
      yield assistant
    }

    const result = await resolvePromptLoopResult(
      {
        sessionID,
        abort: new AbortController().signal,
        shiftQueuedCallback: () => undefined,
      },
      {
        prune: async () => undefined,
        stream: stream as any,
        runStopHooks: runStopHooks as any,
      },
    )

    expect(result.info.role).toBe("assistant")
    expect(runStopHooks).toHaveBeenCalledTimes(1)
    expect(runStopHooks).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "Stop",
        sessionID,
      }),
    )
  })

  test("does not fail the turn when Stop hooks throw", async () => {
    const sessionID = "ses_test_stop_hooks_err" as SessionID
    async function* stream() {
      yield {
        info: { role: "assistant" as const, id: "msg_1", sessionID },
        parts: [],
      }
    }
    const result = await resolvePromptLoopResult(
      {
        sessionID,
        abort: new AbortController().signal,
        shiftQueuedCallback: () => undefined,
      },
      {
        prune: async () => undefined,
        stream: stream as any,
        runStopHooks: async () => {
          throw new Error("hook boom")
        },
      },
    )
    expect(result.info.role).toBe("assistant")
  })
})
