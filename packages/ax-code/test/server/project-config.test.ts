import { describe, expect, test } from "bun:test"
import { decodeProjectConfigValue, parseProjectConfigText } from "../../src/server/routes/project-config"

describe("project config route decoding", () => {
  test("decodes already-parsed project config values", () => {
    expect(decodeProjectConfigValue({ model: "openai/gpt-5", super_long: true })).toEqual({
      model: "openai/gpt-5",
      super_long: true,
    })
  })

  test("parses valid project config JSON", () => {
    expect(parseProjectConfigText(JSON.stringify({ model: "openai/gpt-5", super_long: true }))).toEqual({
      model: "openai/gpt-5",
      super_long: true,
    })
  })

  test("strips unknown keys while preserving valid config fields", () => {
    expect(parseProjectConfigText(JSON.stringify({ model: "openai/gpt-5", unknown: true }))).toEqual({
      model: "openai/gpt-5",
    })
  })

  test("preserves raw objects when validation cannot recover a valid subset", () => {
    const parsed = parseProjectConfigText(JSON.stringify({ model: 123 })) as unknown
    expect(parsed).toEqual({
      model: 123,
    })
  })

  test("falls back to an empty config for malformed JSON", () => {
    expect(parseProjectConfigText("{not json")).toEqual({})
  })
})
