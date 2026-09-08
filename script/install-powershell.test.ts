import { spawnSync } from "node:child_process"
import { chmod, copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, test } from "vitest"
import { windowsNodeLauncherScript } from "../packages/ax-code/script/node-launcher"

const installer = path.resolve(import.meta.dirname, "../install.ps1")
const powershell = process.env.AX_TEST_POWERSHELL ?? (process.platform === "win32" ? "powershell.exe" : "pwsh")
const available =
  spawnSync(powershell, ["-NoProfile", "-NonInteractive", "-Command", "exit 0"], {
    // Windows on Arm may cold-start the emulated Windows PowerShell host
    // slowly enough to exceed the default command-probe budget.
    timeout: 30_000,
  }).status === 0

if (process.platform === "win32" && !available) {
  throw new Error(`Windows installer tests require a working PowerShell executable: ${powershell}`)
}

async function runInstaller(body: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ax-code-installer-test-"))
  try {
    const source = path.join(root, "source bundle")
    const files = {
      "bin/ax-code.cmd":
        process.platform === "win32"
          ? windowsNodeLauncherScript()
          : '#!/bin/sh\nexec "$AX_TEST_NODE" "$(dirname "$0")/../lib/index-node-tui.js" "$@"\n',
      "lib/index-node-tui.js": 'import { version } from "solid-js"; console.log(version)\n',
      "node_modules/solid-js/package.json": JSON.stringify({ type: "module", exports: "./index.js" }),
      "node_modules/solid-js/index.js": 'export const version = "9.9.9"\n',
      "package.json": JSON.stringify({ type: "module" }),
    }
    for (const [relative, content] of Object.entries(files)) {
      const target = path.join(source, relative)
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, content)
      if (relative === "bin/ax-code.cmd") await chmod(target, 0o755)
    }
    const node = path.join(source, "node/bin/node.exe")
    await mkdir(path.dirname(node), { recursive: true })
    if (process.platform === "win32") {
      await copyFile(process.execPath, node)
    } else {
      // The fixture checks module resolution even when CI itself uses Node 24.
      // Production archives carry their own Node 26 runtime.
      await writeFile(
        node,
        '#!/bin/sh\nif [ "$1" = "--experimental-ffi" ]; then shift; fi\nexec "$AX_TEST_NODE" "$@"\n',
      )
      await chmod(node, 0o755)
    }
    const script = path.join(root, "test.ps1")
    await writeFile(
      script,
      `
$ErrorActionPreference = "Stop"
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($env:AX_TEST_INSTALLER, [ref]$null, [ref]$parseErrors)
if ($parseErrors) { throw ($parseErrors | Out-String) }
foreach ($statement in $ast.EndBlock.Statements) {
  if ($statement -is [System.Management.Automation.Language.FunctionDefinitionAst]) {
    . ([scriptblock]::Create($statement.Extent.Text))
  }
}
$Source = Join-Path $env:AX_TEST_ROOT "source bundle"
$InstallRoot = Join-Path $env:AX_TEST_ROOT "installed bundle"
$InstallDir = Join-Path $InstallRoot "bin"
$InstallPath = Join-Path $InstallDir "ax-code.exe"
$InstallCmdPath = Join-Path $InstallDir "ax-code.cmd"
$InstallLibDir = Join-Path $InstallRoot "lib"
$InstallNodeDir = Join-Path $InstallRoot "node"
$InstallNodeModulesDir = Join-Path $InstallRoot "node_modules"
$InstallPackageJson = Join-Path $InstallRoot "package.json"

function Assert-Equal($Actual, $Expected) {
  if ($Actual -ne $Expected) { throw "Expected '$Expected', got '$Actual'" }
}
function Assert-InstalledBundle {
  $output = & (Join-Path $InstallNodeDir "bin/node.exe") (Join-Path $InstallLibDir "index-node-tui.js")
  Assert-Equal $LASTEXITCODE 0
  Assert-Equal $output "9.9.9"
  Assert-Equal (Test-Path (Join-Path $InstallNodeModulesDir "node_modules")) $false
}
function New-PreviousInstall {
  foreach ($relative in @("bin/ax-code.cmd", "lib/old.js", "node/bin/node.exe", "node_modules/locked-native/addon.node", "package.json", "config.json")) {
    $target = Join-Path $InstallRoot $relative
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
    Set-Content -LiteralPath $target -Value "previous" -NoNewline
  }
}
function Assert-PreviousInstall {
  foreach ($relative in @("bin/ax-code.cmd", "lib/old.js", "node/bin/node.exe", "node_modules/locked-native/addon.node", "package.json", "config.json")) {
    Assert-Equal (Get-Content -LiteralPath (Join-Path $InstallRoot $relative) -Raw) "previous"
  }
  Assert-Equal (Test-Path (Join-Path $InstallLibDir "index-node-tui.js")) $false
}
${body}
`,
    )
    const result = spawnSync(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", script], {
      encoding: "utf8",
      timeout: 20_000,
      env: { ...process.env, AX_TEST_INSTALLER: installer, AX_TEST_ROOT: root, AX_TEST_NODE: process.execPath },
    })
    expect(result.error).toBeUndefined()
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
  } finally {
    // Windows can retain a short-lived execution or antivirus lock on the
    // fixture's copied node.exe after PowerShell has observed its exit.
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
}

