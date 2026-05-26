import { describe, expect, test } from "bun:test"
import { parseFrecencyLine } from "../../../src/cli/cmd/tui/component/prompt/frecency-util"

describe("prompt frecency persistence", () => {
  test("parses valid frecency jsonl rows", () => {
    expect(parseFrecencyLine(JSON.stringify({ path: "/repo/file.ts", frequency: 2, lastOpen: 1234 }))).toEqual({
      path: "/repo/file.ts",
      frequency: 2,
      lastOpen: 1234,
    })
  })

  test("rejects malformed frecency jsonl rows", () => {
    expect(parseFrecencyLine("not json")).toBeUndefined()
    expect(parseFrecencyLine(JSON.stringify({ path: "", frequency: 2, lastOpen: 1234 }))).toBeUndefined()
    expect(parseFrecencyLine(JSON.stringify({ path: "/repo/file.ts", frequency: -1, lastOpen: 1234 }))).toBeUndefined()
    expect(
      parseFrecencyLine(JSON.stringify({ path: "/repo/file.ts", frequency: 2, lastOpen: Number.NaN })),
    ).toBeUndefined()
    expect(parseFrecencyLine(JSON.stringify(["/repo/file.ts", 2, 1234]))).toBeUndefined()
  })

  test("returns plain frecency entries without persisted extras", () => {
    expect(
      parseFrecencyLine(JSON.stringify({ path: "/repo/file.ts", frequency: 1, lastOpen: 2, extra: true })),
    ).toEqual({
      path: "/repo/file.ts",
      frequency: 1,
      lastOpen: 2,
    })
  })
})
