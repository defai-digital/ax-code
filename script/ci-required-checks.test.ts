import { describe, expect, test } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"
import { requiredCheckFailures } from "./ci-required-checks"

const green = {
  CI_PLAN: "success",
  CI_CHECKS: "success",
  CI_DETERMINISTIC: "success",
  CI_RUNTIME: "success",
  CI_WINDOWS: "success",
  CI_TUI: "success",
  CI_NATIVE_REQUIRED: "true",
  CI_NATIVE: "success",
}

describe("required CI results", () => {
  test("accepts a complete pass and only the explicitly unneeded native skip", () => {
    expect(requiredCheckFailures(green)).toEqual([])
    expect(requiredCheckFailures({ ...green, CI_NATIVE_REQUIRED: "false", CI_NATIVE: "skipped" })).toEqual([])
  })
  for (const name of ["PLAN", "CHECKS", "DETERMINISTIC", "RUNTIME", "WINDOWS", "TUI", "NATIVE"]) {
    test.each(["failure", "cancelled", "skipped", "", undefined])(`rejects ${name} result %s`, (status) => {
      expect(requiredCheckFailures({ ...green, [`CI_${name}`]: status }).length).toBeGreaterThan(0)
    })
  }
  test("rejects absent or corrupt routing rather than excusing skipped native tests", () => {
    expect(requiredCheckFailures({ ...green, CI_NATIVE_REQUIRED: "", CI_NATIVE: "skipped" })).not.toEqual([])
  })
  test("both triggers include every tested package and shared toolchain input", () => {
    const source = readFileSync(".github/workflows/ax-code-ci.yml", "utf8")
    for (const event of ["push", "pull_request"]) {
      const block = source.match(new RegExp(`^  ${event}:\\n[\\s\\S]*?(?=^  \\w|^\\S)`, "m"))![0]
      const patterns = [...block.matchAll(/^      - "([^"]+)"$/gm)].map((match) => match[1])
      for (const file of [
        "packages/ax-agent-runtime/src/index.ts",
        "packages/ax-wiki/src/index.ts",
        ".github/actions/setup-ax-code-toolchain/action.yml",
        "patches/example.patch",
        "tools/example.ts",
        "tsconfig.json",
      ])
        expect(
          patterns.some((pattern) => path.matchesGlob(file, pattern)),
          `${event}: ${file}`,
        ).toBe(true)
    }
  })
  test("the aggregate waits for all required jobs and runs even after failures", () => {
    const source = readFileSync(".github/workflows/ax-code-ci.yml", "utf8")
    const job = source.slice(source.indexOf("\n  required-checks:"))
    expect(job).toContain("if: always()")
    for (const name of [
      "evidence-plan",
      "evidence-native",
      "checks",
      "deterministic",
      "runtime-contract",
      "windows-snapshot",
      "tui-node26-smoke",
    ]) {
      expect(job).toContain(`needs.${name}.result`)
    }
    expect(job).toContain("script/ci-required-checks.ts")
  })

  test("offline integration builds and probes its real PTY dependency before collecting tests", () => {
    const source = readFileSync(".github/workflows/ax-code-ci.yml", "utf8")
    const lane = source.match(/^  integration:\n[\s\S]*?(?=^  [\w-]+:|$(?![\s\S]))/m)![0]
    const build = lane.indexOf("node script/rebuild-node-pty.mjs")
    const probe = lane.indexOf("node script/verify-pty.cjs")
    const tests = lane.indexOf("test:ci -- integration --rerun-on-fail 0")
    expect(build).toBeGreaterThan(0)
    expect(probe).toBeGreaterThan(build)
    expect(tests).toBeGreaterThan(probe)
    expect(lane).toContain("ripgrep build-essential python3")
    expect(lane).toContain("if-no-files-found: error")
  })
})
