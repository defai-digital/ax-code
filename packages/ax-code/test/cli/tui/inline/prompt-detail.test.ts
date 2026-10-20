import { expect, test } from "vitest"
import { compactDetail, truncateDetail } from "../../../../src/cli/tui/inline/prompt-detail"
import { inlineFooterHeight } from "../../../../src/cli/tui/inline/lifecycle"

const more = (count: number) => `... ${count} more lines`
test("bounds external details and reports omitted rows without terminal controls", () => {
  expect(truncateDetail("a\nb\nc\nd", 2, more)).toBe("a\nb\n... 2 more lines")
  expect(compactDetail({ diff: "1\n2\n3\n4\n5\x1b[2J", token: "secret" }, ["6"], more)).toBe(
    "1\n2\n3\n4\n... 2 more lines",
  )
})
test("expanded footer grows beyond drafts, leaving one physical transcript row", () => {
  expect(inlineFooterHeight(20, 24, true)).toBe(23)
  expect(inlineFooterHeight(20, 60, true)).toBe(23)
  expect(inlineFooterHeight(20, 4, true)).toBe(3)
  expect(inlineFooterHeight(20, 24)).toBe(6)
})
