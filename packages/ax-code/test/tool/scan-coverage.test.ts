import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { dedupCoverageNotice, scanCoverageNotice } from "../../src/tool/scan-coverage"
import { tmpdir } from "../fixture/fixture"

describe("scan coverage notices", () => {
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
})
