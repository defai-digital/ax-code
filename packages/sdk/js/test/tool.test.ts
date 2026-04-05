import { describe, expect, test } from "bun:test"
import { tool } from "../src/programmatic/tool"
import { z } from "zod"

describe("tool()", () => {
  test("creates an SdkTool with the correct shape", () => {
    const t = tool({
      name: "greet",
      description: "Say hello",
      parameters: z.object({ name: z.string() }),
      execute: async ({ name }) => `Hello, ${name}!`,
    })
    expect(t.__brand).toBe("SdkTool")
    expect(t.name).toBe("greet")
    expect(t.description).toBe("Say hello")
    expect(typeof t.execute).toBe("function")
  })

  test("execute receives typed input and returns the result", async () => {
    const t = tool({
      name: "add",
      description: "Add two numbers",
      parameters: z.object({ a: z.number(), b: z.number() }),
      execute: async ({ a, b }) => a + b,
    })
    const result = await t.execute({ a: 3, b: 4 })
    expect(result).toBe(7)
  })

  test("parameters schema validates input", () => {
    const schema = z.object({ count: z.number() })
    const t = tool({
      name: "counter",
      description: "Count things",
      parameters: schema,
      execute: async ({ count }) => count * 2,
    })
    // The schema is stored and can be used for validation
    expect(() => (t.parameters as typeof schema).parse({ count: "not a number" })).toThrow()
    expect((t.parameters as typeof schema).parse({ count: 5 })).toEqual({ count: 5 })
  })

  test("async execute works", async () => {
    const t = tool({
      name: "slow",
      description: "Slow operation",
      parameters: z.object({}),
      execute: async () => {
        await new Promise((r) => setTimeout(r, 10))
        return "done"
      },
    })
    expect(await t.execute({})).toBe("done")
  })

  test("execute can return objects", async () => {
    const t = tool({
      name: "deploy",
      description: "Deploy",
      parameters: z.object({ service: z.string() }),
      execute: async ({ service }) => ({ url: `https://${service}.example.com`, status: "ok" }),
    })
    const result = await t.execute({ service: "api" })
    expect(result).toEqual({ url: "https://api.example.com", status: "ok" })
  })
})
