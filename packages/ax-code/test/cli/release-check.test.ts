import { describe, expect, test } from "vitest"
import { chmod, mkdtemp, writeFile, mkdir } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Process } from "../../src/util/process"
import {
  decodeReleasePackageJsonValue,
  parseReleasePackageJsonText,
  releaseReadinessChecks,
  runChecks,
  CHECK_IDS,
  type CheckContext,
  type CheckResult,
} from "../../src/cli/cmd/release/check"

// ───── helpers ─────────────────────────────────────────────────────

async function run(cmd: string, args: string[], cwd: string): Promise<number> {
  const res = await Process.run([cmd, ...args], {
    cwd,
    stdin: "ignore",
    nothrow: true,
  }).catch(() => ({ code: 1 }))
  return res.code
}

async function makeRepo(version: string, initialTag?: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ax-code-release-check-"))
  // Emulate the repo layout runChecks expects: packages/ax-code/package.json
  // and packages/ax-code/src/ with at least one file.
  const axPath = path.join(dir, "packages", "ax-code")
  const srcPath = path.join(axPath, "src")
  await mkdir(srcPath, { recursive: true })
  await writeFile(path.join(axPath, "package.json"), JSON.stringify({ name: "ax-code", version }))
  await writeFile(path.join(srcPath, "entry.ts"), "export const x = 1\n")

  await run("git", ["init", "-q", "-b", "main"], dir)
  await run("git", ["config", "user.email", "t@t.t"], dir)
  await run("git", ["config", "user.name", "t"], dir)
  await run("git", ["add", "."], dir)
  await run("git", ["commit", "-qm", "init"], dir)
  if (initialTag) {
    await run("git", ["tag", initialTag], dir)
  }
  return dir
}

function mkCtx(repoRoot: string, version: string, overrides: Partial<CheckContext> = {}): CheckContext {
  return {
    repoRoot,
    version,
    withTests: false,
    fetch: false,
    // Skip the slow/network-heavy checks by default in unit tests.
    skip: new Set(["typecheck", "tests", "remote-tag", "branch-sync", "workflow-changes"]),
    ...overrides,
  }
}

function find(results: CheckResult[], id: string): CheckResult {
  const r = results.find((x) => x.id === id)
  if (!r) throw new Error(`Missing result for ${id}: ${JSON.stringify(results.map((r) => r.id))}`)
  return r
}

// ───── legacy surface (back-compat) ───────────────────────────────

describe("release check command (legacy surface)", () => {
  test("decodes only release package name and version strings", () => {
    expect(decodeReleasePackageJsonValue({ name: "ax-code", version: "2.21.5", private: true })).toEqual({
      name: "ax-code",
      version: "2.21.5",
    })
    expect(decodeReleasePackageJsonValue({ name: 123, version: 456 })).toEqual({})
  })

  test("parses release package JSON before value decoding", () => {
    expect(parseReleasePackageJsonText(JSON.stringify({ name: "ax-code", version: "2.21.5" }))).toEqual({
      name: "ax-code",
      version: "2.21.5",
    })
    expect(() => parseReleasePackageJsonText("{not json")).toThrow(SyntaxError)
  })

  test("passes for the ax-code package", async () => {
    const checks = await releaseReadinessChecks(path.resolve(import.meta.dirname, "../.."))

    expect(checks).toContainEqual({ name: "package name", status: "pass", details: "ax-code" })
    expect(checks.find((check) => check.name === "package version")?.status).toBe("pass")
  })

  test("fails invalid semantic package versions", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "ax-code-release-check-"))
    await writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "ax-code", version: "next" }))

    const checks = await releaseReadinessChecks(dir)

    expect(checks).toContainEqual({ name: "package version", status: "fail", details: "next" })
  })
})

// ───── full check runner ──────────────────────────────────────────

