import { describe, expect, test } from "vitest"
import { checkPicomatchSecurity, picomatchPaths } from "./check-picomatch-security.mjs"

describe("installed picomatch security backports", () => {
  test("covers the runtime glob and filesystem watcher dependencies", () => {
    expect(picomatchPaths).toHaveLength(2)
  })

  test("bounds hostile repeated extglobs and preserves ordinary matching", () => {
    expect(() => checkPicomatchSecurity()).not.toThrow()
  })
})
