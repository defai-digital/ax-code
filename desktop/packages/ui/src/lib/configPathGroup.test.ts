import { describe, expect, test } from "vitest"
import { parseConfigPathGroup } from "./configPathGroup"

describe("parseConfigPathGroup", () => {
  test("returns the group folder for grouped config paths", () => {
    expect(
      parseConfigPathGroup("~/.config/ax-code/skills/automation-ai/ai-production/SKILL.md", {
        segment: "skills",
        minimumPartsForGroup: 3,
      }),
    ).toBe("automation-ai")
    expect(
      parseConfigPathGroup("~/.config/ax-code/agents/business/ceo.md", {
        segment: "agents",
        minimumPartsForGroup: 2,
      }),
    ).toBe("business")
  })

  test("returns undefined for flat config paths", () => {
    expect(
      parseConfigPathGroup("~/.config/ax-code/skills/theme-system/SKILL.md", {
        segment: "skills",
        minimumPartsForGroup: 3,
      }),
    ).toBeUndefined()
    expect(
      parseConfigPathGroup("~/.config/ax-code/agents/ceo.md", {
        segment: "agents",
        minimumPartsForGroup: 2,
      }),
    ).toBeUndefined()
  })

  test("normalizes Windows separators before parsing", () => {
    expect(
      parseConfigPathGroup("C:\\Users\\Alice\\.config\\ax-code\\skills\\dev-tools\\lint\\SKILL.md", {
        segment: "skills",
        minimumPartsForGroup: 3,
      }),
    ).toBe("dev-tools")
  })
})
