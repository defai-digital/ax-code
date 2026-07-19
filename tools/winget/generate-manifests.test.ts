import { describe, expect, test } from "vitest"
import { mkdtempSync, readdirSync, readFileSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { parseArgs, shouldWriteCli, shouldWriteDesktop } from "./generate-manifests.ts"

describe("winget manifest generator", () => {
  test("parseArgs normalizes version and defaults tags", () => {
    expect(parseArgs(["--version", "v7.1.0", "--package", "cli"]).tag).toBe("v7.1.0")
    expect(parseArgs(["--version", "1.2.3", "--package", "desktop"]).tag).toBe("desktop-v1.2.3")
    expect(parseArgs(["--version", "1.2.3", "--package", "desktop", "--tag", "desktop-v1.2.3-rc"]).tag).toBe(
      "desktop-v1.2.3-rc",
    )
    expect(shouldWriteCli("cli")).toBe(true)
    expect(shouldWriteDesktop("cli")).toBe(false)
    expect(shouldWriteCli("desktop")).toBe(false)
    expect(shouldWriteDesktop("desktop")).toBe(true)
  })

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

  test("package=cli writes only CLI manifests", () => {
    const out = mkdtempSync(path.join(tmpdir(), "ax-winget-cli-"))
    try {
      const result = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          path.resolve("tools/winget/generate-manifests.ts"),
          "--version",
          "8.0.0",
          "--package",
          "cli",
          "--out",
          out,
          "--skip-download",
        ],
        { encoding: "utf8", cwd: path.resolve(".") },
      )
      expect(result.status, result.stderr || result.stdout).toBe(0)
      expect(existsSync(path.join(out, "manifests", "d", "DEFAI", "AXCode", "8.0.0"))).toBe(true)
      expect(existsSync(path.join(out, "manifests", "d", "DEFAI", "AXCode", "Desktop", "8.0.0"))).toBe(false)
      const installer = readFileSync(
        path.join(out, "manifests", "d", "DEFAI", "AXCode", "8.0.0", "DEFAI.AXCode.installer.yaml"),
        "utf8",
      )
      expect(installer).toContain("/releases/download/v8.0.0/")
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })

  test("package=desktop uses desktop-v tag by default", () => {
    const out = mkdtempSync(path.join(tmpdir(), "ax-winget-desktop-"))
    try {
      const result = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          path.resolve("tools/winget/generate-manifests.ts"),
          "--version",
          "1.4.0",
          "--package",
          "desktop",
          "--out",
          out,
          "--skip-download",
        ],
        { encoding: "utf8", cwd: path.resolve(".") },
      )
      expect(result.status, result.stderr || result.stdout).toBe(0)
      expect(existsSync(path.join(out, "manifests", "d", "DEFAI", "AXCode", "Desktop", "1.4.0"))).toBe(true)
      expect(existsSync(path.join(out, "manifests", "d", "DEFAI", "AXCode", "1.4.0"))).toBe(false)
      const installer = readFileSync(
        path.join(
          out,
          "manifests",
          "d",
          "DEFAI",
          "AXCode",
          "Desktop",
          "1.4.0",
          "DEFAI.AXCode.Desktop.installer.yaml",
        ),
        "utf8",
      )
      expect(installer).toContain("/releases/download/desktop-v1.4.0/")
      expect(installer).toContain("AX-Code-1.4.0-win-x64.exe")
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })
})
