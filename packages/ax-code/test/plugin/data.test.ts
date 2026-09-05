import { describe, expect, test } from "vitest"
import z from "zod"
import { PluginData } from "../../src/plugin/data"

describe("plugin plain-data transactions", () => {
  test("commits nested changes into caller-held arrays and detaches retained draft values", () => {
    const message = { text: "before" }
    const parts = [{ text: "first" }]
    const output = { message, parts }
    const draft = PluginData.copy(output)
    draft.message.text = "after"
    draft.parts.push({ text: "second" })
    PluginData.commit(output, draft)
    expect(output.message).toBe(message)
    expect(output.parts).toBe(parts)
    expect(parts).toEqual([{ text: "first" }, { text: "second" }])
    draft.parts[1].text = "late"
    draft.message.text = "late"
    expect(message.text).toBe("after")
    expect(parts[1].text).toBe("second")
  })

  test("preserves deletions, sparse arrays, cycles, and a split alias", () => {
    const shared = { value: "old" }
    const output = { first: shared, second: shared, rows: ["a", "b", "c"], remove: true } as {
      first: { value: string }
      second: { value: string }
      rows: string[]
      remove?: boolean
      self?: unknown
    }
    output.self = output
    const draft = PluginData.copy(output)
    expect(draft.self).toBe(draft)
    expect(draft.first).toBe(draft.second)
    draft.second = { value: "new" }
    delete draft.remove
    delete draft.rows[0]
    draft.rows.length = 2
    PluginData.commit(output, draft)
    expect(output.self).toBe(output)
    expect(output.first.value).toBe("old")
    expect(output.second.value).toBe("new")
    expect(output.first).not.toBe(output.second)
    expect(output).not.toHaveProperty("remove")
    expect(output.rows.length).toBe(2)
    expect(Object.hasOwn(output.rows, 0)).toBe(false)
  })

  test("preserves opaque schemas and functions without structured-clone failures", () => {
    const schema = z.object({ value: z.string() })
    const callback = () => "ok"
    const output = { schema, callback, description: "before" }
    const draft = PluginData.copy(output)
    draft.description = "after"
    PluginData.commit(output, draft)
    expect(output.schema).toBe(schema)
    expect(output.schema.parse({ value: "valid" })).toEqual({ value: "valid" })
    expect(output.callback).toBe(callback)
    expect(output.description).toBe("after")
  })

  test("copies null-prototype data and __proto__ as an own property without prototype pollution", () => {
    const source = Object.create(null)
    source.__proto__ = { pluginPollutionProbe: true }
    const output = {}
    PluginData.commit(output, PluginData.copy({ data: source }))
    const data = (output as { data: Record<string, unknown> }).data
    expect(Object.getPrototypeOf(data)).toBeNull()
    expect(Object.hasOwn(data, "__proto__")).toBe(true)
    expect(Object.prototype).not.toHaveProperty("pluginPollutionProbe")
    expect(Object.getPrototypeOf(output)).toBe(Object.prototype)
  })
})
