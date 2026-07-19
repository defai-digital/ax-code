import { describe, expect, test } from "vitest"
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

describe("winget manifest generator", () => {
  test("writes Desktop and CLI manifest folders with --skip-download", () => {
    const out = mkdtempSync(path.join(tmpdir(), "ax-winget-"))
    try {
      const result = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          path.resolve("tools/winget/generate-manifests.ts"),
          "--version",
          "v9.9.9",
          "--out",
          out,
          "--skip-download",
        ],
        { encoding: "utf8", cwd: path.resolve(".") },
      )
      expect(result.status, result.stderr || result.stdout).toBe(0)

      const desktopDir = path.join(out, "manifests", "d", "DEFAI", "AXCode", "Desktop", "9.9.9")
      const cliDir = path.join(out, "manifests", "d", "DEFAI", "AXCode", "9.9.9")
      const desktopFiles = readdirSync(desktopDir).sort()
      const cliFiles = readdirSync(cliDir).sort()

      expect(desktopFiles).toEqual([
        "DEFAI.AXCode.Desktop.installer.yaml",
        "DEFAI.AXCode.Desktop.locale.en-US.yaml",
        "DEFAI.AXCode.Desktop.yaml",
      ])
      expect(cliFiles).toEqual([
        "DEFAI.AXCode.installer.yaml",
        "DEFAI.AXCode.locale.en-US.yaml",
        "DEFAI.AXCode.yaml",
      ])

      const installer = readFileSync(path.join(desktopDir, "DEFAI.AXCode.Desktop.installer.yaml"), "utf8")
      expect(installer).toContain("AX-Code-9.9.9-win-x64.exe")
      expect(installer).toContain("AX-Code-9.9.9-win-arm64.exe")
      expect(installer).toContain("InstallerType: nullsoft")
      expect(installer).toContain("silent")

      const cliInstaller = readFileSync(path.join(cliDir, "DEFAI.AXCode.installer.yaml"), "utf8")
      expect(cliInstaller).toContain("ax-code-windows-x64.zip")
      expect(cliInstaller).toContain("ax-code-windows-arm64.zip")
      expect(cliInstaller).toContain("PortableCommandAlias: ax-code")
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })
})
