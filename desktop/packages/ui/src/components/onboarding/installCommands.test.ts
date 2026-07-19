import { describe, expect, test } from "vitest"
import {
  getBinaryPathPlaceholder,
  getInstallCommand,
  getInstallCommandHighlights,
  getInstallDocsUrl,
  LINUX_INSTALL_COMMAND,
  MACOS_INSTALL_COMMAND,
  WINDOWS_INSTALL_COMMAND,
} from "./installCommands"

describe("installCommands", () => {
  test("returns platform-specific install commands", () => {
    expect(getInstallCommand("windows")).toBe(WINDOWS_INSTALL_COMMAND)
    expect(getInstallCommand("macos")).toBe(MACOS_INSTALL_COMMAND)
    expect(getInstallCommand("linux")).toBe(LINUX_INSTALL_COMMAND)
    expect(getInstallCommand("unknown")).toBe(LINUX_INSTALL_COMMAND)
  })

  test("Windows command uses native PowerShell installer, not curl|bash", () => {
    expect(getInstallCommand("windows")).toContain("install.ps1")
    expect(getInstallCommand("windows")).toContain("iex")
    expect(getInstallCommand("windows")).not.toContain("curl")
    expect(getInstallCommand("windows")).not.toMatch(/wsl/i)
  })

  test("macOS command uses Homebrew", () => {
    expect(getInstallCommand("macos")).toContain("brew")
    expect(getInstallCommand("macos")).toContain("defai-digital/ax-code")
  })

  test("highlights cover the full command text", () => {
    for (const platform of ["windows", "macos", "linux", "unknown"] as const) {
      const command = getInstallCommand(platform)
      const highlights = getInstallCommandHighlights(platform)
      expect(highlights.map((part) => part.text).join("")).toBe(command)
    }
  })

  test("binary placeholders prefer the supported install roots", () => {
    expect(getBinaryPathPlaceholder("windows")).toContain(".ax-code\\bin\\ax-code.cmd")
    expect(getBinaryPathPlaceholder("macos")).toContain("ax-code")
    expect(getBinaryPathPlaceholder("linux")).toContain(".ax-code/bin/ax-code")
  })

  test("docs URL points at install-runtime source of truth", () => {
    expect(getInstallDocsUrl("windows")).toContain("install-runtime.md")
    expect(getInstallDocsUrl("macos")).toBe(getInstallDocsUrl("linux"))
  })
})
