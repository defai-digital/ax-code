import { describe, expect, test } from "vitest"
import z from "zod"
import { Tool } from "../../src/tool/tool"

describe("Tool.define", () => {
  test("formats unprintable validation failures safely", async () => {
    const failure = {
      toString() {
        throw new Error("cannot print")
      },
    }
    const tool = Tool.define("validate", {
      description: "validates with an unprintable failure",
      parameters: {
        parse() {
          throw failure
        },
      } as unknown as z.ZodTypeAny,
      async execute() {
        return {
          title: "ok",
          metadata: {},
          output: "ok",
        }
      },
    })
    const info = await tool.init()

    await expect(
      info.execute({}, {
        sessionID: "ses_test",
        messageID: "msg_test",
        agent: "build",
        abort: new AbortController().signal,
        messages: [],
        metadata() {},
        async ask() {},
      } as unknown as Parameters<typeof info.execute>[1]),
    ).rejects.toThrow("The validate tool was called with invalid arguments: Unknown error.")
  })

  test("preserves unprintable tool execution failures", async () => {
    const failure = {
      toString() {
        throw new Error("cannot print")
      },
    }
    const tool = Tool.define("explode", {
      description: "throws an unprintable value",
      parameters: z.object({}),
      async execute() {
        throw failure
      },
    })
    const info = await tool.init()

    await expect(
      info.execute({}, {
        sessionID: "ses_test",
        messageID: "msg_test",
        agent: "build",
        abort: new AbortController().signal,
        messages: [],
        metadata() {},
        async ask() {},
      } as unknown as Parameters<typeof info.execute>[1]),
    ).rejects.toBe(failure)
  })
})
