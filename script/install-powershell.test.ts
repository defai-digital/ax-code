import { spawnSync } from "node:child_process"
import { chmod, copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, test } from "vitest"
import { windowsNodeLauncherScript } from "../packages/ax-code/script/node-launcher"
import { powershellEnvironment } from "../packages/ax-code/src/util/powershell-env"

const installer = path.resolve(import.meta.dirname, "../install.ps1")
const powershell = process.env.AX_TEST_POWERSHELL ?? (process.platform === "win32" ? "powershell.exe" : "pwsh")
const available =
  spawnSync(powershell, ["-NoProfile", "-NonInteractive", "-Command", "exit 0"], {
    env: powershellEnvironment(powershell),
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
$script:OriginalRuntimeMove = (Get-Command Move-RuntimeItem).ScriptBlock
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
      // Windows on Arm GitHub runners can take longer than 20s to cold-start
      // powershell.exe, which previously surfaced as spawnSync ETIMEDOUT.
      timeout: 60_000,
      env: powershellEnvironment(powershell, {
        ...process.env,
        AX_TEST_INSTALLER: installer,
        AX_TEST_ROOT: root,
        AX_TEST_NODE: process.execPath,
        AX_TEST_RUNTIME_PROBE: path.resolve(import.meta.dirname, "../.github/scripts/assert-windows-runtime.ps1"),
      }),
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
  test.skipIf(process.platform !== "win32").each([0, 23])(
    "keeps a running launcher session alive with exit code %s",
    async (exitCode) => {
      await runInstaller(`
$entry = Join-Path $Source "lib/index-node-tui.js"
Set-Content -LiteralPath $entry -Value 'import fs from "node:fs"; if (process.argv.includes("--version")) { console.log("9.9.9") } else { fs.writeFileSync(process.env.AX_READY, "ready"); const timer = setInterval(async () => { if (!fs.existsSync(process.env.AX_GO)) return; clearInterval(timer); const { version } = await import("solid-js"); fs.writeFileSync(process.env.AX_DONE, version); process.exitCode = ${exitCode}; }, 50) }'
Install-NodeBundleTree $Source "9.9.9"
if (${exitCode} -ne 0) { Install-NodeBundleTree $Source "9.9.9" }
$env:AX_READY = Join-Path $env:AX_TEST_ROOT "ready"
$env:AX_GO = Join-Path $env:AX_TEST_ROOT "go"
$env:AX_DONE = Join-Path $env:AX_TEST_ROOT "done"
$session = Start-Process -FilePath $env:ComSpec -ArgumentList ('/d /s /c ""' + $InstallCmdPath + '""') -WindowStyle Hidden -PassThru
try {
  $deadline = [DateTime]::UtcNow.AddSeconds(5)
  while (-not (Test-Path $env:AX_READY)) {
    if ([DateTime]::UtcNow -gt $deadline) { throw "Session did not start" }
    Start-Sleep -Milliseconds 50
  }
  Set-Content -LiteralPath $entry -Value 'import { version } from "solid-js"; console.log(version)'
  Set-Content -LiteralPath (Join-Path $Source "node_modules/solid-js/index.js") -Value 'export const version = "9.9.10"'
  Install-NodeBundleTree $Source "9.9.10"
  Assert-Equal (Get-InstalledVersion) "9.9.10"
  Assert-Equal $session.HasExited $false
  Set-Content -LiteralPath $env:AX_GO -Value "go"
  if (-not $session.WaitForExit(5000)) { throw "Previous session did not finish" }
  Assert-Equal (Get-Content -LiteralPath $env:AX_DONE -Raw) "9.9.9"
  Assert-Equal $session.ExitCode ${exitCode}
} finally {
  Set-Content -LiteralPath $env:AX_GO -Value "go"
  if (-not $session.WaitForExit(5000)) { Stop-Process -Id $session.Id -Force }
  $session.Dispose()
}
`)
    },
  )

  test.skipIf(process.platform !== "win32")(
    "preserves arguments and nonzero exit codes through the dispatcher",
    async () => {
      await runInstaller(`
Install-NodeBundleTree $Source "9.9.9"
Set-Content -LiteralPath (Join-Path $Source "lib/index-node-tui.js") -Value 'if (process.argv.includes("--version")) { console.log("9.9.10") } else { console.log(JSON.stringify(process.argv.slice(2))); process.exitCode = 17 }'
Install-NodeBundleTree $Source "9.9.10"
$info = [System.Diagnostics.ProcessStartInfo]::new()
$info.FileName = $env:ComSpec
$info.Arguments = '/d /s /c ""' + $InstallCmdPath + '" "hello world" "amp&ersand" "wow!" "100%""'
$info.UseShellExecute = $false
$info.CreateNoWindow = $true
$info.RedirectStandardOutput = $true
$probe = [System.Diagnostics.Process]::Start($info)
try {
  $actual = $probe.StandardOutput.ReadToEnd().Trim()
  $probe.WaitForExit()
  Assert-Equal $probe.ExitCode 17
  Assert-Equal $actual '["hello world","amp&ersand","wow!","100%"]'
} finally { $probe.Dispose() }
`)
    },
  )

  test.skipIf(process.platform !== "win32")("upgrades twice while previous runtime files remain locked", async () => {
    await runInstaller(`
Install-NodeBundleTree $Source "9.9.9"
$oldModule = Join-Path $InstallNodeModulesDir "solid-js/index.js"
$lock = [System.IO.File]::Open($oldModule, 'Open', 'Read', 'Read')
try {
  $blocked = $false
  try { [System.IO.Directory]::Move($InstallNodeModulesDir, "$InstallNodeModulesDir-moved") } catch { $blocked = $true }
  Assert-Equal $blocked $true
  Set-Content -LiteralPath (Join-Path $Source "node_modules/solid-js/index.js") -Value 'export const version = "9.9.10"'
  Install-NodeBundleTree $Source "9.9.10"
  Assert-Equal (Get-InstalledVersion) "9.9.10"
  Assert-InstalledBundle
  $generation = @(Get-ChildItem -LiteralPath (Join-Path $InstallRoot "versions") -Directory)[0]
  $generationLock = [System.IO.File]::Open((Join-Path $generation.FullName "runtime/node_modules/solid-js/index.js"), 'Open', 'Read', 'Read')
  try {
    Set-Content -LiteralPath (Join-Path $Source "node_modules/solid-js/index.js") -Value 'export const version = "9.9.11"'
    Install-NodeBundleTree $Source "9.9.11"
    Assert-Equal (Get-InstalledVersion) "9.9.11"
    Assert-Equal (& (Join-Path $generation.FullName "runtime/bin/ax-code.cmd") --version) "9.9.10"
    Assert-InstalledBundle
  } finally { $generationLock.Dispose() }
} finally { $lock.Dispose() }
`)
  })

  test.skipIf(process.platform !== "win32").each(["candidate", "replace", "pointer", "published"])(
    "preserves the previous runtime after a %s failure",
    async (phase) => {
      await runInstaller(`
Install-NodeBundleTree $Source "9.9.9"
$previous = [System.IO.File]::ReadAllText($InstallCmdPath)
Set-Content -LiteralPath (Join-Path $Source "node_modules/solid-js/index.js") -Value 'export const version = "9.9.10"'
$script:originalVerify = (Get-Command Verify-InstalledRuntime).ScriptBlock
function Verify-InstalledRuntime([string]$ExpectedVersion) {
  if ("${phase}" -eq "candidate" -and $InstallCmdPath -match '\\.ax-code-') { throw "Injected candidate failure" }
  if ("${phase}" -eq "published" -and $InstallCmdPath -eq (Join-Path $InstallDir "ax-code.cmd")) { throw "Injected published failure" }
  & $script:originalVerify $ExpectedVersion
}
if ("${phase}" -eq "replace") {
  function Replace-RuntimeFile { throw "Injected replace failure" }
}
if ("${phase}" -eq "pointer") {
  $script:originalReplace = (Get-Command Replace-RuntimeFile).ScriptBlock
  function Replace-RuntimeFile($Source, $Destination, $Backup) {
    if ($Destination -eq (Join-Path $InstallRoot ".active-runtime")) { throw "Injected pointer failure" }
    & $script:originalReplace $Source $Destination $Backup
  }
}
$failure = $null
try { Install-NodeBundleTree $Source "9.9.10" } catch { $failure = $_ }
if ($failure -notmatch "Injected ${phase} failure") { throw "Expected injected failure: $failure" }
if ("${phase}" -in @("candidate", "replace")) { Assert-Equal ([System.IO.File]::ReadAllText($InstallCmdPath)) $previous }
Assert-Equal (Get-InstalledVersion) "9.9.9"
Assert-InstalledBundle
`)
    },
  )

  test.skipIf(process.platform !== "win32")("retains the previous pointer if rollback is blocked", async () => {
    await runInstaller(`
Install-NodeBundleTree $Source "9.9.9"
Set-Content -LiteralPath (Join-Path $Source "node_modules/solid-js/index.js") -Value 'export const version = "9.9.10"'
$script:originalVerify = (Get-Command Verify-InstalledRuntime).ScriptBlock
$script:originalReplace = (Get-Command Replace-RuntimeFile).ScriptBlock
function Verify-InstalledRuntime([string]$ExpectedVersion) {
  if ($InstallCmdPath -eq (Join-Path $InstallDir "ax-code.cmd")) { throw "Injected final failure" }
  & $script:originalVerify $ExpectedVersion
}
function Replace-RuntimeFile($Source, $Destination, $Backup) {
  if ((Split-Path -Leaf $Source) -eq "previous-runtime") { throw "Injected rollback failure" }
  & $script:originalReplace $Source $Destination $Backup
}
$failure = $null
try { Install-NodeBundleTree $Source "9.9.10" } catch { $failure = $_ }
if ($failure -notmatch "Recovery files remain at") { throw "Expected recovery path: $failure" }
$generation = @(Get-ChildItem -LiteralPath (Join-Path $InstallRoot "versions") -Directory)[0]
$previous = [System.IO.File]::ReadAllText((Join-Path $generation.FullName "previous-runtime"))
Assert-Equal (& (Join-Path $InstallRoot $previous) --version) "9.9.9"
Assert-InstalledBundle
`)
  })

  test("rejects concurrent installers and releases the lock after failure", async () => {
    await runInstaller(`
New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
$lock = [System.IO.File]::Open((Join-Path $InstallRoot ".install.lock"), 'OpenOrCreate', 'ReadWrite', 'None')
try {
  $failure = $null
  try { Install-NodeBundleTree $Source "9.9.9" } catch { $failure = $_ }
  if ($failure -notmatch "installation lock") { throw "Expected lock failure: $failure" }
  Assert-Equal (Test-Path $InstallCmdPath) $false
} finally { $lock.Dispose() }
Install-NodeBundleTree $Source "9.9.9"
Assert-InstalledBundle
`)
  })

  test("installs a release archive with literal brackets in its filename", async () => {
    await runInstaller(`
New-PreviousInstall
Add-Type -AssemblyName System.IO.Compression.FileSystem
$script:FixtureArchive = Join-Path $env:AX_TEST_ROOT "signed [fixture].zip"
[System.IO.Compression.ZipFile]::CreateFromDirectory($Source, $script:FixtureArchive)
function Assert-MinisignAvailable {}
function Resolve-ReleaseDownload {
  return @{ Version = "9.9.9"; FileName = "release [1].zip"; Url = "https://example.invalid/release.zip" }
}
function Invoke-ReleaseDownload {
  param([string]$Uri, [string]$OutFile)
  [System.IO.File]::Copy($script:FixtureArchive, $OutFile, $true)
}
function Verify-DownloadedArchive {
  param([string]$ArchivePath, [string]$SignatureUrl, [string]$SignaturePath)
  Assert-Equal (Get-FileHash -LiteralPath $ArchivePath).Hash (Get-FileHash -LiteralPath $script:FixtureArchive).Hash
}
Assert-Equal (Install-FromRelease) "9.9.9"
Assert-InstalledBundle
`)
  })

  const moveErrors = [
    { name: "sharing lock", exception: '[System.IO.IOException]::new("Simulated sharing violation", -2147024864)' },
    { name: "access denial", exception: '[System.UnauthorizedAccessException]::new("Simulated access denial")' },
  ]
  const transientMoves = moveErrors.flatMap((error) =>
    ["backup", "activation", "rollback"].map((phase) => ({ ...error, phase, extraNativeLocks: 0 })),
  )
  transientMoves.push({ ...moveErrors[1]!, phase: "rollback", extraNativeLocks: 3 })
  test.each(transientMoves)(
    "tolerates a transient $name during $phase with $extraNativeLocks extra native locks",
    async ({ phase, exception, extraNativeLocks }) => {
      await runInstaller(`
New-PreviousInstall
$script:locks = 0
$script:injectedLocks = 0
$script:nativeFailures = 0
$script:simulatedNativeFailures = 0
$script:successfulMoves = 0
$script:rollingBack = $false
if ("${phase}" -eq "rollback") {
  function Verify-InstalledRuntime { $script:rollingBack = $true; throw "Simulated final check failure" }
}
function Move-RuntimeItem {
  [CmdletBinding()]
  param([string]$LiteralPath, [string]$Destination)
  $target = if ("${phase}" -eq "backup") {
    $LiteralPath -eq $InstallNodeDir -and -not $script:rollingBack
  } elseif ("${phase}" -eq "activation") {
    $Destination -eq $InstallNodeDir -and $LiteralPath -notmatch "previous"
  } else {
    $script:rollingBack -and $LiteralPath -eq $InstallNodeDir
  }
  if ($target) {
    $script:locks++
    if ($script:locks -le 2) { $script:injectedLocks++; throw ${exception} }
  }
  try {
    if ($target -and $script:simulatedNativeFailures -lt ${extraNativeLocks}) {
      $script:simulatedNativeFailures++
      throw [System.IO.IOException]::new("Simulated additional native sharing violation", -2147024864)
    }
    & $script:OriginalRuntimeMove @PSBoundParameters
  } catch {
    if ($target) { $script:nativeFailures++ }
    throw
  }
  if ($target) { $script:successfulMoves++ }
}
if ("${phase}" -eq "rollback") {
  $failure = $null
  try { Install-NodeBundleTree $Source } catch { $failure = $_ }
  if ($failure -notmatch "previous runtime restored") { throw "Expected restoration: $failure" }
  Assert-PreviousInstall
} else {
  Install-NodeBundleTree $Source
  Assert-InstalledBundle
}
# Real Windows execution/antivirus locks can add legitimate native retries
# after the two injected failures. Account for every attempt without relaxing
# the production retry limit or the requirement for exactly one successful move.
Assert-Equal $script:injectedLocks 2
Assert-Equal $script:simulatedNativeFailures ${extraNativeLocks}
Assert-Equal $script:successfulMoves 1
Assert-Equal $script:locks (3 + $script:nativeFailures)
if ($script:locks -gt 10) { throw "Runtime move exceeded its ten-attempt limit" }
`)
    },
  )

  test.each(moveErrors)("bounds persistent $name retries and retains the recovery tree", async ({ exception }) => {
    await runInstaller(`
New-PreviousInstall
$script:attempts = 0
$script:rollingBack = $false
$script:retryDelays = [System.Collections.Generic.List[int]]::new()
function Start-Sleep {
  param([int]$Milliseconds)
  # Only the deliberately permanent failure uses a virtual clock. Native
  # sharing failures during initial installation retain their real backoff.
  if ($script:rollingBack -and $script:attempts -gt 0) {
    $script:retryDelays.Add($Milliseconds)
    return
  }
  Microsoft.PowerShell.Utility\\Start-Sleep -Milliseconds $Milliseconds
}
Start-Sleep -Milliseconds 0
Assert-Equal $script:retryDelays.Count 0
function Verify-InstalledRuntime { $script:rollingBack = $true; throw "Simulated final check failure" }
function Move-RuntimeItem {
  [CmdletBinding()]
  param([string]$LiteralPath, [string]$Destination)
  if ($script:rollingBack -and $LiteralPath -eq $InstallNodeDir) {
    $script:attempts++
    throw ${exception}
  }
  & $script:OriginalRuntimeMove @PSBoundParameters
}
$failure = $null
try { Install-NodeBundleTree $Source } catch { $failure = $_ }
if ($failure -notmatch "Recovery files remain at") { throw "Expected recovery path: $failure" }
Assert-Equal $script:attempts 10
Assert-Equal ($script:retryDelays -join ",") "200,400,800,1600,2000,2000,2000,2000,2000"
$backup = Get-ChildItem -LiteralPath $env:AX_TEST_ROOT -Directory -Force | Where-Object { $_.Name -like ".ax-code-install-*" }
Assert-Equal (Get-Content -LiteralPath (Join-Path $backup.FullName "previous/node/bin/node.exe") -Raw) "previous"
`)
  })

  test.each(["node", "package.json"])("never merges a runtime %s into an occupied destination", async (relative) => {
    await runInstaller(`
$sourcePath = Join-Path $Source "${relative}"
$destination = Join-Path $env:AX_TEST_ROOT "occupied-target"
$marker = $destination
if ("${relative}" -eq "node") {
  New-Item -ItemType Directory -Path $destination | Out-Null
  $marker = Join-Path $destination "original.txt"
}
Set-Content -LiteralPath $marker -Value "original" -NoNewline
$failure = $null
try { Move-RuntimeItem $sourcePath $destination } catch { $failure = $_ }
if (-not $failure) { throw "Expected an occupied destination to reject the move" }
Assert-Equal (Test-Path -LiteralPath $sourcePath) $true
Assert-Equal (Get-Content -LiteralPath $marker -Raw) "original"
if ("${relative}" -eq "node") {
  Assert-Equal (Test-Path -LiteralPath (Join-Path $destination "node")) $false
}
`)
  })

  test.skipIf(process.platform !== "win32")(
    "retries a real Windows directory lock after its handle closes",
    async () => {
      await runInstaller(`
Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Threading;
public sealed class AxInstallerDirectoryLock : IDisposable {
  private readonly FileStream file;
  private Thread worker;
  public AxInstallerDirectoryLock(string path) {
    file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.None);
  }
  public void ReleaseAfter(int milliseconds) {
    worker = new Thread(() => { Thread.Sleep(milliseconds); file.Dispose(); });
    worker.Start();
  }
  public void Dispose() {
    if (worker != null) worker.Join();
    file.Dispose();
  }
}
"@
$directory = Join-Path $Source "node"
$destination = Join-Path $env:AX_TEST_ROOT "moved-node"
$lock = [AxInstallerDirectoryLock]::new((Join-Path $directory "bin/node.exe"))
try {
  $failure = $null
  try {
    Move-RuntimeItem -LiteralPath $directory -Destination $destination
  } catch { $failure = $_ }
  if (-not $failure) { throw "Expected an actual locked-directory move failure" }
  $native = $failure.Exception.GetBaseException()
  if (($native.HResult -band 0xffff) -notin @(5, 32, 33)) {
    throw "Expected a preserved native lock code, got $($native.HResult): $failure"
  }
  Assert-Equal (Test-Path -LiteralPath $destination) $false
  Assert-Equal (Test-Path -LiteralPath (Join-Path $directory "bin/node.exe")) $true
  $lock.ReleaseAfter(3000)
  Move-RuntimePath $directory $destination
  Assert-Equal (Test-Path -LiteralPath $directory) $false
  Assert-Equal (Test-Path -LiteralPath (Join-Path $destination "bin/node.exe")) $true
} finally { $lock.Dispose() }
`)
    },
  )

  test("fails immediately for unrelated move errors without changing the runtime", async () => {
    await runInstaller(`
New-PreviousInstall
$script:attempts = 0
function Move-RuntimeItem {
  [CmdletBinding()]
  param([string]$LiteralPath, [string]$Destination)
  $script:attempts++
  throw [System.IO.PathTooLongException]::new("Simulated path length failure")
}
function Start-Sleep { throw "Unexpected retry for an unrelated error" }
$failure = $null
try { Install-NodeBundleTree $Source } catch { $failure = $_ }
if ($failure -notmatch "Simulated path length failure") { throw "Missing original error: $failure" }
Assert-Equal $script:attempts 1
Assert-PreviousInstall
`)
  })

  test("does not retry a generic I/O failure when moving a file", async () => {
    await runInstaller(`
$script:attempts = 0
function Move-RuntimeItem {
  [CmdletBinding()]
  param([string]$LiteralPath, [string]$Destination)
  $script:attempts++
  throw [System.IO.IOException]::new("Simulated unrelated file failure")
}
function Start-Sleep { throw "Unexpected retry for a file error" }
$failure = $null
try {
  Move-RuntimePath (Join-Path $Source "package.json") (Join-Path $env:AX_TEST_ROOT "moved-package.json")
} catch { $failure = $_ }
if ($failure -notmatch "Simulated unrelated file failure") { throw "Missing original file error: $failure" }
Assert-Equal $script:attempts 1
`)
  })

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

  const probes = [
    { name: "version", options: '-Version "9.9.9"', arguments: ["--version"], output: "9.9.9" },
    { name: "doctor", options: "-Doctor", arguments: ["doctor"], output: "Runtime: Node v26.8.1 (node-bundled)" },
    {
      name: "backend",
      options: '-Backend -Version "9.9.9"',
      arguments: ["tui-backend", "--stdio"],
      output: JSON.stringify({ type: "rpc.result", id: 1, result: { version: "9.9.9", runtimeMode: "node-bundled" } }),
    },
  ]
  test.each(probes)(
    "passes the exact $name probe arguments and input to the launcher",
    async ({ name, options, arguments: args, output }) => {
      const inputCheck =
        name === "backend"
          ? 'let input = ""; for await (const chunk of process.stdin) input += chunk; const request = JSON.parse(input); if (request.type !== "rpc.request" || request.method !== "health" || request.id !== 1) throw new Error("Unexpected backend request");'
          : ""
      await runInstaller(`
Install-NodeBundleTree $Source
Set-Content -LiteralPath (Join-Path $InstallLibDir "index-node-tui.js") -Value 'const args = process.argv.slice(2); if (JSON.stringify(args) !== JSON.stringify(${JSON.stringify(args)})) { console.error("Unexpected probe arguments: " + JSON.stringify(args)); process.exit(23) }; ${inputCheck} console.log(${JSON.stringify(output)})'
${name === "backend" ? "$PreviousEncoding = [System.Text.UTF8Encoding]::new($true); $OutputEncoding = [Console]::InputEncoding = $PreviousEncoding" : ""}
& $env:AX_TEST_RUNTIME_PROBE -Launcher $InstallCmdPath ${options}
${
  name === "backend"
    ? `if (-not [object]::ReferenceEquals($OutputEncoding, $PreviousEncoding)) { throw "Probe changed caller output encoding" }
Assert-Equal ([Console]::InputEncoding.CodePage) $PreviousEncoding.CodePage
Assert-Equal ([Convert]::ToBase64String([Console]::InputEncoding.GetPreamble())) ([Convert]::ToBase64String($PreviousEncoding.GetPreamble()))`
    : ""
}
`)
    },
  )

  test.each(probes)("accepts a successful $name probe with stderr warnings", async ({ options, output }) => {
    await runInstaller(`
Install-NodeBundleTree $Source
Set-Content -LiteralPath (Join-Path $InstallLibDir "index-node-tui.js") -Value 'console.error("Applying first-run database migrations"); console.log(${JSON.stringify(output)})'
$PSNativeCommandUseErrorActionPreference = $true
& $env:AX_TEST_RUNTIME_PROBE -Launcher $InstallCmdPath ${options}
Assert-Equal $ErrorActionPreference "Stop"
Assert-Equal $PSNativeCommandUseErrorActionPreference $true
`)
  })

  test.each(probes)("rejects a failed $name probe even when stdout matches", async ({ options, output }) => {
    await runInstaller(`
Install-NodeBundleTree $Source
Set-Content -LiteralPath (Join-Path $InstallLibDir "index-node-tui.js") -Value 'console.error("Simulated native probe failure"); console.log(${JSON.stringify(output)}); process.exit(23)'
$PSNativeCommandUseErrorActionPreference = $true
$failure = $null
try { & $env:AX_TEST_RUNTIME_PROBE -Launcher $InstallCmdPath ${options} } catch { $failure = $_ }
if ($failure -notmatch "exit code 23" -or $failure -notmatch "Simulated native probe failure") {
  throw "Missing native failure diagnostics: $failure"
}
Assert-Equal $ErrorActionPreference "Stop"
Assert-Equal $PSNativeCommandUseErrorActionPreference $true
`)
  })

  test.each(probes)("rejects $name evidence printed only on stderr", async ({ options, output }) => {
    await runInstaller(`
Install-NodeBundleTree $Source
Set-Content -LiteralPath (Join-Path $InstallLibDir "index-node-tui.js") -Value 'console.error(${JSON.stringify(output)}); console.log("unqualified output")'
$failure = $null
try { & $env:AX_TEST_RUNTIME_PROBE -Launcher $InstallCmdPath ${options} } catch { $failure = $_ }
if (-not $failure -or $failure -notmatch "unqualified output") {
  throw "Expected rejection of stderr-only evidence: $failure"
}
Assert-Equal $ErrorActionPreference "Stop"
`)
  })

  test.each([
    {
      name: "wrong response ID",
      frames: [{ type: "rpc.result", id: 2, result: { version: "9.9.9", runtimeMode: "node-bundled" } }],
    },
    { name: "RPC error", frames: [{ type: "rpc.error", id: 1, error: { message: "backend failed" } }] },
    {
      name: "source runtime",
      frames: [{ type: "rpc.result", id: 1, result: { version: "9.9.9", runtimeMode: "source" } }],
    },
    {
      name: "stale version",
      frames: [{ type: "rpc.result", id: 1, result: { version: "8.8.8", runtimeMode: "node-bundled" } }],
    },
    { name: "empty stdout", frames: [] },
    {
      name: "evidence split between responses",
      frames: [
        { type: "rpc.result", id: 1, result: { version: "9.9.9", runtimeMode: "source" } },
        { type: "rpc.result", id: 2, result: { version: "9.9.9", runtimeMode: "node-bundled" } },
      ],
    },
    {
      name: "duplicate health replies",
      frames: [
        { type: "rpc.result", id: 1, result: { version: "9.9.9", runtimeMode: "node-bundled" } },
        { type: "rpc.result", id: 1, result: { version: "9.9.9", runtimeMode: "node-bundled" } },
      ],
    },
  ])("rejects a backend probe with $name", async ({ frames }) => {
    const output = frames.map((frame) => JSON.stringify(frame)).join("\n")
    await runInstaller(`
Install-NodeBundleTree $Source
Set-Content -LiteralPath (Join-Path $InstallLibDir "index-node-tui.js") -Value 'console.log(${JSON.stringify(output)})'
$failure = $null
try { & $env:AX_TEST_RUNTIME_PROBE -Launcher $InstallCmdPath -Backend -Version "9.9.9" } catch { $failure = $_ }
if (-not $failure) { throw "Expected backend probe rejection" }
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
function Move-RuntimeItem {
  [CmdletBinding()]
  param([string]$LiteralPath, [string]$Destination)
  if ("${phase}" -eq "backup" -and $LiteralPath -eq $InstallNodeModulesDir) {
    throw "The native addon directory is locked."
  }
  if ("${phase}" -eq "activation" -and $Destination -eq $InstallNodeModulesDir -and $LiteralPath -notmatch "previous") {
    throw "The destination cannot be written."
  }
  & $script:OriginalRuntimeMove @PSBoundParameters
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
function Move-RuntimeItem {
  [CmdletBinding()]
  param([string]$LiteralPath, [string]$Destination)
  if ($Destination -eq $InstallNodeModulesDir) { throw "Simulated activation and rollback failure" }
  & $script:OriginalRuntimeMove @PSBoundParameters
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
function Move-RuntimeItem {
  [CmdletBinding()]
  param([string]$LiteralPath, [string]$Destination)
  & $script:OriginalRuntimeMove @PSBoundParameters
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

const integrityFixture = String.raw`
function Test-SkipMinisignVerify { return $false }
function Invoke-TestMinisign { $global:LASTEXITCODE = 0 }
function Assert-MinisignAvailable {}
function Get-MinisignCommand { return "Invoke-TestMinisign" }
$AxCodeMinisignPublicKey = "test-key"
$entries = @(Get-ChildItem -LiteralPath $Source -File -Recurse | ForEach-Object {
  [ordered]@{ path = $_.FullName.Substring($Source.Length + 1).Replace('\', '/'); size = $_.Length; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
})
[ordered]@{ schema = "ax-code.runtime-integrity.v1"; algorithm = "sha256"; files = $entries } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $Source "runtime-integrity.json")
Set-Content -LiteralPath (Join-Path $Source "runtime-integrity.json.minisig") -Value "test-signature"
`

describe.skipIf(!available)("authenticated runtime staging", () => {
  test.skipIf(process.platform !== "win32")(
    "preserves authenticated metadata in an activated runtime generation",
    async () => {
      await runInstaller(
        integrityFixture +
          String.raw`
Install-NodeBundleTree $Source "9.9.9"
Install-NodeBundleTree $Source "9.9.9"
$active = [IO.File]::ReadAllText((Join-Path $InstallRoot ".active-runtime"))
$runtime = Split-Path -Parent (Split-Path -Parent (Join-Path $InstallRoot $active))
Assert-Equal (Test-Path (Join-Path $runtime "runtime-integrity.json.minisig")) $true
[void](Get-VerifiedRuntimeIntegrity $runtime)
`,
      )
    },
  )

  test("retains verified metadata during first installation", async () => {
    await runInstaller(
      integrityFixture +
        String.raw`
Install-NodeBundleTree $Source
Assert-InstalledBundle
Assert-Equal (Test-Path (Join-Path $InstallRoot "runtime-integrity.json")) $true
Assert-Equal (Test-Path (Join-Path $InstallRoot "runtime-integrity.json.minisig")) $true
[void](Get-VerifiedRuntimeIntegrity $InstallRoot)
`,
    )
  })
  test("preserves explicit authentication opt-out while rejecting damaged payload bytes", async () => {
    await runInstaller(
      integrityFixture +
        String.raw`
function Test-SkipMinisignVerify { return $true }
function Get-MinisignCommand { throw "Verification was explicitly disabled" }
[void](Get-VerifiedRuntimeIntegrity $Source)
Add-Content -LiteralPath (Join-Path $Source "lib/index-node-tui.js") -Value "changed"
$failed = $false
try { [void](Get-VerifiedRuntimeIntegrity $Source) } catch { $failed = $true }
Assert-Equal $failed $true
`,
    )
  })
  test.each(["signature", "payload"])("rejects invalid %s before candidate execution or replacement", async (kind) => {
    const damage =
      kind === "signature"
        ? "function Invoke-TestMinisign { $global:LASTEXITCODE = 1 }"
        : 'Add-Content -LiteralPath (Join-Path $Source "lib/index-node-tui.js") -Value "tampered"'
    await runInstaller(
      integrityFixture +
        String.raw`
New-PreviousInstall
$script:Executed = $false
function Assert-NodeBundleRuntime { $script:Executed = $true }
` +
        damage +
        String.raw`
$failed = $false
try { Install-NodeBundleTree $Source } catch { $failed = $true }
Assert-Equal $failed $true
Assert-Equal $script:Executed $false
Assert-PreviousInstall
`,
    )
  })
  test("rejects staging corruption before executing the candidate", async () => {
    await runInstaller(
      integrityFixture +
        String.raw`
New-PreviousInstall
$script:Executed = $false
function Assert-NodeBundleRuntime { $script:Executed = $true }
function Copy-Item([string]$LiteralPath, [string]$Destination, [switch]$Recurse, [switch]$Force) {
  Microsoft.PowerShell.Management\Copy-Item -LiteralPath $LiteralPath -Destination $Destination -Recurse:$Recurse -Force:$Force
  if ($LiteralPath -eq (Join-Path $Source "lib")) { Add-Content -LiteralPath (Join-Path $Destination "index-node-tui.js") -Value "corrupt staging" }
}
$failed = $false
try { Install-NodeBundleTree $Source } catch { $failed = $true }
Assert-Equal $failed $true
Assert-Equal $script:Executed $false
Assert-PreviousInstall
`,
    )
  })
})
