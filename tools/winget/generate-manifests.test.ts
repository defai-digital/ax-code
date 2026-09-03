import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "vitest"
import { generateManifests, parseArgs } from "./generate-manifests"

describe("AX Code CLI winget manifest generator", () => {
  test("accepts only the CLI package", () => {
    expect(parseArgs(["--version", "v7.10.2", "--package", "cli"])).toMatchObject({
      version: "7.10.2",
      tag: "v7.10.2",
    })
    expect(() => parseArgs(["--version", "7.10.2", "--package", "desktop"])).toThrow("only the CLI winget package")
    expect(() => parseArgs(["--version", "latest"])).toThrow("semantic version")
  })

  test("writes only CLI manifests", async () => {
    const output = mkdtempSync(path.join(tmpdir(), "ax-code-winget-"))
    try {
      const result = await generateManifests([
        "--version",
        "7.10.2",
        "--package",
        "cli",
        "--out",
        output,
        "--skip-download",
      ])
      const installer = path.join(result.output, "DEFAI.AXCode.installer.yaml")
      expect(result.tag).toBe("v7.10.2")
      expect(existsSync(installer)).toBe(true)
      expect(existsSync(path.join(output, "manifests", "d", "DEFAI", "AXCode", "Desktop"))).toBe(false)
      const source = readFileSync(installer, "utf8")
      expect(source).toContain("ax-code-windows-x64.zip")
      expect(source).toContain("ax-code-windows-arm64.zip")
      expect(source).not.toContain("AX-Code-7.10.2-win-x64.exe")
    } finally {
      rmSync(output, { recursive: true, force: true })
    }
  })
})
