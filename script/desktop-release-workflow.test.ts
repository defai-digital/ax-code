import { readFileSync } from "node:fs"
import { describe, expect, test } from "vitest"

const workflow = readFileSync(".github/workflows/desktop-release.yml", "utf8")

function jobBlock(name: string) {
  const marker = `\n  ${name}:\n`
  const start = workflow.indexOf(marker)
  if (start === -1) throw new Error(`Workflow job not found: ${name}`)
  const remainderStart = start + marker.length
  const nextJob = /\n  [a-zA-Z0-9_-]+:\n/.exec(workflow.slice(remainderStart))
  const end = nextJob?.index === undefined ? workflow.length : remainderStart + nextJob.index
  return workflow.slice(start, end)
}

describe("Desktop release workflow", () => {
  test("waits for every signed CLI runtime before native packaging", () => {
    const wait = jobBlock("wait-for-cli-release")
    const expectedAssets = [
      "ax-code-darwin-arm64.zip",
      "ax-code-windows-x64.zip",
      "ax-code-windows-arm64.zip",
      "ax-code-linux-x64.tar.gz",
      "ax-code-linux-arm64.tar.gz",
    ]

    expect(wait).toContain("needs: create-release")
    expect(wait).toContain("actions: read")
    expect(wait).toContain(".draft == false")
    expect(wait).toContain("--workflow release.yml")
    for (const asset of expectedAssets) {
      expect(wait).toContain(`            ${asset}\n`)
      expect(wait).toContain(`            ${asset}.minisig\n`)
    }

    for (const job of ["build-macos", "build-windows", "build-windows-arm64", "build-linux", "build-linux-arm64"]) {
      expect(jobBlock(job)).toContain("needs: [create-release, wait-for-cli-release]")
    }
  })

  test("keeps the platform-independent web package parallel with the CLI wait", () => {
    expect(jobBlock("package-web")).toContain("needs: create-release")
    expect(jobBlock("package-web")).not.toContain("wait-for-cli-release")
  })

  test("selects the Minisign binary that matches each Windows runner", () => {
    for (const job of ["build-windows", "build-windows-arm64"]) {
      const block = jobBlock(job)
      expect(block).toContain("switch ($env:RUNNER_ARCH)")
      expect(block).toContain('"X64" { "x86_64" }')
      expect(block).toContain('"ARM64" { "aarch64" }')
      expect(block).toContain("Join-Path $exe $minisignArchitecture")
      expect(block).not.toContain("Get-ChildItem -Recurse -Filter minisign.exe")
    }
  })
})
