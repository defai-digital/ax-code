import { describe, expect, test } from "vitest"
import path from "path"

const repoRoot = path.resolve(import.meta.dirname, "../../../..")
const installScript = path.join(repoRoot, "install")
const installPowerShellScript = path.join(repoRoot, "install.ps1")

describe("install script", () => {
  test("quarantines stale source launchers that shadow the packaged binary", async () => {
    const text = await Bun.file(installScript).text()
    expect(text).toContain("cleanup_stale_source_launchers")
    expect(text).toContain("source_launcher_cwd")
    expect(text).toContain('AX_CODE_SOURCE_CWD="')
    expect(text).toContain("AX_CODE_SOURCE_ENTRY=")
    expect(text).toContain("/packages/ax-code/src/index-node-tui.ts")
    expect(text).toContain("node --experimental-ffi")
    // Legacy source launcher detection is retained so the Node installer can
    // quarantine stale Bun-era checkout launchers that still shadow releases.
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

  test("installs the complete Unix node-bundled runtime tree", async () => {
    const text = await Bun.file(installScript).text()
    expect(text).toContain('INSTALL_ROOT=$(dirname "$INSTALL_DIR")')
    expect(text).toContain('INSTALL_LIB_DIR="$INSTALL_ROOT/lib"')
    expect(text).toContain('INSTALL_NODE_MODULES_DIR="$INSTALL_ROOT/node_modules"')
    expect(text).toContain("install_node_bundle_tree")
    expect(text).toContain("lib/index-node-tui.js")
    expect(text).toContain("node_modules")
    expect(text).toContain('cp -R "$lib_dir" "$INSTALL_LIB_DIR"')
    expect(text).toContain('cp -R "$node_modules_dir" "$INSTALL_NODE_MODULES_DIR"')
    expect(text).toContain('install_node_bundle_tree "$bundle_root"')
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
    expect(text).toContain('$filename = "$App-windows-$arch.zip"')
    expect(text).toContain('return "x64"')
    expect(text).toContain('return "arm64"')
    expect(text).toContain("Expand-Archive")
    expect(text).toContain("ax-code.cmd")
    expect(text).toContain("InstallLibDir")
    expect(text).toContain("$InstallRoot = Split-Path -Parent $InstallDir")
    expect(text).toContain('$InstallLibDir = Join-Path $InstallRoot "lib"')
    expect(text).toContain('$InstallNodeModulesDir = Join-Path $InstallRoot "node_modules"')
    expect(text).toContain("Install-NodeBundleTree")
    expect(text).toContain('[Environment]::SetEnvironmentVariable("Path", $newPath, "User")')
    expect(text).toContain("Warn-PathPrecedence")
  })

  test("installs the Windows Node distribution without AVX2 binary fallback", async () => {
    const text = await Bun.file(installPowerShellScript).text()
    expect(text).toContain('$filename = "$App-windows-$arch.zip"')
    expect(text).toContain("Downloaded archive did not contain ax-code.cmd")
    expect(text).toContain("Downloaded archive did not contain the Node runtime lib directory")
    expect(text).toContain("Downloaded archive did not contain the Node runtime node_modules directory")
    expect(text).toContain("Installed ax-code node-bundled distribution from")
    expect(text).not.toContain("System.Runtime.Intrinsics.X86.Avx2")
    expect(text).not.toContain("-baseline")
  })
})
