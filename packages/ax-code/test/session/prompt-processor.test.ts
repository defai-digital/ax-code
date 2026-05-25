import { describe, expect, spyOn, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { InstructionPrompt } from "../../src/session/instruction"
import type { MessageV2 } from "../../src/session/message-v2"
import { clearPromptProcessorInstructions, createPromptProcessor } from "../../src/session/prompt-processor"
import { MessageID, SessionID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

function userMessage(input?: { sessionID?: string }): MessageV2.User {
  return {
    id: MessageID.ascending(),
    sessionID: (input?.sessionID ?? SessionID.descending()) as any,
    role: "user",
    time: { created: 1 },
    agent: "build",
    variant: "primary",
    model: {
      providerID: "openai" as any,
      modelID: "gpt-5.2" as any,
    },
  } as MessageV2.User
}

describe("createPromptProcessor", () => {
  test("creates an assistant message before constructing the processor", async () => {
    await using tmp = await tmpdir({ git: true })
    const sessionID = SessionID.descending()
    const user = userMessage({ sessionID })
    const model = {
      id: "gpt-5.2" as any,
      providerID: "openai" as any,
    }
    const update = spyOn(Session, "updateMessage").mockImplementation((async (message: any) => message) as any)
    const now = spyOn(Date, "now").mockReturnValue(123)
    try {
      const processor = await Instance.provide({
        directory: tmp.path,
        fn: () =>
          createPromptProcessor({
            sessionID,
            lastUser: user,
            agent: { name: "build" } as any,
            model: model as any,
            abort: new AbortController().signal,
            messages: [],
          }),
      })

      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          parentID: user.id,
          role: "assistant",
          mode: "build",
          agent: "build",
          variant: "primary",
          modelID: model.id,
          providerID: model.providerID,
          sessionID,
          time: { created: 123 },
        }),
      )
      expect(processor.message.parentID).toBe(user.id)
      expect(processor.message.path.cwd).toBe(tmp.path)
    } finally {
      update.mockRestore()
      now.mockRestore()
    }
  })

  test("clears instruction prompt state for the processor message", () => {
    const clear = spyOn(InstructionPrompt, "clear").mockImplementation(() => {})
    try {
      clearPromptProcessorInstructions({ message: { id: "msg_test" } } as any)
      expect(clear).toHaveBeenCalledWith("msg_test")
    } finally {
      clear.mockRestore()
    }
  })
})
