import { describe, expect, test } from "vitest"
import {
  isAdr236Reference,
  parseReferenceToken,
  type ReferenceToken,
} from "../../src/session/prompt/prompt-reference-parser"

describe("parseReferenceToken", () => {
  const cases: Array<{ name: string; token?: ReferenceToken; adr236: boolean }> = [
    { name: "diff", token: { kind: "diff" }, adr236: true },
    { name: "staged", token: { kind: "staged" }, adr236: true },
    { name: "git:1", token: { kind: "git", count: 1 }, adr236: true },
    { name: "git:10", token: { kind: "git", count: 10 }, adr236: true },
    { name: "url:https://example.com/path", token: { kind: "url", href: "https://example.com/path" }, adr236: true },
    { name: "url:http://example.com", token: { kind: "url", href: "http://example.com" }, adr236: true },
    {
      name: "file:src/foo.ts:10-25",
      token: { kind: "file-range", path: "src/foo.ts", start: 10, end: 25 },
      adr236: true,
    },
    {
      name: "src/foo.ts:10-25",
      token: { kind: "file-range", path: "src/foo.ts", start: 10, end: 25 },
      adr236: true,
    },
    {
      name: "src/foo.ts:42",
      token: { kind: "file-range", path: "src/foo.ts", start: 42 },
      adr236: true,
    },
    // Negative cases
    { name: "", token: undefined, adr236: false },
    { name: "git:0", token: undefined, adr236: false },
    { name: "git:11", token: { kind: "git", count: 10 }, adr236: true },
    { name: "git:abc", token: undefined, adr236: false },
    { name: "git:-1", token: undefined, adr236: false },
    { name: "url:", token: undefined, adr236: false },
    { name: "url:ftp://example.com", token: undefined, adr236: false },
    { name: "url:example.com", token: undefined, adr236: false },
    { name: "src/foo.ts", token: undefined, adr236: false }, // no line range
    { name: "src/foo.ts:0", token: undefined, adr236: false }, // zero start
    { name: "src/foo.ts:25-10", token: undefined, adr236: false }, // end < start
    { name: "file::10-25", token: undefined, adr236: false }, // empty path
  ]

  for (const c of cases) {
    test(`parses ${JSON.stringify(c.name)}`, () => {
      const result = parseReferenceToken(c.name)
      expect(result).toEqual(c.token)
      if (c.token) {
        expect(isAdr236Reference(c.token)).toBe(c.adr236)
      }
    })
  }

  test("non-ADR-236 token reports isAdr236Reference=false", () => {
    const fileToken: ReferenceToken = { kind: "file", path: "src/foo.ts" }
    const agentToken: ReferenceToken = { kind: "agent", name: "build" }
    expect(isAdr236Reference(fileToken)).toBe(false)
    expect(isAdr236Reference(agentToken)).toBe(false)
  })

  test("range with extremely large start is rejected", () => {
    expect(parseReferenceToken(`src/foo.ts:99999999`)).toBeUndefined()
  })
})