describe("release check (full checks)", () => {
  test("clean repo with valid version and prior tag passes version check", async () => {
    const repo = await makeRepo("2.21.5", "v2.21.4")
    const results = await runChecks(mkCtx(repo, "2.21.5"))

    expect(find(results, "version").status).toBe("ok")
    expect(find(results, "working-tree").status).toBe("ok")
    expect(find(results, "phantom-imports").status).toBe("ok")
  })

  test("version less than or equal to latest tag fails", async () => {
    const repo = await makeRepo("2.21.3", "v2.21.4")
    const results = await runChecks(mkCtx(repo, "2.21.3"))

    expect(find(results, "version").status).toBe("fail")
    expect(find(results, "version").detail).toContain("not greater than")
  })

  test("withdrawn prerelease GitHub releases are ignored when selecting prior tag", async () => {
    const repo = await makeRepo("6.0.0", "v5.13.0")
    await run("git", ["tag", "v6.3.1"], repo)

    const binDir = path.join(repo, "bin")
    await mkdir(binDir)
    const gh = path.join(binDir, "gh")
    await writeFile(
      gh,
      [
        "#!/bin/sh",
        'if [ "$3" = "v6.3.1" ]; then',
        '  printf \'[true,"Withdrawn: v6.3.1","This release is withdrawn"]\\n\'',
        "else",
        '  printf \'[false,"",""]\\n\'',
        "fi",
        "",
      ].join("\n"),
    )
    await chmod(gh, 0o755)

    const originalPath = process.env.PATH
    process.env.PATH = `${binDir}${path.delimiter}${originalPath ?? ""}`
    try {
      const results = await runChecks(mkCtx(repo, "6.0.0", { fetch: true }))

      expect(find(results, "version").status).toBe("ok")
      expect(find(results, "version").detail).toContain("greater than v5.13.0")
    } finally {
      process.env.PATH = originalPath
    }
  })

  test("malformed version fails", async () => {
    const repo = await makeRepo("2.21.4")
    const results = await runChecks(mkCtx(repo, "not-a-version"))

    expect(find(results, "version").status).toBe("fail")
    expect(find(results, "version").detail).toContain("not valid semver")
  })

  test("no prior tag is ok", async () => {
    const repo = await makeRepo("2.21.5")
    const results = await runChecks(mkCtx(repo, "2.21.5"))

    expect(find(results, "version").status).toBe("ok")
    expect(find(results, "commits").status).toBe("ok")
  })

  test("phantom import is detected", async () => {
    const repo = await makeRepo("2.21.5", "v2.21.4")
    // Create an untracked file and have a tracked file reference it.
    const srcPath = path.join(repo, "packages", "ax-code", "src")
    await writeFile(path.join(srcPath, "untracked.ts"), "export const phantom = 1\n")
    // Modify tracked file to import the untracked one, then commit only the import.
    await writeFile(path.join(srcPath, "entry.ts"), 'import { phantom } from "./untracked"\nexport const x = phantom\n')
    await run("git", ["add", "packages/ax-code/src/entry.ts"], repo)
    await run("git", ["commit", "-qm", "phantom import"], repo)

    const results = await runChecks(mkCtx(repo, "2.21.5"))

    expect(find(results, "phantom-imports").status).toBe("fail")
    expect(find(results, "phantom-imports").detail).toContain("untracked")
  })

  test("import of a tracked file OUTSIDE src/ does not false-positive", async () => {
    // Regression for a bug where the tracked-file set was scoped to src/,
    // so any legitimate import from src/ into a sibling directory at the
    // package root (parsers-config.ts, migration/, assets/, etc.) was
    // reported as a phantom import.
    const repo = await makeRepo("2.21.5", "v2.21.4")
    const axPath = path.join(repo, "packages", "ax-code")
    const srcPath = path.join(axPath, "src")

    // Tracked config file at package root.
    await writeFile(path.join(axPath, "parsers-config.ts"), "export default { foo: 1 }\n")
    // Tracked source file that imports it.
    await writeFile(path.join(srcPath, "entry.ts"), 'import config from "../parsers-config"\nexport const c = config\n')

    await run("git", ["add", "."], repo)
    await run("git", ["commit", "-qm", "cross-dir import"], repo)

    const results = await runChecks(mkCtx(repo, "2.21.5"))

    expect(find(results, "phantom-imports").status).toBe("ok")
  })

  test("import of tracked root package metadata from script does not false-positive", async () => {
    const repo = await makeRepo("2.21.5", "v2.21.4")
    const scriptPath = path.join(repo, "packages", "ax-code", "script")
    await mkdir(scriptPath, { recursive: true })
    await writeFile(path.join(repo, "package.json"), JSON.stringify({ engines: { bun: "^1.3.14" } }) + "\n")
    await writeFile(
      path.join(scriptPath, "build.ts"),
      'import rootPkg from "../../../package.json"\nexport const bun = rootPkg.engines.bun\n',
    )

    await run("git", ["add", "."], repo)
    await run("git", ["commit", "-qm", "root metadata import"], repo)

    const results = await runChecks(mkCtx(repo, "2.21.5"))

    expect(find(results, "phantom-imports").status).toBe("ok")
  })

  test("dirty working tree in packages/ax-code fails", async () => {
    const repo = await makeRepo("2.21.5", "v2.21.4")
    const srcPath = path.join(repo, "packages", "ax-code", "src")
    // Leave an uncommitted change.
    await writeFile(path.join(srcPath, "entry.ts"), "export const x = 2\n")

    const results = await runChecks(mkCtx(repo, "2.21.5"))

    expect(find(results, "working-tree").status).toBe("fail")
    expect(find(results, "working-tree").detail).toContain("uncommitted")
  })

  test("skip option omits a check", async () => {
    const repo = await makeRepo("2.21.5", "v2.21.4")
    const ctx = mkCtx(repo, "2.21.5", {
      skip: new Set(["typecheck", "tests", "remote-tag", "branch-sync", "workflow-changes", "phantom-imports"]),
    })
    const results = await runChecks(ctx)

    expect(find(results, "phantom-imports").status).toBe("skip")
  })

  test("tests check respects withTests=false", async () => {
    const repo = await makeRepo("2.21.5", "v2.21.4")
    const ctx = mkCtx(repo, "2.21.5", { withTests: false, skip: new Set(["typecheck"]) })
    const results = await runChecks(ctx)

    // `tests` is not in the skip set, but withTests=false should still skip it
    // without spawning bun. Depending on where in the skip Set it lives, the
    // runner returns either "skip" (from skip set) or the check returns "skip"
    // itself (from withTests gate). Accept either: the key property is it did
    // NOT actually run the deterministic suite.
    const tests = results.find((r) => r.id === "tests")
    expect(tests?.status).toBe("skip")
  })

  test("commented-out import to untracked file does NOT trigger phantom report", async () => {
    // Regression for a latent bug in the first phantom-imports regex that
    // matched import statements inside line and block comments. A file with
    // `// import { X } from "./deleted"` where "./deleted" is untracked
    // (or even absent) would false-positive as a phantom.
    const repo = await makeRepo("2.21.5", "v2.21.4")
    const srcPath = path.join(repo, "packages", "ax-code", "src")

    // Untracked file that a comment references.
    await writeFile(path.join(srcPath, "deleted.ts"), "// leftover\n")
    // Tracked source file with only COMMENTED imports of the untracked one.
    await writeFile(
      path.join(srcPath, "entry.ts"),
      ['// import { a } from "./deleted"', '/* import { b } from "./deleted" */', "export const x = 1"].join("\n") +
        "\n",
    )
    // Only commit entry.ts; deleted.ts stays untracked.
    await run("git", ["add", "packages/ax-code/src/entry.ts"], repo)
    await run("git", ["commit", "-qm", "comments only"], repo)

    const results = await runChecks(mkCtx(repo, "2.21.5"))

    expect(find(results, "phantom-imports").status).toBe("ok")
  })

  test("phantom import in script/ is detected (v2.21.2 regression)", async () => {
    // v2.21.2 failed because packages/ax-code/script/build.ts imported
    // ./models-snapshot (untracked). The first Phase 1 implementation
    // only scanned src/, missing this exact case. Now we scan script/
    // too — verify.
    const repo = await makeRepo("2.21.5", "v2.21.4")
    const scriptPath = path.join(repo, "packages", "ax-code", "script")
    await mkdir(scriptPath, { recursive: true })
    await writeFile(path.join(scriptPath, "helper.ts"), "export const h = 1\n") // untracked
    await writeFile(path.join(scriptPath, "build.ts"), 'import { h } from "./helper"\nexport const build = h\n')
    await run("git", ["add", "packages/ax-code/script/build.ts"], repo)
    await run("git", ["commit", "-qm", "phantom in script"], repo)

    const results = await runChecks(mkCtx(repo, "2.21.5"))

    expect(find(results, "phantom-imports").status).toBe("fail")
    expect(find(results, "phantom-imports").detail).toContain("helper")
  })

  test("CHECK_IDS includes expected ids", () => {
    // Guard: if a new check is added without exporting its id, --skip
    // validation would reject legitimate uses. This test ensures the
    // public id list stays in sync with the runner's internal list.
    expect(CHECK_IDS).toContain("phantom-imports")
    expect(CHECK_IDS).toContain("typecheck")
    expect(CHECK_IDS).toContain("tests")
    expect(CHECK_IDS.length).toBeGreaterThanOrEqual(9)
  })

  // ── coverage for previously-untested checks ────────────────────

  test("remote-tag warns when origin is unreachable (no origin configured)", async () => {
    // tmp repo has no `origin` remote — git ls-remote must fail gracefully.
    const repo = await makeRepo("2.21.5", "v2.21.4")
    const ctx = mkCtx(repo, "2.21.5", {
      skip: new Set(["typecheck", "tests", "branch-sync", "workflow-changes"]),
    })
    const results = await runChecks(ctx)
    expect(find(results, "remote-tag").status).toBe("warn")
  })

  test("branch-sync warns when origin/main ref is absent (no origin)", async () => {
    // Same reasoning — rev-list origin/main fails without origin.
    const repo = await makeRepo("2.21.5", "v2.21.4")
    const ctx = mkCtx(repo, "2.21.5", {
      skip: new Set(["typecheck", "tests", "remote-tag", "workflow-changes"]),
    })
    const results = await runChecks(ctx)
    expect(find(results, "branch-sync").status).toBe("warn")
  })

  test("typecheck is skipped by id from the runner", async () => {
    // Full typecheck requires a real ax-code tree; exercise the skip path so
    // the runner wiring is covered without spawning bun.
    const repo = await makeRepo("2.21.5", "v2.21.4")
    const ctx = mkCtx(repo, "2.21.5")
    const results = await runChecks(ctx)
    expect(find(results, "typecheck").status).toBe("skip")
  })

  test("tests check defaults to skip without --with-tests", async () => {
    // Remove `tests` from the default skip set so the skip status comes
    // from the `withTests: false` gate inside checkTests, not from the
    // runner's skip-set branch. Otherwise this test would pass trivially
    // even if the withTests flag were ignored.
    const repo = await makeRepo("2.21.5", "v2.21.4")
    const ctx = mkCtx(repo, "2.21.5", {
      withTests: false,
      skip: new Set(["typecheck", "remote-tag", "branch-sync", "workflow-changes"]),
    })
    const results = await runChecks(ctx)
    const tests = find(results, "tests")
    expect(tests.status).toBe("skip")
    expect(tests.detail).toContain("pass --with-tests to run")
  })

  test("workflow-changes reports changes in .github/workflows/", async () => {
    const repo = await makeRepo("2.21.5", "v2.21.4")
    // After the v2.21.4 tag was created by makeRepo, add a workflow file
    // so git diff v2.21.4..HEAD shows it.
    const wfPath = path.join(repo, ".github", "workflows")
    await mkdir(wfPath, { recursive: true })
    await writeFile(path.join(wfPath, "ci.yml"), "name: ci\n")
    await run("git", ["add", "."], repo)
    await run("git", ["commit", "-qm", "add workflow"], repo)

    const ctx = mkCtx(repo, "2.21.5", {
      skip: new Set(["typecheck", "tests", "remote-tag", "branch-sync"]),
    })
    const results = await runChecks(ctx)
    expect(find(results, "workflow-changes").status).toBe("warn")
    expect(find(results, "workflow-changes").detail).toContain(".github/workflows/ci.yml")
  })
})
