import { describe, expect, test, vi } from "vitest"
import z from "zod"
import { Tool } from "../../src/tool/tool"
import * as ArgCoercion from "../../src/tool/arg-coercion"
import { coerceToolArguments } from "../../src/tool/arg-coercion"

function makeCtx() {
  return {
    sessionID: "ses_test",
    messageID: "msg_test",
    agent: "build",
    abort: new AbortController().signal,
    messages: [],
    metadata() {},
    async ask() {},
  }
}

function rejectionOf(schema: z.ZodType, args: unknown): z.ZodError {
  const parsed = schema.safeParse(args)
  if (parsed.success) throw new Error("expected the arguments to be rejected")
  return parsed.error
}

describe("coerceToolArguments", () => {
  test("repairs a numeric string to a finite number", () => {
    const schema = z.object({ count: z.number() })
    const args = { count: "5" }
    const result = coerceToolArguments(schema, args, rejectionOf(schema, args))
    expect(result?.value).toEqual({ count: 5 })
    expect(result?.paths).toEqual(["count"])
    // The caller's object is never mutated.
    expect(args).toEqual({ count: "5" })
  })

  test("repairs true/false strings to booleans", () => {
    const schema = z.object({ force: z.boolean() })
    const truthy = coerceToolArguments(schema, { force: "true" }, rejectionOf(schema, { force: "true" }))
    expect(truthy?.value).toEqual({ force: true })
    const falsy = coerceToolArguments(schema, { force: "false" }, rejectionOf(schema, { force: "false" }))
    expect(falsy?.value).toEqual({ force: false })
  })

  test("repairs a JSON-encoded string to an array with nested values", () => {
    const schema = z.object({ tags: z.array(z.string()) })
    const args = { tags: '["a", ["nested", {"deep": true}]]' }
    const result = coerceToolArguments(schema, args, rejectionOf(schema, args))
    expect(result?.value).toEqual({ tags: ["a", ["nested", { deep: true }]] })
    expect(result?.paths).toEqual(["tags"])
  })

  test("repairs a JSON-encoded string to an object", () => {
    const schema = z.object({ filter: z.object({ name: z.string() }) })
    const args = { filter: '{"name":"x","nested":{"y":1}}' }
    const result = coerceToolArguments(schema, args, rejectionOf(schema, args))
    expect(result?.value).toEqual({ filter: { name: "x", nested: { y: 1 } } })
  })

  test("wraps a bare scalar into a one-element array", () => {
    const stringSchema = z.object({ files: z.array(z.string()) })
    const stringArgs = { files: "src/tool.ts" }
    expect(coerceToolArguments(stringSchema, stringArgs, rejectionOf(stringSchema, stringArgs))?.value).toEqual({
      files: ["src/tool.ts"],
    })

    const numberSchema = z.object({ ids: z.array(z.number()) })
    const numberArgs = { ids: 7 }
    expect(coerceToolArguments(numberSchema, numberArgs, rejectionOf(numberSchema, numberArgs))?.value).toEqual({
      ids: [7],
    })
  })

  test("leaves ambiguous values unchanged", () => {
    const cases: Array<[z.ZodType, unknown]> = [
      [z.object({ count: z.number() }), { count: "12abc" }],
      [z.object({ count: z.number() }), { count: " 12" }],
      [z.object({ count: z.number() }), { count: "1e3" }],
      [z.object({ count: z.number() }), { count: "Infinity" }],
      [z.object({ flag: z.boolean() }), { flag: "TRUE" }],
      [z.object({ flag: z.boolean() }), { flag: 1 }],
      [z.object({ name: z.string() }), { name: 42 }],
      [z.object({ items: z.array(z.string()) }), { items: null }],
      [z.object({ items: z.array(z.string()) }), { items: { 0: "a" } }],
      [z.object({ filter: z.object({}) }), { filter: "[1,2]" }],
      [z.object({ value: z.union([z.string(), z.number()]) }), { value: true }],
      [z.object({ required: z.string() }), {}],
    ]
    for (const [schema, args] of cases) {
      expect(coerceToolArguments(schema, args, rejectionOf(schema, args)), JSON.stringify(args)).toBeUndefined()
    }
  })

  test("repairs nested object and array-index paths", () => {
    const objectSchema = z.object({ outer: z.object({ inner: z.object({ depth: z.number() }) }) })
    const objectArgs = { outer: { inner: { depth: "3" } } }
    const objectResult = coerceToolArguments(objectSchema, objectArgs, rejectionOf(objectSchema, objectArgs))
    expect(objectResult?.value).toEqual({ outer: { inner: { depth: 3 } } })
    expect(objectResult?.paths).toEqual(["outer.inner.depth"])

    const arraySchema = z.object({ items: z.array(z.object({ count: z.number() })) })
    const arrayArgs = { items: [{ count: "3" }, { count: 4 }] }
    const arrayResult = coerceToolArguments(arraySchema, arrayArgs, rejectionOf(arraySchema, arrayArgs))
    expect(arrayResult?.value).toEqual({ items: [{ count: 3 }, { count: 4 }] })
    expect(arrayResult?.paths).toEqual(["items.0.count"])
  })

  test("sees through optional and preprocess pipe wrappers", () => {
    const optionalSchema = z.object({ timeout: z.number().optional() })
    const optionalArgs = { timeout: "42" }
    expect(coerceToolArguments(optionalSchema, optionalArgs, rejectionOf(optionalSchema, optionalArgs))?.value).toEqual(
      { timeout: 42 },
    )

    const pipeSchema = z.object({ limit: z.preprocess((value) => value, z.number()) })
    const pipeArgs = { limit: "10" }
    expect(coerceToolArguments(pipeSchema, pipeArgs, rejectionOf(pipeSchema, pipeArgs))?.value).toEqual({ limit: 10 })
  })

  test("rejects JSON-encoded strings over the size cap", () => {
    const schema = z.object({ tags: z.array(z.string()) })
    const oversizedText = `["${"x".repeat(64 * 1024)}"]`
    const oversized = { tags: oversizedText }
    // Over the cap the JSON repair is refused. The value only qualifies for
    // the bare-scalar wrap, so the original text survives unparsed instead
    // of being decoded into a giant array.
    const oversizedResult = coerceToolArguments(schema, oversized, rejectionOf(schema, oversized))
    expect(oversizedResult?.value).toEqual({ tags: [oversizedText] })

    const withinText = `["${"x".repeat(1024)}"]`
    const within = { tags: withinText }
    const withinResult = coerceToolArguments(schema, within, rejectionOf(schema, within))
    expect(withinResult?.value).toEqual({ tags: [`${"x".repeat(1024)}`] })
  })

  test("returns undefined for non-object arguments", () => {
    const schema = z.object({ count: z.number() })
    expect(coerceToolArguments(schema, "nope", rejectionOf(schema, "nope"))).toBeUndefined()
  })
})

