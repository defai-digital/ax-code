import { describe, expect, test } from "vitest"
import {
  isResolvedWorkspaceSymbol,
  normalizeCallHierarchyItems,
  normalizeHoverResults,
  normalizeIncomingCalls,
  normalizeNavigationLocations,
  normalizeWorkspaceSymbols,
} from "../src/semantic-results"

const range = {
  start: { line: 1, character: 2 },
  end: { line: 1, character: 5 },
}

const item = {
  name: "run",
  kind: 12,
  uri: "file:///workspace/main.ts",
  range,
  selectionRange: range,
  data: { opaque: true },
}

describe("semantic result normalization", () => {
  test("keeps valid hover and navigation results while rejecting malformed payloads", () => {
    const location = { uri: "file:///workspace/main.ts", range }
    const link = { targetUri: "file:///workspace/target.ts", targetRange: range, targetSelectionRange: range }

    expect(normalizeHoverResults([{ contents: "docs" }, { nope: true }, null])).toEqual([{ contents: "docs" }])
    expect(normalizeNavigationLocations([location, link, { uri: "missing-range" }])).toEqual([location, link])
  })

  test("validates complete call hierarchy shapes", () => {
    const incoming = { from: item, fromRanges: [range], data: "preserved" }

    expect(normalizeCallHierarchyItems([item, { name: "partial" }])).toEqual([item])
    expect(normalizeIncomingCalls([incoming, { from: item, fromRanges: [{}] }])).toEqual([incoming])
  })

  test("distinguishes unresolved workspace symbols from malformed values", () => {
    const unresolved = {
      name: "run",
      kind: 12,
      location: { uri: "file:///workspace/main.ts" },
      data: { resolve: 1 },
    }
    const resolved = { ...unresolved, location: { ...unresolved.location, range } }

    expect(normalizeWorkspaceSymbols([unresolved, resolved, { name: "missing-kind" }])).toEqual([unresolved, resolved])
    expect(isResolvedWorkspaceSymbol(unresolved)).toBe(false)
    expect(isResolvedWorkspaceSymbol(resolved)).toBe(true)
  })
})
