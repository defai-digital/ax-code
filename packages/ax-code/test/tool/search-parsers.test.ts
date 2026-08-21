import { afterEach, describe, expect, test } from "vitest"
import { parseNativeGlobEntries } from "../../src/tool/glob"
import { parseNativeSearchMatches, parseRipgrepLineNumber } from "../../src/tool/grep"
import { ListTool } from "../../src/tool/ls"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { SessionID, MessageID } from "../../src/session/schema"

const ctx = {
  sessionID: SessionID.make("ses_test-ls-session"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

afterEach(async () => {
  await Instance.disposeAll()
})

// Pure parser/validation coverage split out of the e2e glob/grep/ls suites:
// none of these tests touch ripgrep, native addons, or child processes.
describe("tool.glob parsers", () => {
  test("parseNativeGlobEntries decodes valid native output", () => {
    expect(parseNativeGlobEntries(JSON.stringify([{ path: "/repo/a.ts", mtime: 12, size: 34 }]))).toEqual([
      { path: "/repo/a.ts", mtime: 12, size: 34 },
    ])
  })

  test("parseNativeGlobEntries rejects malformed native output", () => {
    expect(() => parseNativeGlobEntries("{not json")).toThrow(SyntaxError)
    expect(() => parseNativeGlobEntries(JSON.stringify({ path: "/repo/a.ts", mtime: 12, size: 34 }))).toThrow(
      SyntaxError,
    )
    expect(() => parseNativeGlobEntries(JSON.stringify([{ path: "/repo/a.ts", mtime: "12", size: 34 }]))).toThrow(
      SyntaxError,
    )
  })
})

describe("tool.grep parsers", () => {
  test("parseNativeSearchMatches decodes valid native output", () => {
    expect(
      parseNativeSearchMatches(JSON.stringify([{ path: "/repo/a.ts", line: 2, column: 4, matchText: "needle" }])),
    ).toEqual([{ path: "/repo/a.ts", line: 2, column: 4, matchText: "needle" }])
  })

  test("parseNativeSearchMatches rejects malformed native output", () => {
    expect(() => parseNativeSearchMatches("{not json")).toThrow(SyntaxError)
    expect(() =>
      parseNativeSearchMatches(JSON.stringify({ path: "/repo/a.ts", line: 2, column: 4, matchText: "needle" })),
    ).toThrow(SyntaxError)
    expect(() =>
      parseNativeSearchMatches(JSON.stringify([{ path: "/repo/a.ts", line: "2", column: 4, matchText: "needle" }])),
    ).toThrow(SyntaxError)
  })

  test("parseRipgrepLineNumber accepts only complete safe integers", () => {
    expect(parseRipgrepLineNumber("12")).toBe(12)
    expect(parseRipgrepLineNumber("12abc")).toBeUndefined()
    expect(parseRipgrepLineNumber("-1")).toBeUndefined()
    expect(parseRipgrepLineNumber("1.5")).toBeUndefined()
    expect(parseRipgrepLineNumber("9007199254740992")).toBeUndefined()
  })
})

describe("tool.list path validation", () => {
  test("throws on path with null byte", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const list = await ListTool.init()
        await expect(
          list.execute(
            {
              path: "./safe\x00dir",
            },
            ctx,
          ),
        ).rejects.toThrow("File path contains null byte")
      },
    })
  })
})
