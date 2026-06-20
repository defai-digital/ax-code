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

  test("throws AbortError when no assistant message exists and the run was aborted", async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      resolvePromptLoopResult(
        {
          sessionID: SessionID.descending(),
          abort: controller.signal,
          shiftQueuedCallback: () => undefined,
        },
        {
          prune: async () => {},
          stream: (() => stream([message("user", "msg_user")])) as any,
        },
      ),
    ).rejects.toThrow("Aborted")
  })
})
