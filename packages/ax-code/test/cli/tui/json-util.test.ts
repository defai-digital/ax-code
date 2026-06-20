import { describe, expect, test } from "vitest"
import { parseTuiJsonPayload } from "../../../src/cli/cmd/tui/util/json"

describe("tui json util", () => {
  test("parses JSON payloads without applying shape validation", () => {
    expect(parseTuiJsonPayload(JSON.stringify({ type: "rpc.event" }))).toEqual({ type: "rpc.event" })
    expect(parseTuiJsonPayload("null")).toBeNull()
  })

  test("returns undefined for absent or malformed payloads", () => {
    expect(parseTuiJsonPayload(undefined)).toBeUndefined()
    expect(parseTuiJsonPayload("")).toBeUndefined()
    expect(parseTuiJsonPayload("not json")).toBeUndefined()
  })
})
