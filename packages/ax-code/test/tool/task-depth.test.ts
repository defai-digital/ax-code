import { afterEach, describe, expect, test, vi } from "vitest"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { MessageID, SessionID } from "../../src/session/schema"
import { SessionPrompt } from "../../src/session/prompt"
import { TaskTool } from "../../src/tool/task"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

describe("tool.task depth checks", () => {
  test("surfaces parent session lookup errors instead of treating them as root sessions", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const originalGet = Session.get
        const lookupFailure = new Error("database temporarily unavailable")
        const getSpy = vi.spyOn(Session, "get").mockImplementation((async (
          ...args: Parameters<typeof originalGet>
        ) => {
          const [sessionID] = args
          if (sessionID === SessionID.make("ses_unavailable")) throw lookupFailure
          return originalGet(...args)
        }) as any)
        const promptSpy = vi.spyOn(SessionPrompt, "prompt")

        try {
          await expect(
            (await TaskTool.init()).execute(
              {
                description: "lookup task",
                prompt: "do work",
                subagent_type: "general",
              },
              {
                sessionID: SessionID.make("ses_unavailable"),
                messageID: MessageID.make("msg_unreachable"),
                callID: "",
                agent: "build",
                abort: AbortSignal.any([]),
                messages: [],
                metadata: () => {},
                ask: async () => {},
                extra: {},
              } as any,
            ),
          ).rejects.toThrow("database temporarily unavailable")

          expect(promptSpy).not.toHaveBeenCalled()
        } finally {
          getSpy.mockRestore()
          promptSpy.mockRestore()
        }
      },
    })
  })
})