describe("Tool.define argument coercion (ADR-207)", () => {
  function defineEchoTool(
    parameters: z.ZodType,
    id = "echo-args",
    formatValidationError?: (error: z.ZodError) => string,
  ) {
    let received: unknown
    const tool = Tool.define(id, {
      description: "echoes validated arguments",
      parameters,
      ...(formatValidationError ? { formatValidationError } : {}),
      async execute(args) {
        received = args
        return { title: "ok", metadata: {}, output: "ok" }
      },
    })
    return {
      tool,
      received: () => received,
      run: async (args: unknown) => {
        const info = await tool.init()
        const result = await info.execute(args, makeCtx() as unknown as Parameters<typeof info.execute>[1])
        return result
      },
    }
  }

  test("repairs a numeric string call and marks metadata coerced", async () => {
    const spy = vi.spyOn(ArgCoercion, "coerceToolArguments")
    try {
      const parameters = z.object({ limit: z.number() })
      const parse = vi.spyOn(parameters, "parse")
      const echo = defineEchoTool(parameters)
      const result = await echo.run({ limit: "10" })

      expect(echo.received()).toEqual({ limit: 10 })
      expect((result.metadata as Record<string, unknown>).coerced).toBe(true)
      // Initial parse plus exactly one re-parse.
      expect(parse).toHaveBeenCalledTimes(2)
      expect(spy).toHaveBeenCalledTimes(1)
    } finally {
      spy.mockRestore()
    }
  })

  test("never invokes coercion for a valid call", async () => {
    const spy = vi.spyOn(ArgCoercion, "coerceToolArguments")
    try {
      const parameters = z.object({ limit: z.number(), label: z.string() })
      const parse = vi.spyOn(parameters, "parse")
      const echo = defineEchoTool(parameters)
      const result = await echo.run({ limit: 10, label: "ok" })

      expect(echo.received()).toEqual({ limit: 10, label: "ok" })
      expect((result.metadata as Record<string, unknown>).coerced).toBeUndefined()
      expect(parse).toHaveBeenCalledTimes(1)
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })

  test("reports the original error when no repair applies", async () => {
    const echo = defineEchoTool(z.object({ limit: z.number() }), "unrepairable")
    const error = (await echo.run({ limit: "twelve" }).catch((err) => err)) as Error
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toContain("The unrepairable tool was called with invalid arguments")
    expect(error.message).toContain("expected number")
    expect((error as Error & { cause?: unknown }).cause).toBeInstanceOf(z.ZodError)
  })

  test("reports the original error when the repaired arguments still fail", async () => {
    const echo = defineEchoTool(z.object({ count: z.number(), label: z.string() }), "still-invalid")
    // count is repairable, label stays wrong: the re-parse fails and the
    // original error must surface, not the re-parse failure.
    const error = (await echo.run({ count: "5", label: 42 }).catch((err) => err)) as Error
    expect(error.message).toContain("The still-invalid tool was called with invalid arguments")
    expect((error as Error & { cause?: unknown }).cause).toBeInstanceOf(z.ZodError)
  })

  test("keeps formatValidationError for unrepairable failures", async () => {
    const echo = defineEchoTool(z.object({ count: z.number() }), "formatted", (err) => `custom: ${err.issues.length}`)
    const error = (await echo.run({ count: "nope" }).catch((err) => err)) as Error
    expect(error.message).toBe("custom: 1")
  })

  test("marks coerced even when the tool manages its own truncation", async () => {
    let received: unknown
    const tool = Tool.define("self-truncate", {
      description: "returns its own truncated metadata",
      parameters: z.object({ depth: z.number() }),
      async execute(args) {
        received = args
        return { title: "ok", metadata: { truncated: false }, output: "ok" }
      },
    })
    const info = await tool.init()
    const result = await info.execute(
      { depth: "2" } as unknown as Parameters<typeof info.execute>[0],
      makeCtx() as unknown as Parameters<typeof info.execute>[1],
    )
    expect(received).toEqual({ depth: 2 })
    expect(result.metadata).toEqual({ truncated: false, coerced: true })
  })
})
