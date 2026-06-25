import { describe, expect, test } from "vitest"
import { insertGroupHeaders } from "../../../src/cli/cmd/tui/component/prompt/autocomplete"
import type { AutocompleteOption } from "../../../src/cli/cmd/tui/component/prompt/autocomplete"

describe("autocomplete group headers", () => {
  test("returns empty array for no options", () => {
    expect(insertGroupHeaders([])).toEqual([])
  })

  test("returns options without headers when no groups are set", () => {
    const opts: AutocompleteOption[] = [
      { display: "file1.ts" },
      { display: "file2.ts" },
    ]
    const result = insertGroupHeaders(opts)
    expect(result).toEqual([
      { type: "option", option: opts[0], flatIndex: 0 },
      { type: "option", option: opts[1], flatIndex: 1 },
    ])
  })

  test("inserts a group header before the first grouped option", () => {
    const opts: AutocompleteOption[] = [
      { display: "file1.ts", group: "Files" },
      { display: "file2.ts", group: "Files" },
      { display: "@debug", group: "Subagents", description: "Invoke subagent" },
    ]
    const result = insertGroupHeaders(opts)
    expect(result).toEqual([
      { type: "header", label: "Files" },
      { type: "option", option: opts[0], flatIndex: 0 },
      { type: "option", option: opts[1], flatIndex: 1 },
      { type: "header", label: "Subagents" },
      { type: "option", option: opts[2], flatIndex: 2 },
    ])
  })

  test("does not insert duplicate headers for the same group", () => {
    const opts: AutocompleteOption[] = [
      { display: "file1.ts", group: "Files" },
      { display: "file2.ts", group: "Files" },
      { display: "file3.ts", group: "Files" },
    ]
    const result = insertGroupHeaders(opts)
    expect(result.length).toBe(4) // 1 header + 3 options
    expect(result[0]).toEqual({ type: "header", label: "Files" })
  })

  test("inserts new header when group changes", () => {
    const opts: AutocompleteOption[] = [
      { display: "file1.ts", group: "Files" },
      { display: "resource1", group: "Resources" },
      { display: "@debug", group: "Subagents" },
    ]
    const result = insertGroupHeaders(opts)
    expect(result).toEqual([
      { type: "header", label: "Files" },
      { type: "option", option: opts[0], flatIndex: 0 },
      { type: "header", label: "Resources" },
      { type: "option", option: opts[1], flatIndex: 1 },
      { type: "header", label: "Subagents" },
      { type: "option", option: opts[2], flatIndex: 2 },
    ])
  })

  test("preserves flatIndex across group boundaries", () => {
    const opts: AutocompleteOption[] = [
      { display: "file1.ts", group: "Files" },
      { display: "file2.ts", group: "Files" },
      { display: "@debug", group: "Subagents" },
      { display: "@review", group: "Subagents" },
    ]
    const result = insertGroupHeaders(opts)
    const flatIndices = result.filter((e) => e.type === "option").map((e) => (e as { flatIndex: number }).flatIndex)
    expect(flatIndices).toEqual([0, 1, 2, 3])
  })
})
