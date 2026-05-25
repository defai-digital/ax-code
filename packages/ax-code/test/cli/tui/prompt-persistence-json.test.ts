import { describe, expect, test } from "bun:test"
import z from "zod"
import {
  decodePromptPersistenceJsonLine,
  parsePromptPersistenceJsonLine,
} from "../../../src/cli/cmd/tui/component/prompt/persistence-json"

describe("prompt persistence JSON", () => {
  test("parsePromptPersistenceJsonLine parses JSON lines", () => {
    expect(parsePromptPersistenceJsonLine(JSON.stringify({ path: "/repo/file.ts" }))).toEqual({
      path: "/repo/file.ts",
    })
  })

  test("parsePromptPersistenceJsonLine returns undefined for malformed JSON", () => {
    expect(parsePromptPersistenceJsonLine("not json")).toBeUndefined()
  })

  test("decodePromptPersistenceJsonLine applies the caller schema", () => {
    const schema = z.object({ path: z.string().min(1) })

    expect(decodePromptPersistenceJsonLine(JSON.stringify({ path: "/repo/file.ts", extra: true }), schema)).toEqual({
      path: "/repo/file.ts",
    })
    expect(decodePromptPersistenceJsonLine(JSON.stringify({ path: "" }), schema)).toBeUndefined()
    expect(decodePromptPersistenceJsonLine("not json", schema)).toBeUndefined()
  })
})
