import { describe, expect, test } from "vitest"
import type { MessageV2 } from "../../src/session/message-v2"
import { resolvePromptLoopResult } from "../../src/session/prompt-loop-result"
import { SessionID } from "../../src/session/schema"

function message(role: "user" | "assistant", id: string): MessageV2.WithParts {
  return {
    info: {
      id,
      role,
      sessionID: "ses_test",
    },
    parts: [],
  } as any
}

async function* stream(items: MessageV2.WithParts[]) {
  for (const item of items) yield item
}

describe("resolvePromptLoopResult", () => {
  test("returns the first non-user message and resolves a queued callback", async () => {
    const sessionID = SessionID.descending()
    const assistant = message("assistant", "msg_assistant")
    let pruned = false
    let resolved: MessageV2.WithParts | undefined

    const result = await resolvePromptLoopResult(
      {
        sessionID,
        abort: new AbortController().signal,
        resumeExisting: true,
        drainJoinerCallbacks: () => [],
        shiftQueuedCallback: () => ({
          resolve(message) {
            resolved = message
          },
        }),
      },
      {
        prune: async () => {
          pruned = true
        },
        stream: (() => stream([message("user", "msg_user"), assistant])) as any,
      },
    )

    expect(pruned).toBe(true)
    expect(result).toBe(assistant)
    expect(resolved).toBe(assistant)
  })

  test("resolves joiner callbacks without shifting the queued prompts", async () => {
    const sessionID = SessionID.descending()
    const assistant = message("assistant", "msg_assistant")
    const joined: MessageV2.WithParts[] = []
    let shifted = false

    const result = await resolvePromptLoopResult(
      {
        sessionID,
        abort: new AbortController().signal,
        resumeExisting: false,
        drainJoinerCallbacks: () => [
          { resolve: (message) => joined.push(message) },
          { resolve: (message) => joined.push(message) },
        ],
        shiftQueuedCallback: () => {
          shifted = true
          return undefined
        },
      },
      {
        prune: async () => {},
        stream: (() => stream([assistant])) as any,
      },
    )

    expect(result).toBe(assistant)
    expect(joined).toEqual([assistant, assistant])
    expect(shifted).toBe(false)
  })

  test("throws AbortError when no assistant message exists and the run was aborted", async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      resolvePromptLoopResult(
        {
          sessionID: SessionID.descending(),
          abort: controller.signal,
          resumeExisting: false,
          drainJoinerCallbacks: () => [],
          shiftQueuedCallback: () => undefined,
        },
        {
          prune: async () => {},
          stream: (() => stream([message("user", "msg_user")])) as any,
        },
      ),
    ).rejects.toThrow("Aborted")
  })

  test("ignores stale assistant messages when an exact turn message is expected", async () => {
    const current = message("assistant", "msg_current")

    const result = await resolvePromptLoopResult(
      {
        sessionID: SessionID.descending(),
        abort: new AbortController().signal,
        expectedMessageID: current.info.id,
        resumeExisting: false,
        drainJoinerCallbacks: () => [],
        shiftQueuedCallback: () => undefined,
      },
      {
        prune: async () => {},
        stream: (() => stream([message("assistant", "msg_stale"), current])) as any,
      },
    )

    expect(result).toBe(current)
  })
})
