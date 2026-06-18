import { describe, expect, test } from "bun:test"
import path from "path"
import z from "zod"
import { Instance } from "../../src/project/instance"
import {
  buildScanToolResult,
  dedupCoverageNotice,
  hasSourceFile,
  scanCoverageNotice,
  SCAN_TOOL_COMMON_PARAMETERS,
  scanToolCommonDetectInput,
} from "../../src/tool/scan-coverage"
import { tmpdir } from "../fixture/fixture"

describe("scan coverage notices", () => {
  test("coerces common numeric tool parameters from string values", () => {
    const parsed = z.object(SCAN_TOOL_COMMON_PARAMETERS).parse({
      maxFiles: "12",
      maxFindingsPerFile: "3",
    })

    expect(parsed.maxFiles).toBe(12)
    expect(parsed.maxFindingsPerFile).toBe(3)
  })

  test("builds common detect input for scan tool wrappers", () => {
    expect(
      scanToolCommonDetectInput({
        excludeTests: false,
        include: ["src/**/*.ts"],
        maxFiles: 12,
        maxFindingsPerFile: 3,
      }),
    ).toEqual({
      excludeTests: false,
      include: ["src/**/*.ts"],
      maxFiles: 12,
      maxFindingsPerFile: 3,
      scope: "worktree",
    })
  })

  test("continues source detection after one glob pattern fails", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const found = hasSourceFile(["bad-pattern", "src/**/*.py"], (pattern) => ({
          scanSync: () => {
            if (pattern === "bad-pattern") throw new Error("scan failed")
            return ["src/app.py"]
          },
        }))

        expect(found).toBe(true)
      },
    })
  })

  test("warns when JS/TS scanners run in a Rust workspace without Rust coverage", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "Cargo.toml"), "[workspace]\nmembers = []\n")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const notice = await scanCoverageNotice({ include: ["**/*.ts", "**/*.js"] })

        expect(notice.lines.join("\n")).toContain("Rust workspace detected")
        expect(notice.lines.join("\n")).toContain("did not cover Rust source files")
        expect(notice.metadata).toEqual({
          rustWorkspace: true,
          pythonWorkspace: false,
          rubyWorkspace: false,
          rustSourceCoverage: "not_covered",
          pythonSourceCoverage: "not_applicable",
          rubySourceCoverage: "not_applicable",
          languageScope: "js_ts_patterns",
        })
      },
    })
  })

  test("recognizes language extensions inside brace globs", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "Cargo.toml"), "[workspace]\nmembers = []\n")
        await Bun.write(path.join(dir, "pyproject.toml"), '[project]\nname = "demo"\n')
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const notice = await scanCoverageNotice({ include: ["**/*.{rs,ts}", "**/*.{js,py}"] })

        expect(notice.metadata.rustSourceCoverage).toBe("limited")
        expect(notice.metadata.pythonSourceCoverage).toBe("limited")
        expect(notice.lines.join("\n")).not.toContain("did not cover Rust source files")
        expect(notice.lines.join("\n")).not.toContain("did not cover Python source files")
      },
    })
  })

  test("treats broad include globs as limited source coverage", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "Cargo.toml"), "[workspace]\nmembers = []\n")
        await Bun.write(path.join(dir, "pyproject.toml"), '[project]\nname = "demo"\n')
        await Bun.write(path.join(dir, "Gemfile"), 'source "https://rubygems.org"\n')
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const notice = await scanCoverageNotice({ include: ["src/**", "scripts/**/*.*"] })

        expect(notice.metadata.rustSourceCoverage).toBe("limited")
        expect(notice.metadata.pythonSourceCoverage).toBe("limited")
        expect(notice.metadata.rubySourceCoverage).toBe("limited")
        expect(notice.lines.join("\n")).not.toContain("did not cover Rust source files")
        expect(notice.lines.join("\n")).not.toContain("did not cover Python source files")
        expect(notice.lines.join("\n")).not.toContain("did not cover Ruby source files")
      },
    })
  })

  test("stays quiet outside Rust workspaces", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const notice = await scanCoverageNotice({ include: ["**/*.ts"] })

        expect(notice.lines).toEqual([])
        expect(notice.metadata.rustWorkspace).toBe(false)
        expect(notice.metadata.pythonWorkspace).toBe(false)
        expect(notice.metadata.rubyWorkspace).toBe(false)
      },
    })
  })

  test("warns when JS/TS scanners run in Python and Ruby workspaces without source coverage", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "pyproject.toml"), '[project]\nname = "demo"\n')
        await Bun.write(path.join(dir, "Gemfile"), 'source "https://rubygems.org"\n')
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const notice = await scanCoverageNotice({ include: ["**/*.ts", "**/*.js"] })

        expect(notice.lines.join("\n")).toContain("Python workspace detected")
        expect(notice.lines.join("\n")).toContain("did not cover Python source files")
        expect(notice.lines.join("\n")).toContain("Ruby workspace detected")
        expect(notice.lines.join("\n")).toContain("did not cover Ruby source files")
        expect(notice.metadata.pythonSourceCoverage).toBe("not_covered")
        expect(notice.metadata.rubySourceCoverage).toBe("not_covered")
      },
    })
  })

  test("detects Python and Ruby workspaces from source files when manifests are absent", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "scripts", "tool.py"), "print('hello')\n")
        await Bun.write(path.join(dir, "lib", "worker.rb"), "puts 'hello'\n")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const notice = await scanCoverageNotice({ include: ["**/*.ts"] })

        expect(notice.metadata.pythonWorkspace).toBe(true)
        expect(notice.metadata.rubyWorkspace).toBe(true)
        expect(notice.metadata.pythonSourceCoverage).toBe("not_covered")
        expect(notice.metadata.rubySourceCoverage).toBe("not_covered")
      },
    })
  })

  test("marks dedup scan as symbol-limited in Rust workspaces", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "Cargo.toml"), "[workspace]\nmembers = []\n")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const notice = await dedupCoverageNotice()

        expect(notice.lines.join("\n")).toContain("not Rust compiler semantics")
        expect(notice.metadata).toEqual({
          rustWorkspace: true,
          pythonWorkspace: false,
          rubyWorkspace: false,
          rustSourceCoverage: "limited",
          pythonSourceCoverage: "not_applicable",
          rubySourceCoverage: "not_applicable",
          languageScope: "code_graph_symbols",
        })
      },
    })
  })

  test("builds a common scan tool result envelope with capped findings", async () => {
    await using tmp = await tmpdir()
    const findings = Array.from({ length: 42 }, (_, i) => ({ id: i + 1 }))
    const report = {
      filesScanned: 3,
      findings,
      truncated: true,
    }

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await buildScanToolResult({
          toolName: "demo_scan",
          report,
          renderFinding: (finding) => [`- finding ${finding.id}`],
        })

        expect(result.title).toBe("demo_scan 42 finding(s)")
        expect(result.output).toContain("Scanned 3 files")
        expect(result.output).toContain("Findings: 42")
        expect(result.output).toContain("Warning: file cap was hit")
        expect(result.output).toContain("- finding 40")
        expect(result.output).not.toContain("- finding 41")
        expect(result.output).toContain("... and 2 more (see metadata)")
        expect(result.metadata).toMatchObject({
          filesScanned: 3,
          findingCount: 42,
          truncated: true,
        })
        expect(result.metadata.report).toBe(report)
      },
    })
  })
})
