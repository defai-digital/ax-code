import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

// Regression for the goal diff verifier: path policy must match package-local
// paths when the package is a repository subdirectory, non-ASCII paths must
// not be C-quoted, copy destinations must be checked, and root-file patterns
// must be exact rather than prefix matches. Exercised in fixture repositories.

const scriptSource = fs.readFileSync(new URL("./verify-goal-diff.mjs", import.meta.url), "utf8")
const nodeDir = path.dirname(process.execPath)

interface Fixture {
  root: string
  pkg: string
  baseline: string
  git: (...args: string[]) => string
}

const fixtures: string[] = []

function makeFixture(): Fixture {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "r17-goal-diff-")))
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

function runVerifier(fixture: Fixture): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [path.join(fixture.pkg, "script", "verify-goal-diff.mjs"), fixture.baseline], {
    env: { PATH: `${nodeDir}${path.delimiter}/usr/bin${path.delimiter}/bin`, HOME: fixture.root },
    encoding: "utf8",
    timeout: 30_000,
  })
}

afterEach(() => {
  for (const root of fixtures.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

describe("verify-goal-diff scope contract", () => {
  it("accepts in-scope commits when the package is a repository subdirectory", () => {
    const fixture = makeFixture()
    fs.writeFileSync(path.join(fixture.pkg, "src", "a.ts"), "export const a = 2\n")
    commit(fixture, "in scope")
    const result = runVerifier(fixture)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("PASS: 1 commit(s) satisfy the goal diff contract")
  })

  it("rejects commits touching paths outside the package subtree", () => {
    const fixture = makeFixture()
    const other = path.join(fixture.root, "packages", "other")
    fs.mkdirSync(other, { recursive: true })
    fs.writeFileSync(path.join(other, "x.ts"), "export const x = 1\n")
    commit(fixture, "out of subtree")
    const result = runVerifier(fixture)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("packages/other/x.ts")
  })

  it("accepts non-ASCII paths without C-quoting", () => {
    const fixture = makeFixture()
    fs.writeFileSync(path.join(fixture.pkg, "src", "日本語.ts"), "export const jp = 1\n")
    commit(fixture, "non-ascii path")
    const result = runVerifier(fixture)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("PASS: 1 commit(s) satisfy the goal diff contract")
  })

  it("rejects copy destinations outside the allowed scope", () => {
    const fixture = makeFixture()
    const source = path.join(fixture.pkg, "src", "a.ts")
    fs.copyFileSync(source, path.join(fixture.pkg, "evil.txt"))
    fs.writeFileSync(source, "export const a = 2\n")
    commit(fixture, "copy out of scope")
    const result = runVerifier(fixture)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("evil.txt")
  })

  it("rejects root files that merely prefix-match an artifact name", () => {
    const fixture = makeFixture()
    fs.writeFileSync(path.join(fixture.pkg, "renderer-artifacts.json.bak"), "{}\n")
    commit(fixture, "artifact lookalike")
    const result = runVerifier(fixture)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("renderer-artifacts.json.bak")
  })

  it("accepts changes to the artifact inventory itself", () => {
    const fixture = makeFixture()
    fs.writeFileSync(path.join(fixture.pkg, "renderer-artifacts.json"), '{"updated":true}\n')
    commit(fixture, "artifact inventory")
    const result = runVerifier(fixture)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("PASS: 1 commit(s) satisfy the goal diff contract")
  })

  it("rejects package.json changes since baseline", () => {
    const fixture = makeFixture()
    fs.writeFileSync(path.join(fixture.pkg, "package.json"), '{"name":"fixture","version":"9.9.9"}\n')
    commit(fixture, "manifest change")
    const result = runVerifier(fixture)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("package.json")
  })
})
