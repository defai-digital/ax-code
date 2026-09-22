import { describe, expect, test } from "vitest"
import { shouldHideAutocompleteOnInput } from "../../../src/cli/tui/component/prompt/autocomplete"
import {
  displayOffsetFromStringIndex,
  stringIndexFromDisplayOffset,
  stringIndicesFromDisplayOffsets,
} from "../../../src/cli/tui/component/prompt/prompt-helpers"

// Reference: the previous two-walk body of shouldHideAutocompleteOnInput.
function hideReference(input: { mode: "@" | "/"; value: string; triggerIndex: number; cursorOffset: number }) {
  const { mode, value, triggerIndex, cursorOffset } = input
  const triggerStringIndex = stringIndexFromDisplayOffset(value, triggerIndex)
  if (cursorOffset <= triggerIndex) {
    return !(cursorOffset === triggerIndex && value.at(triggerStringIndex) === mode)
  }
  const cursorStringIndex = stringIndexFromDisplayOffset(value, cursorOffset)
  if (value.slice(triggerStringIndex, cursorStringIndex).match(/\s/)) return true
  if (mode === "/" && value.match(/^\S+\s+\S+\s*$/)) return true
  return false
}

const TEXTS = [
  "",
  "abc",
  "a\nb\n",
  "あいうえお",
  "a👩‍👩‍👧b",
  "éx",
  "a​x",
  "\x1b[31mhi",
  "/foo bar",
  "@foo\nbar baz",
  "say @中文 name",
  "/cmd  two words ",
]

describe("single-walk display offset pair", () => {
  test("matches two independent walks over a trigger x cursor grid", () => {
    for (const value of TEXTS) {
      const total = displayOffsetFromStringIndex(value, value.length)
      for (let low = 0; low <= total + 2; low++) {
        for (let high = low; high <= total + 2; high++) {
          expect(stringIndicesFromDisplayOffsets(value, low, high), JSON.stringify({ value, low, high })).toEqual([
            stringIndexFromDisplayOffset(value, low),
            stringIndexFromDisplayOffset(value, high),
          ])
        }
      }
    }
  })

  test("shouldHideAutocompleteOnInput matches the two-walk reference", () => {
    for (const value of TEXTS) {
      const total = displayOffsetFromStringIndex(value, value.length)
      for (const mode of ["@", "/"] as const) {
        for (let triggerIndex = 0; triggerIndex <= total + 2; triggerIndex++) {
          for (let cursorOffset = 0; cursorOffset <= total + 2; cursorOffset++) {
            const input = { mode, value, triggerIndex, cursorOffset }
            expect(shouldHideAutocompleteOnInput(input), JSON.stringify(input)).toBe(hideReference(input))
          }
        }
      }
    }
  })
})
