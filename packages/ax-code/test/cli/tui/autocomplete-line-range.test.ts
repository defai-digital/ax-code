import { describe, expect, test } from "vitest"
import { extractLineRange, removeLineRange } from "../../../src/cli/cmd/tui/component/prompt/autocomplete"

describe("autocomplete line range parsing", () => {
  test("keeps nonnumeric hash suffixes as part of the file query", () => {
    expect(removeLineRange("docs/spec#draft.md")).toBe("docs/spec#draft.md")
    expect(extractLineRange("docs/spec#draft.md")).toEqual({ baseQuery: "docs/spec#draft.md" })
  })

  test("strips numeric line suffixes from fuzzy matching and file lookup", () => {
    expect(removeLineRange("src/app.ts#12")).toBe("src/app.ts")
    expect(extractLineRange("src/app.ts#12")).toEqual({
      baseQuery: "src/app.ts",
      lineRange: { baseName: "src/app.ts", startLine: 12, endLine: undefined },
    })
  })

  test("parses increasing numeric line ranges", () => {
    expect(removeLineRange("src/app.ts#12-30")).toBe("src/app.ts")
    expect(extractLineRange("src/app.ts#12-30")).toEqual({
      baseQuery: "src/app.ts",
      lineRange: { baseName: "src/app.ts", startLine: 12, endLine: 30 },
    })
  })
})
