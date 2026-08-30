import { expect, test } from "vitest"
import { CLI_CONCISE_MAX_LINES, capLines, diffSummary, formatDiffSummary, tailLines } from "../../src/util/tool-output"

test("tailLines returns short text unchanged", () => {
  expect(tailLines("one\ntwo")).toEqual({ text: "one\ntwo", total: 2, truncated: false })
  expect(tailLines("")).toEqual({ text: "", total: 1, truncated: false })
})

test("tailLines keeps the tail when over the concise cap", () => {
  const lines = Array.from({ length: CLI_CONCISE_MAX_LINES + 10 }, (_, i) => `line ${i + 1}`)
  const result = tailLines(lines.join("\n"))

  expect(result.truncated).toBe(true)
  expect(result.total).toBe(CLI_CONCISE_MAX_LINES + 10)
  expect(result.text).toBe(lines.slice(-CLI_CONCISE_MAX_LINES).join("\n"))
  expect(result.text).not.toContain("line 1\n")
})

test("tailLines ignores a trailing newline phantom line", () => {
  const exact = Array.from({ length: CLI_CONCISE_MAX_LINES }, (_, i) => `line ${i + 1}`).join("\n") + "\n"
  const result = tailLines(exact)

  expect(result.truncated).toBe(false)
  expect(result.total).toBe(CLI_CONCISE_MAX_LINES)
})

test("tailLines honors a custom cap", () => {
  const result = tailLines("1\n2\n3\n4\n5", 2)
  expect(result).toEqual({ text: "4\n5", total: 5, truncated: true })
})

test("formatDiffSummary pluralizes hunks", () => {
  expect(formatDiffSummary({ hunks: 1, added: 2, removed: 1 })).toBe("1 hunk · +2 −1")
  expect(formatDiffSummary({ hunks: 3, added: 3, removed: 2 })).toBe("3 hunks · +3 −2")
})

test("diffSummary counts hunks and +/- lines, ignoring file headers", () => {
  const diff = ["--- a/f.ts", "+++ b/f.ts", "@@ -1,2 +1,2 @@", "-old", "+new", "+extra"].join("\n")
  expect(diffSummary(diff)).toEqual({ hunks: 1, added: 2, removed: 1 })
  expect(diffSummary(undefined)).toBeUndefined()
  expect(diffSummary("")).toBeUndefined()
})

test("capLines keeps the head and reports the total", () => {
  const lines = Array.from({ length: 10 }, (_, i) => `${i}`)
  expect(capLines(lines, 3)).toEqual({ text: "0\n1\n2", total: 10, truncated: true })
  expect(capLines(lines, 10)).toEqual({ text: lines.join("\n"), total: 10, truncated: false })
})
