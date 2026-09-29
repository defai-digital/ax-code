import { expect, test } from "vitest"
import { compareStableStrings, stableJson } from "../src/hash.js"

test("stableJson orders keys by UTF-16 code units, not locale collation", () => {
  // en collation places "é" near "e" (before "z"); code units place "z" (0x7A)
  // before "é" (0xE9). Content-derived fingerprints must not depend on the
  // host ICU locale or version.
  expect(stableJson({ z: 1, é: 2 })).toBe('{"z":1,"é":2}')
  expect(compareStableStrings("z", "é")).toBe(-1)
  expect(compareStableStrings("é", "z")).toBe(1)
  expect(compareStableStrings("a", "a")).toBe(0)
})
