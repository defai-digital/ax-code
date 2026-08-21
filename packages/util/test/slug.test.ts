import { describe, expect, test } from "vitest"
import { Slug } from "../src/slug"

describe("Slug.create", () => {
  test("returns lowercase adjective-noun pairs", () => {
    for (let i = 0; i < 20; i++) {
      expect(Slug.create()).toMatch(/^[a-z]+-[a-z]+$/)
    }
  })
})
