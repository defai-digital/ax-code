import { describe, expect, test } from "vitest"
import { parsePromptInfo, parsePromptInfoList } from "../../../src/cli/tui/component/prompt/prompt-info"

describe("tui prompt info decoding", () => {
  test("parses valid prompt info and defaults missing parts", () => {
    expect(parsePromptInfo({ input: "hello" })).toEqual({
      input: "hello",
      parts: [],
    })
    expect(parsePromptInfo({ input: "hello", mode: "shell", parts: [{ type: "text", text: "hello" }] })).toEqual({
      input: "hello",
      mode: "shell",
      parts: [{ type: "text", text: "hello" }],
    })
  })

  test("rejects malformed prompt info", () => {
    expect(parsePromptInfo({ input: 1, parts: [] })).toBeUndefined()
    expect(parsePromptInfo({ input: "hello", mode: "bad", parts: [] })).toBeUndefined()
    expect(parsePromptInfo({ input: "hello", parts: [{ text: "missing type" }] })).toBeUndefined()
    expect(parsePromptInfo(["hello"])).toBeUndefined()
  })

  test("keeps valid neighboring rows when one history entry is malformed", () => {
    expect(
      parsePromptInfoList([
        { input: "first", parts: [] },
        null,
        { input: 42, parts: [] },
        { input: "bad mode", mode: "invalid", parts: [] },
        { input: "bad parts", parts: "invalid" },
        { input: "bad part type", parts: [{ text: "missing type" }] },
        { input: "last" },
      ]),
    ).toEqual([
      { input: "first", parts: [] },
      { input: "last", parts: [] },
    ])
  })

  test("parses prompt info lists with the same boundary rules", () => {
    expect(
      parsePromptInfoList([
        { input: "keep", parts: [{ type: "text", text: "keep" }] },
        { input: "drop", parts: [{ text: "missing type" }] },
      ]),
    ).toEqual([{ input: "keep", parts: [{ type: "text", text: "keep" }] }])
    expect(parsePromptInfoList({ input: "not a list" })).toEqual([])
  })
})
