import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

// Regression for the deepseek diff-review gate: bounded output collection must
// keep the trailing verdict, large diffs must not abort git's stdio buffer,
// the CLI override must be exclusive, and env overrides must be validated.
// The gate is exercised end-to-end in a fixture repository with a fake CLI.

const scriptSource = fs.readFileSync(new URL("./deepseek-diff-review.mjs", import.meta.url), "utf8")
const nodeDir = path.dirname(process.execPath)

const FAKE_CLI = `#!/usr/bin/env node
process.stdin.on("data", () => {})
process.stdin.on("end", () => {
  const mode = process.env.FAKE_CLI_MODE ?? "clean"
  const args = process.argv.slice(2)
  if (mode === "reject-no-tools" && args.includes("--no-tools")) {
    process.stderr.write("unknown flag --no-tools\\n")
    process.exit(5)
  }
  if (mode === "require-no-tools" && !args.includes("--no-tools")) {
    process.stderr.write("missing --no-tools\\n")
    process.exit(5)
  }
  const filler = "filler line\\n".repeat(45_000)
  if (mode === "tail-findings") {
    process.stdout.write("example quote: VERDICT: NO-FINDINGS\\n" + filler + "VERDICT: FINDINGS\\n")
  } else if (mode === "tail-clean") {
    process.stdout.write(filler + "VERDICT: NO-FINDINGS\\n")
  } else if (mode === "slow") {
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
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "r17-deepseek-")))
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
  return spawnSync(process.execPath, [path.join(fixture.pkg, "script", "deepseek-diff-review.mjs"), fixture.baseline], {
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

posixDescribe("deepseek-diff-review gate", () => {
  it("keeps a trailing FINDINGS verdict when output exceeds the collection bound", () => {
    const fixture = makeFixture()
    const result = runReview(fixture, {}, "tail-findings")
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("reported FINDINGS")
  })

  it("keeps a trailing NO-FINDINGS verdict when output exceeds the collection bound", () => {
    const fixture = makeFixture()
    const result = runReview(fixture, {}, "tail-clean")
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("PASS: deepseek review completed with NO-FINDINGS")
  })

  it("reviews diffs larger than the default execFileSync buffer", () => {
    const fixture = makeFixture()
    const big = `${"x".repeat(64)}\n`.repeat(32_768)
    fs.writeFileSync(path.join(fixture.pkg, "src", "big.ts"), big)
    fixture.git("add", "-A")
    fixture.git("commit", "-qm", "big diff")
    const result = runReview(fixture)
    expect(result.stderr).not.toContain("ENOBUFS")
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("PASS: deepseek review completed with NO-FINDINGS")
  })

  it("fails loudly when the DEEPSEEK_CLI override does not exist instead of falling back to PATH", () => {
    const fixture = makeFixture()
    const binDir = path.join(fixture.root, "bin-path")
    fs.mkdirSync(binDir)
    const pathBinary = path.join(binDir, "deepseek")
    fs.writeFileSync(pathBinary, FAKE_CLI)
    fs.chmodSync(pathBinary, 0o755)
    const result = runReview(fixture, {
      DEEPSEEK_CLI: path.join(fixture.root, "nonexistent", "deepseek"),
      PATH: `${binDir}${path.delimiter}${nodeDir}${path.delimiter}/usr/bin${path.delimiter}/bin`,
    })
    expect(result.status).toBe(2)
    expect(result.stderr).toContain("deepseek CLI not found")
  })

  it("skips PATH entries named deepseek that are not executable files", () => {
    const fixture = makeFixture()
    const dirDir = path.join(fixture.root, "bin-dir")
    fs.mkdirSync(path.join(dirDir, "deepseek"), { recursive: true })
    const binDir = path.join(fixture.root, "bin-real")
    fs.mkdirSync(binDir)
    const pathBinary = path.join(binDir, "deepseek")
    fs.writeFileSync(pathBinary, FAKE_CLI)
    fs.chmodSync(pathBinary, 0o755)
    const result = runReview(fixture, {
      DEEPSEEK_CLI: undefined,
      PATH: `${dirDir}${path.delimiter}${binDir}${path.delimiter}${nodeDir}${path.delimiter}/usr/bin${path.delimiter}/bin`,
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain(`deepseek CLI found: ${pathBinary}`)
  })

  it("rejects invalid timeout overrides instead of killing the CLI instantly", () => {
    const fixture = makeFixture()
    for (const value of ["", "abc", "0", "-5"]) {
      const result = runReview(fixture, { DEEPSEEK_REVIEW_TIMEOUT_MS: value }, "slow")
      expect(result.status, `timeout override ${JSON.stringify(value)}`).toBe(2)
      expect(result.stderr).toContain("positive finite number of milliseconds")
    }
  })

  it("honors an empty DEEPSEEK_REVIEW_ARGS override as an empty argument list", () => {
    const fixture = makeFixture()
    const result = runReview(fixture, { DEEPSEEK_REVIEW_ARGS: "" }, "reject-no-tools")
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("PASS: deepseek review completed with NO-FINDINGS")
  })

  it("passes --no-tools by default", () => {
    const fixture = makeFixture()
    const result = runReview(fixture, {}, "require-no-tools")
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("PASS: deepseek review completed with NO-FINDINGS")
  })
})
