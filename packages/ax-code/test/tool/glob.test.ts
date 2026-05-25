import { describe, expect, test } from "bun:test"
import { parseNativeGlobEntries } from "../../src/tool/glob"

describe("tool.glob", () => {
  test("parseNativeGlobEntries decodes valid native output", () => {
    expect(parseNativeGlobEntries(JSON.stringify([{ path: "/repo/a.ts", mtime: 12, size: 34 }]))).toEqual([
      { path: "/repo/a.ts", mtime: 12, size: 34 },
    ])
  })

  test("parseNativeGlobEntries rejects malformed native output", () => {
    expect(() => parseNativeGlobEntries("{not json")).toThrow(SyntaxError)
    expect(() =>
      parseNativeGlobEntries(JSON.stringify({ path: "/repo/a.ts", mtime: 12, size: 34 })),
    ).toThrow(SyntaxError)
    expect(() =>
      parseNativeGlobEntries(JSON.stringify([{ path: "/repo/a.ts", mtime: "12", size: 34 }])),
    ).toThrow(SyntaxError)
  })
})
