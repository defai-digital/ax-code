import { describe, expect, test } from "bun:test"
import path from "path"

const repoRoot = path.resolve(import.meta.dir, "../../../..")
const installScript = path.join(repoRoot, "install")
const installPowerShellScript = path.join(repoRoot, "install.ps1")

describe("install script", () => {
  test("quarantines stale source launchers that shadow the packaged binary", async () => {
    const text = await Bun.file(installScript).text()
    expect(text).toContain("cleanup_stale_source_launchers")
    expect(text).toContain("source_launcher_cwd")
    expect(text).toContain('AX_CODE_SOURCE_CWD="')
    expect(text).toContain("bun run --cwd ")
    expect(text).toContain("/packages/ax-code/src/index.ts")
    expect(text).toContain(".stale-source-")
  })

  test("quarantines stale bundled launchers whose target binary is missing", async () => {
    const text = await Bun.file(installScript).text()
    expect(text).toContain("cleanup_stale_bundled_launchers")
    expect(text).toContain("bundled_launcher_target")
    expect(text).toContain(".stale-bundled-")
    expect(text).toContain("/dist/")
  })

  test("warns when the installed binary is not first on PATH", async () => {
    const text = await Bun.file(installScript).text()
    expect(text).toContain("warn_path_precedence")
    expect(text).toContain("your current shell resolves ax-code to")
    expect(text).toContain("export PATH=${INSTALL_DIR}:\\$PATH")
  })

  test("provides a native Windows PowerShell release installer", async () => {
    const text = await Bun.file(installPowerShellScript).text()
    expect(text).toContain("param(")
    expect(text).toContain("[string]$Version")
    expect(text).toContain("[string]$Binary")
    expect(text).toContain("[switch]$NoModifyPath")
    expect(text).toContain("https://api.github.com/repos/$Repo/releases/latest")
    expect(text).toContain("https://github.com/$Repo/releases/latest/download/$filename")
    expect(text).toContain("https://github.com/$Repo/releases/download/v$specificVersion/$filename")
    expect(text).toContain('$filename = "$App-windows-$arch$variant.zip"')
    expect(text).toContain('return "x64"')
    expect(text).toContain('return "arm64"')
    expect(text).toContain("Expand-Archive")
    expect(text).toContain("ax-code.exe")
    expect(text).toContain('[Environment]::SetEnvironmentVariable("Path", $newPath, "User")')
    expect(text).toContain("Warn-PathPrecedence")
  })

  test("selects the AVX2-free baseline build for no_avx2 Windows x64 CPUs (#274)", async () => {
    const text = await Bun.file(installPowerShellScript).text()
    // Up-front detection chooses the baseline asset when AVX2 is known-absent.
    expect(text).toContain("function Get-Avx2Support")
    expect(text).toContain("System.Runtime.Intrinsics.X86.Avx2")
    expect(text).toContain('$variant = if ($Baseline -and $arch -eq "x64") { "-baseline" } else { "" }')
    expect(text).toContain("(Get-Avx2Support) -eq $false")
    // Crash-safe verification + fallback retry when AVX2 can't be detected ahead
    // of time (e.g. Windows PowerShell 5.1).
    expect(text).toContain("function Get-InstalledBinaryVersion")
    expect(text).toContain("-not (Get-InstalledBinaryVersion)")
    expect(text).toContain("Install-FromRelease $true")
  })
})
