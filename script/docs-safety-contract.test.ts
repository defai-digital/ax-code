import { describe, expect, test } from "vitest"
import path from "path"
import { readFile } from "node:fs/promises"

const repoRoot = path.resolve(import.meta.dirname, "..")

async function readRepoFile(relativePath: string) {
  return readFile(path.join(repoRoot, relativePath), "utf-8")
}

describe("public safety documentation contract", () => {
  test("front-door docs state that runtime isolation defaults to full-access", async () => {
    const readme = await readRepoFile("README.md")
    const security = await readRepoFile("SECURITY.md")
    const sandbox = await readRepoFile("docs/guides/sandbox.md")

    expect(readme).toMatch(/starts with autonomous mode enabled and `full-access` isolation/)
    expect(readme).toContain("ax-code --sandbox workspace-write")
    expect(security).toContain("The runtime isolation default is `full-access` (sandbox off)")
    expect(sandbox).toContain("By default, AX Code starts in **full-access** with the sandbox off")
  })

  test("autonomous safety docs recommend sandbox-on for untrusted work", async () => {
    const autonomous = await readRepoFile("docs/guides/autonomous.md")

    expect(autonomous).toContain("Recommended for untrusted or team repositories")
    expect(autonomous).toContain("The default runtime posture is autonomous on plus sandbox off")
  })

  test("public Homebrew instructions trust the shared tap before installation", async () => {
    const [readme, installGuide, startHere] = await Promise.all([
      readRepoFile("README.md"),
      readRepoFile("docs/getting-started/install-runtime.md"),
      readRepoFile("docs/getting-started/start-here.md"),
    ])

    expect(readme).toContain("docs/getting-started/install-runtime.md#macos-apple-silicon")
    expect(startHere).toContain("](install-runtime.md")
    expect(installGuide).toMatch(
      /brew tap defai-digital\/tap\s+brew trust defai-digital\/tap\s+brew install defai-digital\/tap\/ax-code/,
    )
    for (const document of [readme, installGuide, startHere]) {
      // Check any concrete install commands even if the entry points add examples later.
      const install = document.indexOf("brew install defai-digital/tap/ax-code")
      if (install === -1) continue
      expect(document.slice(0, install)).toContain("brew tap defai-digital/tap")
      expect(document.slice(0, install)).toContain("brew trust defai-digital/tap")
    }
  })

  test("security policy supported version table tracks the current minor line", async () => {
    const security = await readRepoFile("SECURITY.md")
    const pkg = JSON.parse(await readFile(path.join(repoRoot, "packages/ax-code/package.json"), "utf-8"))
    const [major, minor] = String(pkg.version).split(".")

    expect(security).toContain(`| ${major}.${minor}.x`)
    expect(security).not.toContain("| 3.2.x")
  })
})
