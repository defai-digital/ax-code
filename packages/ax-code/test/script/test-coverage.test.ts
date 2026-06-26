import { describe, expect, test } from "vitest"
import path from "path"
import { writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "../fixture/fixture"
import {
  compareCoverage,
  createCoverageSummary,
  parseLCOV,
  renderCoverageReport,
  type CoverageSummary,
} from "../../script/test-coverage"

describe("script.test-coverage", () => {
  test("parses lcov files with line, function, and branch counters", () => {
    const files = parseLCOV(
      [
        "TN:",
        "SF:/repo/src/example.ts",
        "FNF:2",
        "FNH:1",
        "DA:1,1",
        "DA:2,0",
        "BRF:2",
        "BRH:1",
        "BRDA:1,0,0,1",
        "BRDA:1,0,1,0",
        "end_of_record",
      ].join("\n"),
    )

    expect(files).toHaveLength(1)
    expect(files[0]?.path).toBe(path.relative(process.cwd(), "/repo/src/example.ts"))
    expect(files[0]?.lines).toMatchObject({ covered: 1, total: 2, available: true, pct: 50 })
    expect(files[0]?.functions).toMatchObject({ covered: 1, total: 2, available: true, pct: 50 })
    expect(files[0]?.branches).toMatchObject({ covered: 1, total: 2, available: true, pct: 50 })
  })

  test("ignores lcov records without SF before parsing others", () => {
    const files = parseLCOV(
      [
        "TN:",
        "FNF:2",
        "FNH:1",
        "DA:1,1",
        "BRF:1",
        "BRH:0",
        "end_of_record",
        "TN:",
        "SF:/repo/src/valid.ts",
        "FNF:1",
        "FNH:1",
        "DA:1,1",
        "end_of_record",
      ].join("\n"),
    )

    expect(files).toHaveLength(1)
    expect(files[0]?.path).toBe(path.relative(process.cwd(), "/repo/src/valid.ts"))
    expect(files[0]?.lines).toMatchObject({ covered: 1, total: 1, available: true })
    expect(files[0]?.functions).toMatchObject({ covered: 1, total: 1, available: true })
  })

  test("creates summaries with baseline trend comparisons and branch-unavailable notes", async () => {
    await using tmp = await tmpdir()
    const cwd = process.cwd()
    const savedWorkspace = process.env["GITHUB_WORKSPACE"]
    delete process.env["GITHUB_WORKSPACE"]
    process.chdir(tmp.path)

    try {
      const lcovFile = path.join(tmp.path, "coverage", "lcov.info")
      await mkdir(path.join(tmp.path, "coverage"), { recursive: true })
      const summaryFile = path.join(tmp.path, "coverage-summary.json")
      const reportFile = path.join(tmp.path, "coverage-report.md")
      const baselineFile = path.join(tmp.path, "coverage-baseline-summary.json")

      await writeFile(
        lcovFile,
        [
          "TN:",
          `SF:${path.join(tmp.path, "src", "alpha.ts")}`,
          "FNF:2",
          "FNH:2",
          "DA:1,1",
          "DA:2,1",
          "end_of_record",
          "TN:",
          `SF:${path.join(tmp.path, "src", "beta.ts")}`,
          "FNF:1",
          "FNH:0",
          "DA:1,1",
          "DA:2,0",
          "end_of_record",
        ].join("\n"),
      )

      const baseline: CoverageSummary = {
        schemaVersion: 1,
        kind: "ax-code-coverage-summary",
        group: "deterministic",
        fileCount: 2,
        metrics: {
          lines: { covered: 2, total: 4, pct: 50, available: true },
          functions: { covered: 1, total: 3, pct: 33.3333333333, available: true },
          branches: { covered: 0, total: 0, available: false },
        },
        files: [
          {
            path: path.join("src", "alpha.ts"),
            lines: { covered: 1, total: 2, pct: 50, available: true },
            functions: { covered: 1, total: 2, pct: 50, available: true },
            branches: { covered: 0, total: 0, available: false },
          },
          {
            path: path.join("src", "beta.ts"),
            lines: { covered: 1, total: 2, pct: 50, available: true },
            functions: { covered: 0, total: 1, pct: 0, available: true },
            branches: { covered: 0, total: 0, available: false },
          },
        ],
        artifacts: {
          lcov: "coverage/lcov.info",
          summary: "coverage-baseline-summary.json",
          report: "coverage-baseline-report.md",
        },
        notes: [],
        meta: {
          createdAt: "2026-04-18T00:00:00.000Z",
          runtime: {
            bun: "1.3.12",
            platform: "linux",
            arch: "x64",
          },
          git: {
            branch: "dev",
            commit: "abc123",
          },
          ci: {},
        },
      }
      await writeFile(baselineFile, JSON.stringify(baseline, null, 2) + "\n")

      process.env.GITHUB_REF_NAME = "feature/coverage"
      process.env.GITHUB_SHA = "def456"

      const summary = await createCoverageSummary({
        group: "deterministic",
        lcovFile,
        summaryFile,
        reportFile,
        baselineFile,
      })

      expect(summary.metrics.lines.pct).toBe(75)
      expect(summary.metrics.functions.pct).toBeCloseTo((2 / 3) * 100)
      expect(summary.metrics.branches.available).toBe(false)
      expect(summary.notes.some((item) => item.includes("branch coverage is unavailable"))).toBe(true)
      expect(summary.trend?.metrics.lines?.deltaPct).toBe(25)
      expect(summary.trend?.metrics.functions?.deltaPct).toBeCloseTo((2 / 3) * 100 - 33.3333333333)
      expect(summary.trend?.metrics.branches).toBeUndefined()

      const report = renderCoverageReport(summary)
      expect(report).toContain("## ax-code deterministic coverage")
      expect(report).toContain("branches: unavailable")
      expect(report).toContain("Top line improvements:")
      expect(report).toContain("src/alpha.ts")
    } finally {
      process.chdir(cwd)
      delete process.env.GITHUB_REF_NAME
      delete process.env.GITHUB_SHA
      if (savedWorkspace !== undefined) process.env["GITHUB_WORKSPACE"] = savedWorkspace
    }
  })

  test("excludes lcov entries outside the repository root", async () => {
    await using tmp = await tmpdir()
    const cwd = process.cwd()
    const savedWorkspace = process.env["GITHUB_WORKSPACE"]
    delete process.env["GITHUB_WORKSPACE"]
    process.chdir(tmp.path)

    try {
      const lcovFile = path.join(tmp.path, "coverage", "lcov.info")
      await mkdir(path.join(tmp.path, "coverage"), { recursive: true })
      const summaryFile = path.join(tmp.path, "coverage-summary.json")
      const reportFile = path.join(tmp.path, "coverage-report.md")
      const externalFile = path.join(tmp.path, "..", "external.ts")

      await writeFile(
        lcovFile,
        [
          "TN:",
          `SF:${path.join(tmp.path, "src", "inside.ts")}`,
          "FNF:1",
          "FNH:1",
          "DA:1,1",
          "end_of_record",
          "TN:",
          `SF:${externalFile}`,
          "FNF:1",
          "FNH:1",
          "DA:1,1",
          "end_of_record",
        ].join("\n"),
      )

      const summary = await createCoverageSummary({
        group: "deterministic",
        lcovFile,
        summaryFile,
        reportFile,
      })

      expect(summary.fileCount).toBe(1)
      expect(summary.files.map((file) => file.path)).toEqual([path.join("src", "inside.ts")])
      expect(
        summary.notes.some((item) => item.includes("excluded 1 coverage entries outside the repository root")),
      ).toBe(true)
    } finally {
      process.chdir(cwd)
      if (savedWorkspace !== undefined) process.env["GITHUB_WORKSPACE"] = savedWorkspace
    }
  })

  test("builds file-level deltas for line and branch trends", () => {
    const current: CoverageSummary = {
      schemaVersion: 1,
      kind: "ax-code-coverage-summary",
      group: "deterministic",
      fileCount: 1,
      metrics: {
        lines: { covered: 3, total: 4, pct: 75, available: true },
        functions: { covered: 2, total: 2, pct: 100, available: true },
        branches: { covered: 3, total: 4, pct: 75, available: true },
      },
      files: [
        {
          path: "src/example.ts",
          lines: { covered: 3, total: 4, pct: 75, available: true },
          functions: { covered: 2, total: 2, pct: 100, available: true },
          branches: { covered: 3, total: 4, pct: 75, available: true },
        },
      ],
      artifacts: { lcov: "coverage/lcov.info", summary: "current.json", report: "current.md" },
      notes: [],
      meta: {
        createdAt: "2026-04-18T00:00:00.000Z",
        runtime: { bun: "1.3.12", platform: "linux", arch: "x64" },
        git: {},
        ci: {},
      },
    }

    const baseline: CoverageSummary = {
      ...current,
      artifacts: { lcov: "coverage/lcov.info", summary: "baseline.json", report: "baseline.md" },
      files: [
        {
          path: "src/example.ts",
          lines: { covered: 4, total: 4, pct: 100, available: true },
          functions: { covered: 2, total: 2, pct: 100, available: true },
          branches: { covered: 4, total: 4, pct: 100, available: true },
        },
      ],
      metrics: {
        lines: { covered: 4, total: 4, pct: 100, available: true },
        functions: { covered: 2, total: 2, pct: 100, available: true },
        branches: { covered: 4, total: 4, pct: 100, available: true },
      },
    }

    const trend = compareCoverage(current, baseline, "/tmp/baseline.json")

    expect(trend.metrics.lines?.deltaPct).toBe(-25)
    expect(trend.metrics.branches?.deltaPct).toBe(-25)
    expect(trend.files.lineRegressions[0]?.path).toBe("src/example.ts")
    expect(trend.files.branchRegressions[0]?.path).toBe("src/example.ts")
  })

  test("handles BRDA-only coverage entries without BRF/BRH totals", () => {
    const files = parseLCOV(
      [
        "TN:",
        "SF:/repo/src/branch-only.ts",
        "DA:1,1",
        "DA:2,0",
        "BRDA:10,0,0,0",
        "BRDA:10,0,1,1",
        "BRDA:11,0,0,2",
        "end_of_record",
      ].join("\n"),
    )

    expect(files).toHaveLength(1)
    expect(files[0]?.branches).toMatchObject({ covered: 2, total: 3, available: true, pct: 66.66666666666666 })
  })

  test("ignores malformed DA values without breaking parser", () => {
    const files = parseLCOV(
      ["TN:", "SF:/repo/src/malformed.ts", "DA:1,abc", "DA:2,3", "DA:3,0", "end_of_record"].join("\n"),
    )

    expect(files).toHaveLength(1)
    expect(files[0]?.lines).toMatchObject({ covered: 1, total: 2, available: true, pct: 50 })
  })

  test("records baseline mismatch warning when coverage groups differ", async () => {
    await using tmp = await tmpdir()
    const cwd = process.cwd()
    const savedWorkspace = process.env["GITHUB_WORKSPACE"]
    delete process.env["GITHUB_WORKSPACE"]
    process.chdir(tmp.path)

    try {
      const lcovFile = path.join(tmp.path, "coverage", "lcov.info")
      await mkdir(path.join(tmp.path, "coverage"), { recursive: true })
      const summaryFile = path.join(tmp.path, "coverage-summary.json")
      const reportFile = path.join(tmp.path, "coverage-report.md")
      const baselineFile = path.join(tmp.path, "coverage-baseline-summary.json")

      await writeFile(
        lcovFile,
        ["TN:", `SF:${path.join(tmp.path, "src", "only.ts")}`, "FNF:1", "FNH:1", "DA:1,1", "end_of_record"].join("\n"),
      )

      const baseline: CoverageSummary = {
        schemaVersion: 1,
        kind: "ax-code-coverage-summary",
        group: "recovery",
        fileCount: 1,
        metrics: {
          lines: { covered: 1, total: 1, pct: 100, available: true },
          functions: { covered: 1, total: 1, pct: 100, available: true },
          branches: { covered: 0, total: 0, available: false },
        },
        files: [
          {
            path: path.join("src", "only.ts"),
            lines: { covered: 1, total: 1, pct: 100, available: true },
            functions: { covered: 1, total: 1, pct: 100, available: true },
            branches: { covered: 0, total: 0, available: false },
          },
        ],
        artifacts: {
          lcov: "coverage/lcov.info",
          summary: "coverage-baseline-summary.json",
          report: "coverage-baseline-report.md",
        },
        notes: [],
        meta: {
          createdAt: "2026-04-18T00:00:00.000Z",
          runtime: { bun: "1.3.12", platform: "linux", arch: "x64" },
          git: {},
          ci: {},
        },
      }
      await writeFile(baselineFile, JSON.stringify(baseline, null, 2) + "\n")

      const summary = await createCoverageSummary({
        group: "deterministic",
        lcovFile,
        summaryFile,
        reportFile,
        baselineFile,
      })

      expect(summary.trend).toBeUndefined()
      expect(
        summary.notes.some((line) =>
          line.includes("baseline summary at coverage-baseline-summary.json did not match group deterministic"),
        ),
      ).toBe(true)
    } finally {
      process.chdir(cwd)
      if (savedWorkspace !== undefined) process.env["GITHUB_WORKSPACE"] = savedWorkspace
    }
  })

  test("renders lowest branch coverage when branch data is available", () => {
    const summary: CoverageSummary = {
      schemaVersion: 1,
      kind: "ax-code-coverage-summary",
      group: "deterministic",
      fileCount: 2,
      metrics: {
        lines: { covered: 2, total: 4, pct: 50, available: true },
        functions: { covered: 2, total: 3, pct: 66.66666666666666, available: true },
        branches: { covered: 1, total: 3, pct: 33.3333333333, available: true },
      },
      files: [
        {
          path: "src/one.ts",
          lines: { covered: 1, total: 2, pct: 50, available: true },
          functions: { covered: 1, total: 1, pct: 100, available: true },
          branches: { covered: 1, total: 3, pct: 33.3333333333, available: true },
        },
        {
          path: "src/two.ts",
          lines: { covered: 1, total: 2, pct: 50, available: true },
          functions: { covered: 1, total: 2, pct: 50, available: true },
          branches: { covered: 0, total: 1, pct: 0, available: true },
        },
      ],
      artifacts: { lcov: "coverage/lcov.info", summary: "coverage-summary.json", report: "coverage-report.md" },
      notes: [],
      meta: {
        createdAt: "2026-04-18T00:00:00.000Z",
        runtime: { bun: "1.3.12", platform: "linux", arch: "x64" },
        git: {},
        ci: {},
      },
    }

    const report = renderCoverageReport(summary)

    expect(report).toContain("Lowest branch coverage:")
    expect(report).toContain("src/two.ts: 0.00%")
  })
})
