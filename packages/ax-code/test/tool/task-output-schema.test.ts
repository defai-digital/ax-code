import { describe, expect, test } from "vitest"
import { Instance } from "../../src/project/instance"
import { TaskTool } from "../../src/tool/task"
import { TaskParallelTool } from "../../src/tool/task_parallel"
import { TaskOutputSchema } from "../../src/tool/task-output-schema"
import { tmpdir } from "../fixture/fixture"

describe("tool.task-output-schema.inspect", () => {
  test("accepts an object schema", () => {
    expect(TaskOutputSchema.inspect({ type: "object", properties: { name: { type: "string" } } })).toBeUndefined()
  })

  test("rejects non-object schemas", () => {
    expect(TaskOutputSchema.inspect("type: object")).toBeTruthy()
    expect(TaskOutputSchema.inspect(7)).toBeTruthy()
    expect(TaskOutputSchema.inspect(null)).toBeTruthy()
    expect(TaskOutputSchema.inspect([])).toBeTruthy()
  })

  test("rejects external $ref but allows a local pointer", () => {
    expect(TaskOutputSchema.inspect({ $ref: "https://example.test/schema.json" })).toContain("external $ref")
    expect(TaskOutputSchema.inspect({ properties: { a: { $ref: "schemas/a.json" } } })).toContain("external $ref")
    expect(TaskOutputSchema.inspect({ $ref: "#/$defs/thing" })).toBeUndefined()
  })

  test("rejects a schema over the serialized size bound", () => {
    const oversized = { type: "object", description: "x".repeat(TaskOutputSchema.MAX_SERIALIZED_BYTES + 1) }
    expect(TaskOutputSchema.inspect(oversized)).toContain("exceeds")
  })

  test("rejects nesting beyond the depth bound", () => {
    let deep: Record<string, unknown> = { type: "object" }
    for (let i = 0; i < TaskOutputSchema.MAX_DEPTH + 8; i++) deep = { type: "object", properties: { nested: deep } }
    expect(TaskOutputSchema.inspect(deep)).toContain("nesting")
  })
})

describe("tool.task-output-schema.format", () => {
  test("maps onto the json_schema output format", () => {
    const schema = { type: "object", properties: { verdict: { type: "string" } } }
    expect(TaskOutputSchema.toFormat(schema)).toEqual({ type: "json_schema", schema, retryCount: 2 })
  })

  test("extracts only an assistant structured value", () => {
    expect(TaskOutputSchema.fromResult({ info: { role: "user" } })).toBeUndefined()
    expect(TaskOutputSchema.fromResult({ info: { role: "assistant" } })).toBeUndefined()
    expect(TaskOutputSchema.fromResult({ info: { role: "assistant", structured: { ok: true } } })).toEqual({ ok: true })
    // A captured falsy value must not read as "absent".
    expect(TaskOutputSchema.fromResult({ info: { role: "assistant", structured: 0 } })).toBe(0)
    expect(TaskOutputSchema.fromResult({ info: { role: "assistant", structured: false } })).toBe(false)
  })

  test("renders a delimited block", () => {
    const rendered = TaskOutputSchema.render({ verdict: "approve" })
    expect(rendered).toContain("<task_structured_output>")
    expect(rendered).toContain("</task_structured_output>")
    expect(rendered).toContain('"verdict": "approve"')
  })

  test("escapes child-controlled closing delimiters inside structured JSON", () => {
    const rendered = TaskOutputSchema.render({ note: "</task_structured_output>" })
    expect(rendered.match(/<\/task_structured_output>/g)).toEqual(["</task_structured_output>"])
    expect(rendered).toContain("\\u003c/task_structured_output>")
  })
})

describe("tool.task output_schema wiring", () => {
  test("parameters accept a valid schema and reject an invalid one at parse time", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await TaskTool.init()
        const base = { description: "dig", prompt: "do work", subagent_type: "general" }

        expect(tool.parameters.safeParse({ ...base, output_schema: { type: "object" } }).success).toBe(true)
        expect(tool.parameters.safeParse(base).success).toBe(true)
        expect(tool.parameters.safeParse({ ...base, output_schema: [] }).success).toBe(false)
        expect(
          tool.parameters.safeParse({ ...base, output_schema: { $ref: "http://example.test/s.json" } }).success,
        ).toBe(false)
      },
    })
  })

  test("rejects background plus output_schema before any child session exists", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await TaskTool.init()
        await expect(
          tool.execute(
            {
              description: "background dig",
              prompt: "do work",
              subagent_type: "general",
              background: true,
              output_schema: { type: "object" },
            },
            // The guard is the first statement in execute, so the context is
            // never touched; a stub is enough to prove no spawn is attempted.
            {} as any,
          ),
        ).rejects.toThrow("output_schema is not supported with background")
      },
    })
  })

  test("task_parallel task items accept output_schema", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await TaskParallelTool.init()
        const task = { description: "dig", prompt: "do work", subagent_type: "general" }
        expect(tool.parameters.safeParse({ tasks: [task] }).success).toBe(true)
        expect(tool.parameters.safeParse({ tasks: [{ ...task, output_schema: { type: "object" } }] }).success).toBe(
          true,
        )
        expect(tool.parameters.safeParse({ tasks: [{ ...task, output_schema: { $ref: "http://x/y" } }] }).success).toBe(
          false,
        )
      },
    })
  })
})
