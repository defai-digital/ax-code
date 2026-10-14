import { describe, expect, test } from "vitest"
import { stringifyTolerant } from "../../src/util/json-tolerant"

describe("util/json-tolerant", () => {
  test("serializes plain objects identically to JSON.stringify", () => {
    const payload = {
      type: "tool.result",
      properties: { items: [{ id: 1 }, { id: 2 }], nested: { flag: true, count: 3 } },
    }

    expect(stringifyTolerant(payload)).toBe(JSON.stringify(payload))
  })

  test("encodes bigint values as decimal strings", () => {
    expect(stringifyTolerant({ sequence: 9007199254740993n })).toBe('{"sequence":"9007199254740993"}')
  })

  test("replaces true cycles with [Circular] while keeping siblings intact", () => {
    const payload: Record<string, unknown> = { type: "tool.result", count: 42 }
    payload.self = payload

    const encoded = stringifyTolerant(payload)

    expect(encoded).toContain('"[Circular]"')
    expect(JSON.parse(encoded)).toEqual({ type: "tool.result", count: 42, self: "[Circular]" })
  })

  test("serializes shared non-cyclic references in full both times", () => {
    const shared = { patterns: ["/tmp/outside/*"] }

    const encoded = stringifyTolerant({ first: shared, second: shared })

    expect(JSON.parse(encoded)).toEqual({
      first: { patterns: ["/tmp/outside/*"] },
      second: { patterns: ["/tmp/outside/*"] },
    })
  })

  test("encodes undefined as null", () => {
    expect(stringifyTolerant(undefined)).toBe("null")
  })

  test("throws when toJSON throws on both tiers", () => {
    expect(() =>
      stringifyTolerant({
        toJSON() {
          throw new Error("boom")
        },
      }),
    ).toThrow("boom")
  })
})
