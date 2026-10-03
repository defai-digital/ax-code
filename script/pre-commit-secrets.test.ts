import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "vitest"

const hook = path.resolve(".husky/pre-commit")
function checkStaged(value: string) {
  const dir = mkdtempSync(path.join(tmpdir(), "ax-secret-hook-"))
  try {
    expect(spawnSync("git", ["init", "--quiet"], { cwd: dir }).status).toBe(0)
    writeFileSync(path.join(dir, "fixture.txt"), value + "\n")
    expect(spawnSync("git", ["add", "fixture.txt"], { cwd: dir }).status).toBe(0)
    return spawnSync("sh", [hook], { cwd: dir, encoding: "utf8" })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe.skipIf(process.platform === "win32")("staged provider credential protection", () => {
  test.each(["sk-proj-", "sk-ant-api03-", "github_pat_"])("blocks hyphenated provider keys %s", (prefix) => {
    const result = checkStaged(prefix + "A".repeat(24) + "-" + "B".repeat(24))
    expect(result.status).toBe(1)
    expect(result.stdout).toContain("Possible secret detected")
  })
  test.each(["OPENSSH", "ENCRYPTED"])("blocks %s private-key headers", (kind) => {
    const result = checkStaged("-----" + `BEGIN ${kind} PRIVATE KEY` + "-----")
    expect(result.status).toBe(1)
  })
  test("admits ordinary source text", () => {
    expect(checkStaged("const provider = 'example';").status).toBe(0)
  })
})
