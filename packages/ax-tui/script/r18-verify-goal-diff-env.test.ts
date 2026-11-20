import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

// Regression for the goal diff verifier: diff-tree must use NUL-separated raw
// paths (core.quotePath=false still C-quotes `"`, `\`, and control bytes), and
// git environment/invocation failures must exit 2 with a FAIL message instead
// of an uncaught stack. Baseline resolution keeps its exit-1 contract.

const scriptSource = fs.readFileSync(new URL("./verify-goal-diff.mjs", import.meta.url), "utf8")
const nodeDir = path.dirname(process.execPath)
const realGit = process.platform === "win32" ? "git" : execFileSync("which", ["git"], { encoding: "utf8" }).trim()

interface Fixture {
  root: string
  pkg: string
  baseline: string
  git: (...args: string[]) => string
}

const fixtures: string[] = []

function makeFixture(): Fixture {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "r18-goal-diff-env-")))
  fixtures.push(root)
  const pkg = path.join(root, "packages", "ax-tui")
  fs.mkdirSync(path.join(pkg, "script"), { recursive: true })
  fs.mkdirSync(path.join(pkg, "src"), { recursive: true })
  const git = (...args: string[]): string => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" })
  git("init", "-q")
  git("config", "user.email", "qa@example.com")
  git("config", "user.name", "QA")
  fs.writeFileSync(path.join(pkg, "package.json"), '{"name":"fixture"}\n')
  fs.writeFileSync(path.join(pkg, "renderer-artifacts.json"), "{}\n")
  fs.writeFileSync(path.join(pkg, "src", "a.ts"), "export const a = 1\n")
  git("add", "-A")
  git("commit", "-qm", "baseline")
  const baseline = git("rev-parse", "HEAD").trim()
  fs.writeFileSync(path.join(pkg, "script", "verify-goal-diff.mjs"), scriptSource)
  return { root, pkg, baseline, git }
}

function commit(fixture: Fixture, message: string): void {
  fixture.git("add", "-A")
  fixture.git("commit", "-qm", message)
}

function runVerifier(
  fixture: Fixture,
  overrides: Record<string, string | undefined> = {},
  baseline = fixture.baseline,
): ReturnType<typeof spawnSync> {
  const env: Record<string, string | undefined> = {
    PATH: process.platform === "win32" ? process.env.PATH : `${nodeDir}${path.delimiter}/usr/bin${path.delimiter}/bin`,
    ...(process.platform === "win32" && { SystemRoot: process.env.SystemRoot }),
    HOME: fixture.root,
    ...overrides,
  }
  for (const key of Object.keys(env)) {
    if (env[key] === undefined) delete env[key]
  }
  return spawnSync(process.execPath, [path.join(fixture.pkg, "script", "verify-goal-diff.mjs"), baseline], {
    env: env as Record<string, string>,
    encoding: "utf8",
    timeout: 30_000,
  })
}

afterEach(() => {
  for (const root of fixtures.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

const posixDescribe = process.platform === "win32" ? describe.skip : describe

posixDescribe("verify-goal-diff raw path and environment contracts", () => {
  it("accepts paths containing quotes, backslashes, and control bytes", () => {
    const fixture = makeFixture()
    fs.writeFileSync(path.join(fixture.pkg, "src", 'a"b.ts'), "export const q = 1\n")
    fs.writeFileSync(path.join(fixture.pkg, "src", "back\\slash.ts"), "export const b = 1\n")
    fs.writeFileSync(path.join(fixture.pkg, "src", "tab\there.ts"), "export const t = 1\n")
    commit(fixture, "special byte paths")
    const result = runVerifier(fixture)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("PASS: 1 commit(s) satisfy the goal diff contract")
  })

  it("accepts renames whose source and destination contain quotes", () => {
    const fixture = makeFixture()
    fs.writeFileSync(path.join(fixture.pkg, "src", 'a"b.ts'), "export const q = 1\n")
    commit(fixture, "add quoted path")
    fixture.git("mv", 'packages/ax-tui/src/a"b.ts', 'packages/ax-tui/src/c"d.ts')
    commit(fixture, "rename quoted path")
    const result = runVerifier(fixture)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("PASS: 2 commit(s) satisfy the goal diff contract")
  })

  it("fails loudly with exit 2 when git is not on PATH", () => {
    const fixture = makeFixture()
    fs.writeFileSync(path.join(fixture.pkg, "src", "a.ts"), "export const a = 2\n")
    commit(fixture, "in scope")
    const emptyBin = path.join(fixture.root, "empty-bin")
    fs.mkdirSync(emptyBin)
    const result = runVerifier(fixture, { PATH: emptyBin })
    expect(result.status).toBe(2)
    expect(result.stderr).toContain("FAIL: git")
  })

  it("fails loudly with exit 2 when a git subcommand fails mid-run", () => {
    const fixture = makeFixture()
    fs.writeFileSync(path.join(fixture.pkg, "src", "a.ts"), "export const a = 2\n")
    commit(fixture, "in scope")
    const fakeDir = path.join(fixture.root, "fake-bin")
    fs.mkdirSync(fakeDir)
    const fakeGit = path.join(fakeDir, "git")
    fs.writeFileSync(
      fakeGit,
      '#!/bin/sh\nfor arg in "$@"; do if [ "$arg" = "rev-list" ]; then echo "fake git: rev-list unavailable" >&2; exit 128; fi; done\n' +
        `exec ${JSON.stringify(realGit)} "$@"\n`,
    )
    fs.chmodSync(fakeGit, 0o755)
    const result = runVerifier(fixture, {
      PATH: `${fakeDir}${path.delimiter}${nodeDir}${path.delimiter}/usr/bin${path.delimiter}/bin`,
    })
    expect(result.status).toBe(2)
    expect(result.stderr).toContain("FAIL: git rev-list")
  })
})

describe("verify-goal-diff baseline contract", () => {
  it("still reports an unresolvable baseline as a contract failure (exit 1)", () => {
    const fixture = makeFixture()
    const result = runVerifier(fixture, {}, "deadbeef".repeat(5))
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("does not resolve to a commit")
  })
})
