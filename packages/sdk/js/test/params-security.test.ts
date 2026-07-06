import { describe, expect, test } from "vitest"
import { buildClientParams as buildClientParamsV1 } from "../src/gen/core/params.gen.js"
import { buildClientParams as buildClientParamsV2 } from "../src/v2/gen/core/params.gen.js"

const builders = [
  ["v1", buildClientParamsV1],
  ["v2", buildClientParamsV2],
] as const

function createPayloadWithUnsafeKeys() {
  const payload: Record<string, unknown> = {
    constructor: "polluted",
    prototype: "polluted",
    $query___proto__: "polluted",
    $headers_constructor: "polluted",
    "$headers_x-safe": "safe-header",
    ok: "safe",
    $query_okExtra: "safe-extra",
    queryExtra: "safe-query",
  }
  Object.defineProperty(payload, "__proto__", {
    value: "polluted",
    enumerable: true,
    configurable: true,
  })
  return payload
}

describe("generated client params security", () => {
  test.each(builders)("drops unsafe dynamic param keys for %s", (_name, buildClientParams) => {
    const params = buildClientParams(
      [createPayloadWithUnsafeKeys()],
      [
        {
          args: [
            { in: "query", key: "__proto__" },
            { in: "query", key: "constructor" },
            { in: "query", key: "prototype" },
            { in: "query", key: "ok" },
          ],
          allowExtra: { query: true },
        },
      ],
    )

    expect(Object.hasOwn(params.query, "__proto__")).toBe(false)
    expect(Object.hasOwn(params.query, "constructor")).toBe(false)
    expect(Object.hasOwn(params.query, "prototype")).toBe(false)
    expect(Object.hasOwn(params.headers, "constructor")).toBe(false)
    expect(params.headers["x-safe"]).toBe("safe-header")
    expect(params.query.ok).toBe("safe")
    expect(params.query.okExtra).toBe("safe-extra")
    expect(params.query.queryExtra).toBe("safe-query")
  })
})
