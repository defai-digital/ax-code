import { describe, expect, test } from "vitest"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { createAutonomousTextContinuation, createUserMessage } from "../../src/session/prompt-user-message"
import { tmpdir } from "../fixture/fixture"

describe("prompt user message helpers", () => {
  test("autonomous text continuations preserve the previous user agent and model", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          build: {
            model: "openai/gpt-5.2",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const first = await createUserMessage({
          sessionID: session.id,
          agent: "build",
          model: {
            providerID: "openai" as any,
            modelID: "gpt-5.2" as any,
          },
          parts: [{ type: "text", text: "start" }],
        })

        await createAutonomousTextContinuation({
          sessionID: session.id,
          messages: [first],
          text: "continue",
        })

        const messages = await Session.messages({ sessionID: session.id })
        const users = messages.filter((message) => message.info.role === "user")
        expect(users).toHaveLength(2)
        expect(users[1]!.info).toMatchObject({
          agent: "build",
          model: {
            providerID: "openai",
            modelID: "gpt-5.2",
          },
        })
        expect(users[1]!.parts).toEqual([expect.objectContaining({ type: "text", text: "continue" })])
      },
    })
  })
})

describe("prompt user message agent model fallback", () => {
  test("an agent pinned to a disabled provider falls back instead of failing", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        disabled_providers: ["deepseek"],
        agent: {
          build: {
            model: "deepseek/deepseek-v4-pro",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const message = await createUserMessage({
          sessionID: session.id,
          agent: "build",
          parts: [{ type: "text", text: "start" }],
        })
        expect(message.info.agent).toBe("build")
        expect(message.info.model.providerID).not.toBe("deepseek")
        expect(message.info.model.modelID).toBeTruthy()
      },
    })
  })
})
