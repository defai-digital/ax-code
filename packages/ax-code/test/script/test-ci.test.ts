import { describe, expect, test } from "bun:test"
import { resolveTestCIGroup } from "../../script/test-ci"

describe("script.test-ci", () => {
  test("defaults to deterministic when no positional group is provided", () => {
    expect(resolveTestCIGroup()).toBe("deterministic")
    expect(resolveTestCIGroup(["--dir", ".tmp/test-report"])).toBe("deterministic")
  })

  test("uses the first positional group when provided", () => {
    expect(resolveTestCIGroup(["deterministic"])).toBe("deterministic")
    expect(resolveTestCIGroup(["recovery", "--rerun-on-fail", "1"])).toBe("recovery")
  })
})
