import { describe, expect, test } from "vitest"
import path from "path"
import { readFile } from "node:fs/promises"

const repoRoot = path.resolve(import.meta.dirname, "../../../..")

async function readRepoFile(relativePath: string) {
  return readFile(path.join(repoRoot, relativePath), "utf-8")
}

describe("public safety documentation contract", () => {
  test("front-door docs state that runtime isolation defaults to full-access", async () => {
    const readme = await readRepoFile("README.md")
    const security = await readRepoFile("SECURITY.md")
    const sandbox = await readRepoFile("docs/guides/sandbox.md")

    expect(readme).toContain("AX Code starts with autonomous mode on and the sandbox off (`full-access`) by default")
    expect(security).toContain("The runtime isolation default is `full-access` (sandbox off)")
    expect(sandbox).toContain("By default, AX Code starts in **full-access** with the sandbox off")
  })

  test("autonomous safety docs recommend sandbox-on for untrusted work", async () => {
    const autonomous = await readRepoFile("docs/guides/autonomous.md")

    expect(autonomous).toContain("Recommended for untrusted or team repositories")
    expect(autonomous).toContain("The default runtime posture is autonomous on plus sandbox off")
  })

  test("security policy supported version table tracks the current minor line", async () => {
    const security = await readRepoFile("SECURITY.md")
    const pkg = JSON.parse(await readFile(path.join(repoRoot, "packages/ax-code/package.json"), "utf-8"))
    const [major, minor] = String(pkg.version).split(".")

    expect(security).toContain(`| ${major}.${minor}.x`)
    expect(security).not.toContain("| 3.2.x")
  })
})
