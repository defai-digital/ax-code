import { describe, expect, test } from "vitest"
import path from "path"
import { readFile } from "node:fs/promises"

const repoRoot = path.resolve(import.meta.dirname, "../../../..")
const installScript = path.join(repoRoot, "install")
const installPowerShellScript = path.join(repoRoot, "install.ps1")

describe("install script", () => {
  test("quarantines stale source launchers that shadow the packaged binary", async () => {
    const text = await readFile(installScript, "utf-8")
    expect(text).toContain("cleanup_stale_source_launchers")
    expect(text).toContain("source_launcher_cwd")
    expect(text).toContain('AX_CODE_SOURCE_CWD="')
    expect(text).toContain("AX_CODE_SOURCE_ENTRY=")
    expect(text).toContain("/packages/ax-code/src/index-node-tui.ts")
    expect(text).toContain("node --experimental-ffi")
    expect(text).toContain("AX_CODE_SOURCE_NODE_FFI_RUNNER=")
    expect(text).toContain("node-ffi-runner.mjs")
    // Legacy source launcher detection is retained so the Node installer can
    // quarantine stale Bun-era checkout launchers that still shadow releases.
    expect(text).toContain("bun run --cwd ")
    expect(text).toContain("/packages/ax-code/src/index.ts")
    expect(text).toContain(".stale-source-")
  })

  test("quarantines stale bundled launchers whose target binary is missing", async () => {
    const text = await readFile(installScript, "utf-8")
    expect(text).toContain("cleanup_stale_bundled_launchers")
    expect(text).toContain("bundled_launcher_target")
    expect(text).toContain(".stale-bundled-")
    expect(text).toContain("/dist/")
  })

  test("installs the complete Unix node-bundled runtime tree", async () => {
    const text = await readFile(installScript, "utf-8")
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
    const text = await readFile(installScript, "utf-8")
    expect(text).toContain("warn_path_precedence")
    expect(text).toContain("your current shell resolves ax-code to")
    expect(text).toContain("export PATH=${INSTALL_DIR}:\\$PATH")
  })

  test("links or writes PATH config for Unix installers", async () => {
    const text = await readFile(installScript, "utf-8")
    expect(text).toContain("ensure_path_config_file")
    expect(text).toContain("link_installed_binary_on_path")
    expect(text).toContain('ln -s "${INSTALL_DIR}/ax-code" "$link_path"')
    expect(text).toContain("warn_if_not_on_current_path")
    expect(text).toContain("Open a new shell, or run: export PATH=${INSTALL_DIR}:\\$PATH")
  })

  test("provides a native Windows PowerShell release installer", async () => {
    const text = await readFile(installPowerShellScript, "utf-8")
    expect(text).toContain("param(")
    expect(text).toContain("[string]$Version")
    expect(text).toContain("[string]$Binary")
    expect(text).toContain("[switch]$NoModifyPath")
    expect(text).toContain("https://api.github.com/repos/$Repo/releases?per_page=50")
    expect(text).toContain('if (-not $tag -or $tag -notmatch "^v\\d+\\.\\d+\\.\\d+$")')
    expect(text).toContain('Where-Object { [string]$_.name -eq $FileName }')
    expect(text).not.toContain("https://github.com/$Repo/releases/latest/download/$filename")
    expect(text).toContain("https://github.com/$Repo/releases/download/v$specificVersion/$filename")
    expect(text).toContain('$filename = "$App-windows-$arch.zip"')
    expect(text).toContain('return "x64"')
    expect(text).toContain('return "arm64"')
    expect(text).toContain("Expand-Archive")
    expect(text).toContain("ax-code.cmd")
    expect(text).toContain("InstallLibDir")
    expect(text).toContain("$InstallRoot = Split-Path -Parent $InstallDir")
    expect(text).toContain('$InstallLibDir = Join-Path $InstallRoot "lib"')
    expect(text).toContain('$InstallNodeDir = Join-Path $InstallRoot "node"')
    expect(text).toContain('$InstallNodeModulesDir = Join-Path $InstallRoot "node_modules"')
    expect(text).toContain("Install-NodeBundleTree")
    expect(text).toContain("Assert-NodeFfiRuntime")
    expect(text).toContain('Join-Path $InstallNodeDir "bin\\node.exe"')
    expect(text).toContain("--experimental-ffi --version")
    expect(text).toContain("Downloaded archive did not contain the bundled Node runtime")
    expect(text).toContain("Installed AX Code bundled Node runtime does not support --experimental-ffi")
    expect(text).toContain('[Environment]::SetEnvironmentVariable("Path", $newPath, "User")')
    expect(text).toContain("Assert-CurrentPathLink")
    expect(text).toContain("Get-Command ax-code")
    expect(text).toContain("ax-code is available on PATH")
    expect(text).toContain("Warn-PathPrecedence")
  })

  test("verifies Windows release archives with pinned minisign public key", async () => {
    const text = await readFile(installPowerShellScript, "utf-8")
    const bashText = await readFile(installScript, "utf-8")
    const keyMatch = bashText.match(/AX_CODE_MINISIGN_PUBLIC_KEY='([^']+)'/)
    expect(keyMatch?.[1]).toBeTruthy()
    expect(text).toContain(`$AxCodeMinisignPublicKey = "${keyMatch![1]}"`)
    expect(text).toContain("Assert-MinisignAvailable")
    expect(text).toContain("Verify-DownloadedArchive")
    expect(text).toContain("AX_CODE_SKIP_MINISIGN_VERIFY")
    expect(text).toContain('Test-SkipMinisignVerify')
    expect(text).toContain('return $env:AX_CODE_SKIP_MINISIGN_VERIFY -eq "1"')
    expect(text).toContain("skipping minisign verification because AX_CODE_SKIP_MINISIGN_VERIFY=1")
    expect(text).toContain("minisign is required to verify AX Code release artifacts")
    expect(text).toContain("scoop install minisign")
    expect(text).toContain("choco install minisign")
    expect(text).toContain("winget install jedisct1.minisign")
    expect(text).toContain('"$archive.minisig"')
    expect(text).toContain('"$($release.Url).minisig"')
    expect(text).toContain("-Vm $ArchivePath")
    expect(text).toContain("-x $SignaturePath")
    expect(text).toContain("-P $AxCodeMinisignPublicKey")
    expect(text).toContain("Verifying release signature")
    expect(text).toContain("minisign verification failed")
    // Release path must preflight minisign and verify before extract.
    const installFromRelease = text.slice(
      text.indexOf("function Install-FromRelease"),
      text.indexOf("function Get-InstalledVersion"),
    )
    expect(installFromRelease.indexOf("Assert-MinisignAvailable")).toBeLessThan(
      installFromRelease.indexOf("Resolve-ReleaseDownload"),
    )
    expect(installFromRelease.indexOf("Verify-DownloadedArchive")).toBeLessThan(
      installFromRelease.indexOf("Expand-Archive"),
    )
  })

  test("installs the Windows Node distribution without AVX2 binary fallback", async () => {
    const text = await readFile(installPowerShellScript, "utf-8")
    expect(text).toContain('$filename = "$App-windows-$arch.zip"')
    expect(text).toContain("Downloaded archive did not contain ax-code.cmd")
    expect(text).toContain("Downloaded archive did not contain the Node runtime lib directory")
    expect(text).toContain("Downloaded archive did not contain the Node runtime node_modules directory")
    expect(text).toContain("Node-bundled distribution did not contain node\\bin\\node.exe")
    expect(text).toContain("Installed ax-code node-bundled distribution from")
    expect(text).not.toContain("System.Runtime.Intrinsics.X86.Avx2")
    expect(text).not.toContain("-baseline")
  })
})