describe.skipIf(!available)("PowerShell runtime installation", () => {
  test("accepts a version on stdout with a native warning on stderr", async () => {
    await runInstaller(`
Install-NodeBundleTree $Source
Set-Content -LiteralPath (Join-Path $InstallLibDir "index-node-tui.js") -Value 'console.error("AX Code warning: switched terminal code page to UTF-8"); console.log("9.9.9")'
Verify-InstalledRuntime "9.9.9"
Assert-Equal $ErrorActionPreference "Stop"
`)
  })

  test("reports the native exit code and stderr when a launcher fails", async () => {
    await runInstaller(`
Install-NodeBundleTree $Source
Set-Content -LiteralPath (Join-Path $InstallLibDir "index-node-tui.js") -Value 'console.error("Simulated launcher failure"); console.log("9.9.9"); process.exit(23)'
$failure = $null
try { Verify-InstalledRuntime "9.9.9" } catch { $failure = $_ }
if ($failure -notmatch "Simulated launcher failure" -or $failure -notmatch "23") { throw "Missing launcher diagnostics: $failure" }
Assert-Equal $ErrorActionPreference "Stop"
`)
  })

  test.each(["launcher", "version", "environment"])(
    "restores the previous runtime when the final %s check fails",
    async (kind) => {
      await runInstaller(`
New-PreviousInstall
if ("${kind}" -eq "launcher") {
  Set-Content -LiteralPath (Join-Path $Source "bin/ax-code.cmd") -Value '${process.platform === "win32" ? "@echo off\r\necho Simulated launcher failure 1>&2\r\nexit /b 23" : '#!/bin/sh\nprintf "Simulated launcher failure\\n" >&2\nexit 23'}'
}
if ("${kind}" -eq "environment") { $env:NODE_OPTIONS = "--ax-test-invalid-option" }
$expected = if ("${kind}" -eq "version") { "8.8.8" } else { "9.9.9" }
$failure = $null
try { Install-NodeBundleTree $Source $expected } catch { $failure = $_ }
if ($failure -notmatch "previous runtime restored") { throw "Expected restoration: $failure" }
Assert-PreviousInstall
Assert-Equal $ErrorActionPreference "Stop"
`)
    },
  )

  test("installs a complete bundle with resolvable runtime dependencies", async () => {
    await runInstaller(`
Install-NodeBundleTree $Source
Assert-InstalledBundle
`)
  })

  test("does not nest dependencies when an old native file cannot be deleted", async () => {
    await runInstaller(`
New-PreviousInstall
function Remove-Item {
  [CmdletBinding()]
  param([string]$LiteralPath, [switch]$Recurse, [switch]$Force)
  if ($LiteralPath -eq $InstallNodeModulesDir) {
    Write-Error "The native addon is in use."
    return
  }
  Microsoft.PowerShell.Management\\Remove-Item @PSBoundParameters
}
Install-NodeBundleTree $Source
Assert-InstalledBundle
Assert-Equal (Get-Content -LiteralPath (Join-Path $InstallRoot "config.json") -Raw) "previous"
`)
  })

  test("rejects missing runtime dependencies without resolving them from the previous install", async () => {
    await runInstaller(`
New-PreviousInstall
Copy-Item -LiteralPath (Join-Path $Source "node_modules/solid-js") -Destination $InstallNodeModulesDir -Recurse
Remove-Item -LiteralPath (Join-Path $Source "node_modules/solid-js") -Recurse -Force
$failure = $null
try { Install-NodeBundleTree $Source } catch { $failure = $_ }
if (-not $failure) { throw "Incomplete runtime was accepted" }
if ($failure -notmatch "solid-js") { throw "Missing dependency was not reported: $failure" }
Assert-PreviousInstall
`)
  })

  test.each(["backup", "activation"])("restores the previous runtime when %s fails", async (phase) => {
    await runInstaller(`
New-PreviousInstall
function Move-Item {
  [CmdletBinding()]
  param([string]$LiteralPath, [string]$Destination)
  if ("${phase}" -eq "backup" -and $LiteralPath -eq $InstallNodeModulesDir) {
    throw "The native addon directory is locked."
  }
  if ("${phase}" -eq "activation" -and $Destination -eq $InstallNodeModulesDir -and $LiteralPath -notmatch "previous") {
    throw "The destination cannot be written."
  }
  Microsoft.PowerShell.Management\\Move-Item @PSBoundParameters
}
$failure = $null
try { Install-NodeBundleTree $Source } catch { $failure = $_ }
if ($failure -notmatch "previous runtime restored") { throw "Expected restoration: $failure" }
Assert-PreviousInstall
`)
  })

  test("leaves the previous runtime intact when staging a file fails", async () => {
    await runInstaller(`
New-PreviousInstall
function Copy-Item {
  [CmdletBinding()]
  param([string]$LiteralPath, [string]$Destination, [switch]$Recurse, [switch]$Force)
  if ($LiteralPath -eq (Join-Path $Source "node_modules")) { throw "Simulated copy failure" }
  Microsoft.PowerShell.Management\\Copy-Item @PSBoundParameters
}
$failure = $null
try { Install-NodeBundleTree $Source } catch { $failure = $_ }
if ($failure -notmatch "Simulated copy failure") { throw "Expected staging failure: $failure" }
Assert-PreviousInstall
`)
  })

  test("retains recovery files if the previous runtime cannot be fully restored", async () => {
    await runInstaller(`
New-PreviousInstall
function Move-Item {
  [CmdletBinding()]
  param([string]$LiteralPath, [string]$Destination)
  if ($Destination -eq $InstallNodeModulesDir) { throw "Simulated activation and rollback failure" }
  Microsoft.PowerShell.Management\\Move-Item @PSBoundParameters
}
$failure = $null
try { Install-NodeBundleTree $Source } catch { $failure = $_ }
if ($failure -notmatch "Recovery files remain at") { throw "Expected recovery path: $failure" }
$backup = Get-ChildItem -LiteralPath $env:AX_TEST_ROOT -Directory -Force | Where-Object { $_.Name -like ".ax-code-install-*" }
if (-not $backup) { throw "Recovery files were deleted" }
Assert-Equal (Get-Content -LiteralPath (Join-Path $backup.FullName "previous/node_modules/locked-native/addon.node") -Raw) "previous"
`)
  })

  test("restores the previous runtime if the installed entry fails its startup check", async () => {
    await runInstaller(`
New-PreviousInstall
function Move-Item {
  [CmdletBinding()]
  param([string]$LiteralPath, [string]$Destination)
  Microsoft.PowerShell.Management\\Move-Item @PSBoundParameters
  if ($Destination -eq $InstallLibDir -and $LiteralPath -notmatch "previous") {
    Set-Content -LiteralPath (Join-Path $InstallLibDir "index-node-tui.js") -Value 'throw new Error("Simulated installed entry failure")'
  }
}
$failure = $null
try { Install-NodeBundleTree $Source } catch { $failure = $_ }
if ($failure -notmatch "Simulated installed entry failure") { throw "Expected startup failure: $failure" }
Assert-PreviousInstall
`)
  })

  test.each(["", "8.8.8"])("rejects an installed launcher reporting version '%s'", async (version) => {
    await runInstaller(`
New-PreviousInstall
function Get-InstalledVersion { return "${version}" }
$failure = $null
try { Verify-InstalledRuntime "9.9.9" } catch { $failure = $_ }
if (-not $failure) { throw "Invalid installed version was accepted" }
`)
  })
})
