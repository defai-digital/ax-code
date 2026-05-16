import { describe, expect, test } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { num, parseJUnit, resolveTestCIGroup } from "../../script/test-ci"

describe("script.test-ci", () => {
  test("parses valid non-negative integers and keeps default when option missing", () => {
    const saved = process.argv
    try {
      process.argv = ["bun", "test-ci.ts", "--rerun-on-fail", "2"]
      expect(num("--rerun-on-fail")).toBe(2)
      expect(num("--not-exists", 3)).toBe(3)
      process.argv = ["bun", "test-ci.ts"]
    } finally {
      process.argv = saved
    }
  })

  test("throws on negative rerun value", () => {
    const saved = process.argv
    try {
      process.argv = ["bun", "test-ci.ts", "--rerun-on-fail", "-1"]
      expect(() => num("--rerun-on-fail")).toThrowError("Invalid value for --rerun-on-fail: -1")
    } finally {
      process.argv = saved
    }
  })

  test("returns zeroed junit metrics when junit xml file is missing", async () => {
    await using tmp = await tmpdir()
    const result = await parseJUnit(path.join(tmp.path, "missing.xml"))

    expect(result).toEqual({ tests: 0, failures: 0, skipped: 0, time: 0, ignored: 0 })
  })

  test("parses junit with harmless effect interruption as ignored error", async () => {
    await using tmp = await tmpdir()
    const junit = path.join(tmp.path, "report.xml")
    await Bun.write(
      junit,
      [
        `<testsuite tests=\"1\" failures=\"0\" errors=\"1\" skipped=\"0\" time=\"1.23\">`,
        `<testcase classname=\"x\" name=\"a\">`,
        `<error message=\"All fibers interrupted without error\">fiber done</error>`,
        "</testcase>",
        "</testsuite>",
      ].join("\n"),
    )

    const result = await parseJUnit(junit, "All fibers interrupted without error")

    expect(result.tests).toBe(1)
    expect(result.failures).toBe(0)
    expect(result.ignored).toBe(1)
  })

  test("defaults to deterministic when no positional group is provided", () => {
    expect(resolveTestCIGroup()).toBe("deterministic")
    expect(resolveTestCIGroup(["--dir", ".tmp/test-report"])).toBe("deterministic")
  })

  test("uses the first positional group when provided", () => {
    expect(resolveTestCIGroup(["deterministic"])).toBe("deterministic")
    expect(resolveTestCIGroup(["recovery", "--rerun-on-fail", "1"])).toBe("recovery")
  })
})
