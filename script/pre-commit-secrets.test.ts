import { spawnSync } from "node:child_process"
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "vitest"

const hook = path.resolve(".husky/pre-commit")

function checkStaged(files: Record<string, string>, afterStaging: Record<string, string> = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "ax-secret-hook-"))
  try {
    const git = (...args: string[]) => spawnSync("git", args, { cwd: dir, encoding: "utf8" })
    expect(git("init", "--quiet").status).toBe(0)
    mkdirSync(path.join(dir, "script"))
    copyFileSync("script/check-tracked-local.sh", path.join(dir, "script/check-tracked-local.sh"))
    copyFileSync(".gitignore", path.join(dir, ".gitignore"))
    expect(git("add", ".gitignore").status).toBe(0)
    for (const [name, content] of Object.entries(files)) {
      const target = path.join(dir, name)
      mkdirSync(path.dirname(target), { recursive: true })
      writeFileSync(target, content + "\n")
      expect(git("add", "--force", "--", name).status).toBe(0)
    }
    for (const [name, content] of Object.entries(afterStaging)) {
      writeFileSync(path.join(dir, name), content)
    }
    return spawnSync("sh", [hook], { cwd: dir, encoding: "utf8" })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function checkStagedText(value: string) {
  return checkStaged({ "fixture.txt": value })
}

describe.skipIf(process.platform === "win32")("staged provider credential protection", () => {
  test.each(["sk-proj-", "sk-ant-api03-", "github_pat_"])("blocks hyphenated provider keys %s", (prefix) => {
    const result = checkStagedText(prefix + "A".repeat(24) + "-" + "B".repeat(24))
    expect(result.status).toBe(1)
    expect(result.stdout).toContain("Possible secret detected")
  })
  test.each(["OPENSSH", "ENCRYPTED"])("blocks %s private-key headers", (kind) => {
    const result = checkStagedText("-----" + `BEGIN ${kind} PRIVATE KEY` + "-----")
    expect(result.status).toBe(1)
  })
  test("admits ordinary source text", () => {
    expect(checkStagedText("const provider = 'example';").status).toBe(0)
  })
  test("blocks an AWS temporary access key id", () => {
    const value = "ASIA" + "A".repeat(16)
    const result = checkStagedText(value)
    expect(result.status).toBe(1)
    expect(result.stdout).toContain("Possible secret detected")
  })
})

describe.skipIf(process.platform === "win32")("staged local-only path protection", () => {
  test("rejects force-added private files even if the unstaged policy permits them", () => {
    const paths = [
      ".internal/notes.md",
      "AGENTS.md",
      "packages/ax-code/.env.local",
      "auth.json",
      "packages/ax-code/.npmrc",
      "packages/ax-tui/.vscode/settings.json",
      ".git-credentials",
      ".aws/credentials",
      ".kube/config",
      ".ssh/id_ed25519",
      ".github/TEAM_MEMBERS",
      "script/internal-context.ts",
      "script/review-adr139.ts",
      "ax-code.json",
      "packages/ax-code/ax-code.jsonc",
      "packages/ax-code/session-ses_fixture.md",
      "signing.p12",
      "debug.har",
      "session.sqlite-wal",
    ]
    const result = checkStaged(Object.fromEntries(paths.map((name) => [name, "sample"])), { ".gitignore": "" })
    expect(result.status, result.stderr).toBe(1)
    for (const name of paths) expect(result.stdout).toContain(name)
  })

  test("uses staged package rules and preserves their directory scope", () => {
    const result = checkStaged(
      {
        "packages/sample/.gitignore": "/last-report.json",
        "packages/sample/last-report.json": "{}",
        "packages/other/last-report.json": "{}",
      },
      { "packages/sample/.gitignore": "" },
    )
    expect(result.status, result.stderr).toBe(1)
    expect(result.stdout).toContain("packages/sample/last-report.json")
    expect(result.stdout).not.toContain("packages/other/last-report.json")
  })

  test("honors versioned exceptions and ignores local exclude overrides", () => {
    const result = checkStaged(
      {
        "packages/sample/.gitignore": "!/example.log",
        "packages/sample/example.log": "fixture",
      },
      { ".git/info/exclude": "example.log" },
    )
    expect(result.status, result.stdout + result.stderr).toBe(0)
  })

  test("admits public templates, shared tooling, and the tracked fixture", () => {
    const result = checkStaged({
      ".env.example": "EXAMPLE=value",
      ".npmrc": "access=public",
      ".vscode/settings.json": "{}",
      "ax-code.json.example": "{}",
      "docs/release/ax-minisign.pub": "sample",
      "packages/ax-code/test/AGENTS.md": "fixture",
    })
    expect(result.status, result.stdout + result.stderr).toBe(0)
  })
})
