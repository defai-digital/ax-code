import { describe, expect, test } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { num, parseJUnit, resolveTestCIGroup, renderSummaryText } from "../../script/test-ci"

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

  test("falls back to testcase count when junit root tests attr is missing", async () => {
    await using tmp = await tmpdir()
    const junit = path.join(tmp.path, "report.xml")
    await Bun.write(
      junit,
      [
        "<testsuite skipped=\"1\" time=\"0.50\">",
        "<testcase classname=\"x\" name=\"ok\">",
        "</testcase>",
        "<testcase classname=\"x\" name=\"also-ok\">",
        "</testcase>",
        "</testsuite>",
      ].join("\n"),
    )

    const result = await parseJUnit(junit)

    expect(result.tests).toBe(2)
    expect(result.skipped).toBe(1)
    expect(result.failures).toBe(0)
  })

  test("keeps non-harmless failures from being ignored", async () => {
    await using tmp = await tmpdir()
    const junit = path.join(tmp.path, "report.xml")
    await Bun.write(
      junit,
      [
        `<testsuite tests=\"1\" failures=\"0\" errors=\"1\" skipped=\"0\" time=\"0.50\">`,
        `<testcase classname=\"x\" name=\"a\">`,
        `<error message=\"boom\">stack trace</error>`,
        "</testcase>",
        "</testsuite>",
      ].join("\n"),
    )

    const result = await parseJUnit(junit, "boom")

    expect(result.tests).toBe(1)
    expect(result.failures).toBe(1)
    expect(result.ignored).toBe(0)
  })

  test("renders one-run summary output without rerun sections", () => {
    const summary = renderSummaryText("deterministic", [
      {
        code: 0,
        file: "/tmp/report-1.xml",
        ignored: 0,
        stats: {
          tests: 12,
          failures: 0,
          skipped: 0,
          time: 1.5,
        },
      },
    ])

    expect(summary).toContain("## ax-code deterministic")
    expect(summary).toContain("- initial: passed")
    expect(summary).toContain("- tests: 12")
    expect(summary).toContain("- runtime: 1.50s")
    expect(summary).toContain("- Artifacts:")
    expect(summary).toContain("- report-1.xml (passed)")
  })

  test("renders rerun summary and ignores/skip highlights", () => {
    const summary = renderSummaryText("recovery", [
      {
        code: 1,
        file: "/tmp/recovery-1.xml",
        ignored: 1,
        stats: {
          tests: 8,
          failures: 0,
          skipped: 2,
          time: 3.25,
        },
      },
      {
        code: 0,
        file: "/tmp/recovery-2.xml",
        ignored: 0,
        stats: {
          tests: 8,
          failures: 0,
          skipped: 0,
          time: 2.75,
        },
      },
    ])

    expect(summary).toContain("- initial: failed")
    expect(summary).toContain("- reruns: 1")
    expect(summary).toContain("- likely flaky: yes")
    expect(summary).toContain("- ignored harmless errors: 1")
    expect(summary).toContain("- max skipped across runs: 2")
    expect(summary).toContain("- recovery-2.xml (passed)")
  })

  test("defaults to deterministic when no positional group is provided", () => {
    expect(resolveTestCIGroup()).toBe("deterministic")
    expect(resolveTestCIGroup(["--dir", ".tmp/test-report"])).toBe("deterministic")
  })

  test("defaults to deterministic when positional group is empty", () => {
    expect(resolveTestCIGroup(["", "recovery"])).toBe("deterministic")
  })

  test("uses the first positional group when provided", () => {
    expect(resolveTestCIGroup(["deterministic"])).toBe("deterministic")
    expect(resolveTestCIGroup(["recovery", "--rerun-on-fail", "1"])).toBe("recovery")
  })

  test("falls back to failure tag counts when failures attribute is invalid", async () => {
    await using tmp = await tmpdir()
    const junit = path.join(tmp.path, "report.xml")
    await Bun.write(
      junit,
      [
        `<testsuite tests=\"1\" failures=\"oops\" errors=\"0\" skipped=\"0\" time=\"0.10\">`,
        `<testcase classname=\"x\" name=\"a\">`,
        `<failure message=\"assertion failed\">expected</failure>`,
        "</testcase>",
        "</testsuite>",
      ].join("\n"),
    )

    const result = await parseJUnit(junit)

    expect(result.failures).toBe(1)
    expect(result.tests).toBe(1)
  })

  test("handles testsuites root tag while rendering skip maxima", () => {
    const summary = renderSummaryText("native", [
      {
        code: 1,
        file: "/tmp/native-1.xml",
        ignored: 0,
        stats: {
          tests: 4,
          failures: 1,
          skipped: 1,
          time: 0.75,
        },
      },
      {
        code: 1,
        file: "/tmp/native-2.xml",
        ignored: 0,
        stats: {
          tests: 4,
          failures: 2,
          skipped: 0,
          time: 0.45,
        },
      },
    ])

    expect(summary).toContain("- reruns: 1")
    expect(summary).toContain("- likely flaky: no")
    expect(summary).toContain("- max skipped across runs: 1")
    expect(summary).toContain("- native-2.xml (failed)")
  })
})
