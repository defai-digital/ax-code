import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

// Regression for the deepseek diff-review gate: git failures must exit 2 with a
// FAIL message instead of an uncaught stack, timeout overrides above Node's
// setTimeout clamp must be rejected, and the maintained-source diff must cover
// the Solid reconciler and spinner/chart widgets (not generated solid/src).
// Exercised end-to-end in a fixture repository with a fake CLI.

const scriptSource = fs.readFileSync(new URL("./deepseek-diff-review.mjs", import.meta.url), "utf8")
const nodeDir = path.dirname(process.execPath)

const FAKE_CLI = `#!/usr/bin/env node
import fs from "node:fs"
let input = ""
process.stdin.on("data", (chunk) => { input += chunk })
process.stdin.on("end", () => {
  const mode = process.env.FAKE_CLI_MODE ?? "clean"
  if (mode === "dump") fs.writeFileSync(process.env.FAKE_CLI_DUMP, input)
  if (mode === "slow") {
    setTimeout(() => process.stdout.write("VERDICT: NO-FINDINGS\\n"), 300)
  } else {
    process.stdout.write("VERDICT: NO-FINDINGS\\n")
  }
})
`

interface Fixture {
  root: string
  pkg: string
  baseline: string
  cli: string
  home: string
  git: (...args: string[]) => string
}

const fixtures: string[] = []

function makeFixture(): Fixture {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "r18-deepseek-env-")))
  fixtures.push(root)
  const pkg = path.join(root, "packages", "ax-tui")
  fs.mkdirSync(path.join(pkg, "script"), { recursive: true })
  fs.mkdirSync(path.join(pkg, "src"), { recursive: true })
  const git = (...args: string[]): string => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" })
  git("init", "-q")
  git("config", "user.email", "qa@example.com")
  git("config", "user.name", "QA")
  fs.writeFileSync(path.join(pkg, "src", "a.ts"), "export const a = 1\n")
  git("add", "-A")
  git("commit", "-qm", "baseline")
  const baseline = git("rev-parse", "HEAD").trim()
  fs.writeFileSync(path.join(pkg, "src", "a.ts"), "export const a = 2\n")
  git("add", "-A")
  git("commit", "-qm", "change")
  fs.writeFileSync(path.join(pkg, "script", "deepseek-diff-review.mjs"), scriptSource)
  const cli = path.join(root, "fake-deepseek.mjs")
  fs.writeFileSync(cli, FAKE_CLI)
  fs.chmodSync(cli, 0o755)
  const home = path.join(root, "home")
  fs.mkdirSync(home)
  return { root, pkg, baseline, cli, home, git }
}

function runReview(
  fixture: Fixture,
  overrides: Record<string, string | undefined> = {},
  mode = "clean",
  baseline = fixture.baseline,
): ReturnType<typeof spawnSync> {
  const env: Record<string, string | undefined> = {
    PATH: `${nodeDir}${path.delimiter}/usr/bin${path.delimiter}/bin`,
    HOME: fixture.home,
    FAKE_CLI_MODE: mode,
    DEEPSEEK_CLI: fixture.cli,
    ...overrides,
  }
  for (const key of Object.keys(env)) {
    if (env[key] === undefined) delete env[key]
  }
  return spawnSync(process.execPath, [path.join(fixture.pkg, "script", "deepseek-diff-review.mjs"), baseline], {
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

posixDescribe("deepseek-diff-review environment and scope contracts", () => {
  it("fails loudly with exit 2 when a git invocation fails on a bad baseline", () => {
    const fixture = makeFixture()
    const result = runReview(fixture, {}, "clean", "deadbeef".repeat(5))
    expect(result.status).toBe(2)
    expect(result.stderr).toContain("FAIL: git")
  })

  it("rejects timeout overrides above Node's setTimeout clamp instead of killing the CLI instantly", () => {
    const fixture = makeFixture()
    const result = runReview(fixture, { DEEPSEEK_REVIEW_TIMEOUT_MS: "100000000000" }, "slow")
    expect(result.status).toBe(2)
    expect(result.stderr).toContain("DEEPSEEK_REVIEW_TIMEOUT_MS")
  })

  it("accepts the maximum representable timeout override", () => {
    const fixture = makeFixture()
    const result = runReview(fixture, { DEEPSEEK_REVIEW_TIMEOUT_MS: "2147483647" }, "slow")
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("PASS: deepseek review completed with NO-FINDINGS")
  })

  it("reviews maintained Solid/spinner/chart sources but not generated solid/src", () => {
    const fixture = makeFixture()
    for (const relative of [
      path.join("solid", "source", "x.ts"),
      path.join("spinner", "src", "y.ts"),
      path.join("chart", "src", "z.ts"),
      path.join("solid", "src", "gen.js"),
    ]) {
      const target = path.join(fixture.pkg, relative)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, "export const added = 1\n")
    }
    fixture.git("add", "-A")
    fixture.git("commit", "-qm", "maintained widgets")
    const dumpPath = path.join(fixture.root, "prompt-dump.txt")
    const result = runReview(fixture, { FAKE_CLI_DUMP: dumpPath }, "dump")
    expect(result.status).toBe(0)
    const dump = fs.readFileSync(dumpPath, "utf8")
    expect(dump).toContain("diff --git a/packages/ax-tui/solid/source/x.ts")
    expect(dump).toContain("diff --git a/packages/ax-tui/spinner/src/y.ts")
    expect(dump).toContain("diff --git a/packages/ax-tui/chart/src/z.ts")
    expect(dump).not.toContain("diff --git a/packages/ax-tui/solid/src/gen.js")
  })
})
