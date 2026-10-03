import { describe, expect, test } from "vitest"
import { validateWikiPageLinks } from "../src/core.js"

const planned = new Set([
  "quickstart.md",
  "development/workflows.md",
  "modules/frontend.md",
  "modules/frontend/src/api.md",
  "architecture/overview.md",
])

describe("observed relative Wiki link regressions", () => {
  test("rejects the two nested links that failed AX Translate publication", () => {
    const issues = validateWikiPageLinks(
      "modules/frontend/src/api.md",
      "[Workflows](../../development/workflows.md) [Module](../frontend.md)",
      planned,
    )
    expect(issues).toHaveLength(2)
    expect(issues.every((issue) => issue.code === "wiki.link_broken")).toBe(true)
  })
  test("accepts the corrected relative paths before sibling pages are generated", () => {
    expect(
      validateWikiPageLinks(
        "modules/frontend/src/api.md",
        "[Workflows](../../../development/workflows.md#testing) [Module](../../frontend.md)",
        planned,
      ),
    ).toEqual([])
  })
  test("rejects the unplanned runtime page that failed AX Office publication", () => {
    expect(
      validateWikiPageLinks("architecture/overview.md", "[Runtime](../modules/axOffice-ui/src/runtime.md)", planned),
    ).toHaveLength(1)
  })
})
