import { describe, expect, test } from "bun:test"
import { parsePromptInfo, parsePromptInfoList } from "../../../src/cli/cmd/tui/component/prompt/prompt-info"

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
