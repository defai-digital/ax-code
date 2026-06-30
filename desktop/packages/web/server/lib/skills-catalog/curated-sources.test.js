import { describe, expect, test } from "vitest"

import { getCuratedSkillsSources } from "./curated-sources.js"

describe("curated skills sources", () => {
  test("includes reliable built-in catalogs beyond Anthropic and ClawdHub", () => {
    expect(getCuratedSkillsSources().map((source) => source.id)).toEqual([
      "anthropic",
      "mattpocock",
      "jeffallan",
      "jezweb",
      "engineering-workflows",
      "posit",
      "clawdhub",
    ])
  })
})
