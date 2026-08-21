import { describe, expect, test } from "vitest"
import { z } from "zod"
import { tool, type ToolContext } from "../src/tool.js"

const context: ToolContext = {
  sessionID: "sess_test",
  messageID: "msg_test",
  agent: "build",
  directory: "/tmp/project",
  worktree: "/tmp/project",
  abort: new AbortController().signal,
  metadata() {},
  async ask() {},
}

describe("tool", () => {
  test("preserves description, args, and execute unchanged", async () => {
    const args = { foo: tool.schema.string().describe("foo") }
    const definition = tool({
      description: "This is a custom tool",
      args,
      async execute(input) {
        return `Hello ${input.foo}!`
      },
    })
    expect(definition.description).toBe("This is a custom tool")
    expect(definition.args).toBe(args)
    await expect(definition.execute({ foo: "world" }, context)).resolves.toBe("Hello world!")
  })

  test("args parse through the attached zod schema", () => {
    const definition = tool({
      description: "validated tool",
      args: { count: tool.schema.number() },
      async execute() {
        return "ok"
      },
    })
    const schema = z.object(definition.args)
    expect(schema.parse({ count: 3 })).toEqual({ count: 3 })
    expect(schema.safeParse({ count: "nope" }).success).toBe(false)
  })

  test("exposes the shared zod namespace as tool.schema", () => {
    expect(tool.schema).toBe(z)
  })
})
