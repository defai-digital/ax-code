import { describe, expect, test } from "vitest"
import { normalizeDialogSkills } from "../../../src/cli/cmd/tui/component/skill-list-data"

describe("skill list data", () => {
  test("normalizes missing or malformed skill payloads to an empty list", () => {
    expect(normalizeDialogSkills(undefined)).toEqual([])
    expect(normalizeDialogSkills(null)).toEqual([])
    expect(normalizeDialogSkills({ name: "review" })).toEqual([])
  })

  test("drops skill items that cannot be rendered safely", () => {
    expect(
      normalizeDialogSkills([
        { name: "review", description: "Review code" },
        null,
        { description: "Missing name" },
        { name: 42, description: "Bad name" },
        { name: "bad-description", description: 42 },
        { name: "minimal" },
      ]),
    ).toEqual([{ name: "review", description: "Review code" }, { name: "minimal" }])
  })
})
