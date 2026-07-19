param(
  [Alias("v")]
  [string]$Version = "",

  [Alias("b")]
  [string]$Binary = "",

  [switch]$NoModifyPath,
  [switch]$Uninstall,
  [switch]$Help
)

$ErrorActionPreference = "Stop"

$App = "ax-code"
$Repo = "defai-digital/ax-code"
# Keep in sync with install (bash), docs/release/ax-minisign.pub, and script/sign-release-assets.ts
$AxCodeMinisignPublicKey = "RWSlDu++afxCz01OqhYWhfo8+L8pVbSYXJBEb2zoWBuK0WACIzbGVZRO"
$InstallDir = Join-Path $HOME ".ax-code\bin"
$InstallRoot = Split-Path -Parent $InstallDir
$InstallPath = Join-Path $InstallDir "ax-code.exe"
$InstallCmdPath = Join-Path $InstallDir "ax-code.cmd"
$InstallLibDir = Join-Path $InstallRoot "lib"
$InstallNodeDir = Join-Path $InstallRoot "node"
$InstallNodeModulesDir = Join-Path $InstallRoot "node_modules"
$InstallPackageJson = Join-Path $InstallRoot "package.json"

# Official jedisct1 minisign Windows release (contains x86_64 and aarch64).
# Pin version + SHA-256 so bootstrap does not require a preinstalled minisign.
$MinisignVersion = "0.12"
$MinisignZipUrl = "https://github.com/jedisct1/minisign/releases/download/$MinisignVersion/minisign-$MinisignVersion-win64.zip"
$MinisignZipSha256 = "37b600344e20c19314b2e82813db2bfdcc408b77b876f7727889dbd46d539479"
$script:BootstrappedMinisignPath = $null

function Show-Usage {
  @"
AX Code Installer

Usage: install.ps1 [options]

Options:
  -Help                 Display this help message
  -Version <version>    Install a specific version (e.g., 5.8.0)
  -Binary <path>        Install from a local binary instead of downloading
  -NoModifyPath         Do not update the user PATH
  -Uninstall            Remove the user-local CLI install and PATH entry

Release downloads are verified with minisign before extraction unless
AX_CODE_SKIP_MINISIGN_VERIFY=1 is set. If minisign is not on PATH, the
installer bootstraps a pinned official minisign build (SHA-256 verified)
into %LOCALAPPDATA%\ax-code\tools\minisign.

Examples:
  irm https://github.com/defai-digital/ax-code/releases/latest/download/install.ps1 | iex
  .\install.ps1 -Version 5.8.0
  .\install.ps1 -Binary C:\path\to\ax-code.cmd
  .\install.ps1 -Uninstall
"@
}

function Write-Info([string]$Message) {
  Write-Host $Message
}

function Write-Warn([string]$Message) {
  Write-Warning $Message
}

function Normalize-PathForCompare([string]$Path) {
  return $Path.TrimEnd([char[]]@([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar))
}

function Get-RequestedVersion {
  if ($Version) {
    return $Version
  }
  if ($env:AX_CODE_VERSION) {
    return $env:AX_CODE_VERSION
  }
  if ($env:VERSION) {
    return $env:VERSION
  }
  return ""
}

function Get-TargetArch {
  $arch = $env:PROCESSOR_ARCHITEW6432
  if (-not $arch) {
    $arch = $env:PROCESSOR_ARCHITECTURE
  }

  switch -Regex ($arch) {
    "^(AMD64|x86_64)$" { return "x64" }
    "^ARM64$" { return "arm64" }
    default { throw "Unsupported Windows architecture: $arch" }
  }
}

function Get-MinisignNativeArchDir {
  # Layout inside minisign-0.12-win64.zip
  switch (Get-TargetArch) {
    "arm64" { return "aarch64" }
    default { return "x86_64" }
  }
}

function Get-LatestVersion([string]$FileName) {
  $releases = Invoke-RestMethod `
    -Uri "https://api.github.com/repos/$Repo/releases?per_page=50" `
    -UseBasicParsing `
    -Headers @{ "User-Agent" = "$App-installer" }

  foreach ($release in @($releases)) {
    $tag = [string]$release.tag_name
    if (-not $tag -or $tag -notmatch "^v\d+\.\d+\.\d+$") {
      continue
    }
    $asset = @($release.assets) | Where-Object { [string]$_.name -eq $FileName } | Select-Object -First 1
    if ($asset) {
      return $tag.TrimStart("v")
    }
  }

  throw "Failed to fetch latest CLI release version containing $FileName"
}

function Resolve-ReleaseDownload {
  $requested = Get-RequestedVersion
  $arch = Get-TargetArch
  $filename = "$App-windows-$arch.zip"

  if ($requested) {
    $specificVersion = $requested.TrimStart("v")
    $url = "https://github.com/$Repo/releases/download/v$specificVersion/$filename"
  } else {
    $specificVersion = Get-LatestVersion $filename
    $url = "https://github.com/$Repo/releases/download/v$specificVersion/$filename"
  }

  return @{
    Version = $specificVersion
    FileName = $filename
    Url = $url
  }
}

function Test-SkipMinisignVerify {
  return $env:AX_CODE_SKIP_MINISIGN_VERIFY -eq "1"
}

function Get-MinisignToolsRoot {
  $base = $env:LOCALAPPDATA
  if (-not $base) {
    $base = Join-Path $HOME "AppData\Local"
  }
  return Join-Path $base "ax-code\tools\minisign\$MinisignVersion"
}

function Get-BootstrappedMinisignPath {
  $exe = Join-Path (Get-MinisignToolsRoot) "minisign.exe"
  if (Test-Path -LiteralPath $exe -PathType Leaf) {
    return $exe
  }
  return $null
}

function Get-MinisignCommand {
  if ($script:BootstrappedMinisignPath -and (Test-Path -LiteralPath $script:BootstrappedMinisignPath -PathType Leaf)) {
    return $script:BootstrappedMinisignPath
  }

  $command = Get-Command minisign -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($command -and $command.Source) {
    return $command.Source
  }

  $bootstrapped = Get-BootstrappedMinisignPath
  if ($bootstrapped) {
    $script:BootstrappedMinisignPath = $bootstrapped
    return $bootstrapped
  }

  return $null
}

function Install-MinisignBootstrap {
  $toolsRoot = Get-MinisignToolsRoot
  $targetExe = Join-Path $toolsRoot "minisign.exe"
  if (Test-Path -LiteralPath $targetExe -PathType Leaf) {
    $script:BootstrappedMinisignPath = $targetExe
    return $targetExe
  }

  Write-Info "minisign not found on PATH; bootstrapping pinned minisign $MinisignVersion"
  $tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ("ax_code_minisign_" + [System.Guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null

  try {
    $zipPath = Join-Path $tmpDir "minisign-win64.zip"
    Invoke-WebRequest `
      -Uri $MinisignZipUrl `
      -OutFile $zipPath `
      -UseBasicParsing `
      -Headers @{ "User-Agent" = "$App-installer" }

    $hash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($hash -ne $MinisignZipSha256) {
      throw "minisign bootstrap SHA-256 mismatch. expected $MinisignZipSha256, got $hash"
    }

    Expand-Archive -Path $zipPath -DestinationPath $tmpDir -Force
    $nativeDir = Get-MinisignNativeArchDir
    $sourceExe = Get-ChildItem -Path $tmpDir -Filter "minisign.exe" -Recurse |
      Where-Object { $_.FullName -match "[\\/]$nativeDir[\\/]minisign\.exe$" } |
      Select-Object -First 1

    if (-not $sourceExe) {
      # Fall back to any minisign.exe if layout changes slightly.
      $sourceExe = Get-ChildItem -Path $tmpDir -Filter "minisign.exe" -Recurse | Select-Object -First 1
    }
    if (-not $sourceExe) {
      throw "minisign.exe not found after extracting $MinisignZipUrl"
    }

    New-Item -ItemType Directory -Force -Path $toolsRoot | Out-Null
    Copy-Item -LiteralPath $sourceExe.FullName -Destination $targetExe -Force
    $script:BootstrappedMinisignPath = $targetExe
    Write-Info "Bootstrapped minisign at $targetExe"
    return $targetExe
  } finally {
    Remove-Item -LiteralPath $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Assert-MinisignAvailable {
  if (Test-SkipMinisignVerify) {
    return
  }

  if (Get-MinisignCommand) {
    return
  }

  try {
    [void](Install-MinisignBootstrap)
  } catch {
    throw @"
minisign is required to verify AX Code release artifacts and automatic bootstrap failed:
$($_.Exception.Message)

Install minisign manually (scoop install minisign, choco install minisign, or winget install jedisct1.minisign),
or set AX_CODE_SKIP_MINISIGN_VERIFY=1 to bypass signature verification.
"@
  }

  if (-not (Get-MinisignCommand)) {
    throw "minisign bootstrap completed but minisign.exe is still not available."
  }
}

function Verify-DownloadedArchive {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ArchivePath,

    [Parameter(Mandatory = $true)]
    [string]$SignatureUrl,

    [Parameter(Mandatory = $true)]
    [string]$SignaturePath
  )

  if (Test-SkipMinisignVerify) {
    Write-Warn "skipping minisign verification because AX_CODE_SKIP_MINISIGN_VERIFY=1"
    return
  }

  $minisign = Get-MinisignCommand
  if (-not $minisign) {
    throw "minisign is required to verify AX Code release artifacts but was not found."
  }

  Write-Info "Verifying release signature"
  Invoke-WebRequest `
    -Uri $SignatureUrl `
    -OutFile $SignaturePath `
    -UseBasicParsing `
    -Headers @{ "User-Agent" = "$App-installer" }

  $previousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = & $minisign -Vm $ArchivePath -x $SignaturePath -P $AxCodeMinisignPublicKey 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorAction
  }

  if ($exitCode -ne 0) {
    $details = ($output | Out-String).Trim()
    if (-not $details) {
      $details = "minisign exited with status $exitCode"
    }
    throw "minisign verification failed for $(Split-Path -Leaf $ArchivePath). $details"
  }
}

function Install-NodeBundleTree([string]$Root) {
  $launcher = Join-Path $Root "bin\ax-code.cmd"
  $lib = Join-Path $Root "lib"
  $entry = Join-Path $lib "index-node-tui.js"
  $nodeModules = Join-Path $Root "node_modules"
  $nodeDir = Join-Path $Root "node"
  $nodeExe = Join-Path $nodeDir "bin\node.exe"
  $packageJson = Join-Path $Root "package.json"

  if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) {
    throw "Node-bundled distribution did not contain bin\ax-code.cmd"
  }
  if (-not (Test-Path -LiteralPath $entry -PathType Leaf)) {
    throw "Node-bundled distribution did not contain lib\index-node-tui.js"
  }
  if (-not (Test-Path -LiteralPath $nodeModules -PathType Container)) {
    throw "Node-bundled distribution did not contain node_modules"
  }
  if (-not (Test-Path -LiteralPath $nodeExe -PathType Leaf)) {
    throw "Node-bundled distribution did not contain node\bin\node.exe"
  }

  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  Remove-Item -LiteralPath $InstallPath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $InstallCmdPath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $InstallLibDir -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $InstallNodeDir -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $InstallNodeModulesDir -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $InstallPackageJson -Force -ErrorAction SilentlyContinue
  Copy-Item -LiteralPath $launcher -Destination $InstallCmdPath -Force
  Copy-Item -LiteralPath $lib -Destination $InstallLibDir -Recurse -Force
  Copy-Item -LiteralPath $nodeDir -Destination $InstallNodeDir -Recurse -Force
  Copy-Item -LiteralPath $nodeModules -Destination $InstallNodeModulesDir -Recurse -Force
  if (Test-Path -LiteralPath $packageJson -PathType Leaf) {
    Copy-Item -LiteralPath $packageJson -Destination $InstallPackageJson -Force
  }
}

function Install-FromBinary([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Binary not found at $Path"
  }

  $bundleRoot = Split-Path -Parent (Split-Path -Parent $Path)
  $bundleEntry = Join-Path $bundleRoot "lib\index-node-tui.js"
  if (Test-Path -LiteralPath $bundleEntry -PathType Leaf) {
    Install-NodeBundleTree $bundleRoot
    Write-Info "Installed ax-code node-bundled distribution from: $bundleRoot"
    return "local"
  }

  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  Remove-Item -LiteralPath $InstallCmdPath -Force -ErrorAction SilentlyContinue
  Copy-Item -LiteralPath $Path -Destination $InstallPath -Force
  Write-Info "Installed ax-code from: $Path"
  return "local"
}

function Install-FromRelease {
  Assert-MinisignAvailable

  $release = Resolve-ReleaseDownload
  $tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ("ax_code_install_" + [System.Guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null

  try {
    $archive = Join-Path $tmpDir $release.FileName
    $signature = "$archive.minisig"
    Write-Info "Installing ax-code version: $($release.Version)"
    Invoke-WebRequest -Uri $release.Url -OutFile $archive -UseBasicParsing -Headers @{ "User-Agent" = "$App-installer" }
    Verify-DownloadedArchive -ArchivePath $archive -SignatureUrl "$($release.Url).minisig" -SignaturePath $signature

    Expand-Archive -Path $archive -DestinationPath $tmpDir -Force
    $launcher = Get-ChildItem -Path $tmpDir -Filter "ax-code.cmd" -Recurse | Select-Object -First 1
    if (-not $launcher) {
      throw "Downloaded archive did not contain ax-code.cmd"
    }
    $root = Split-Path -Parent $launcher.DirectoryName
    $lib = Join-Path $root "lib"
    if (-not (Test-Path -LiteralPath $lib -PathType Container)) {
      throw "Downloaded archive did not contain the Node runtime lib directory"
    }
    $nodeModules = Join-Path $root "node_modules"
    if (-not (Test-Path -LiteralPath $nodeModules -PathType Container)) {
      throw "Downloaded archive did not contain the Node runtime node_modules directory"
    }
    $nodeExe = Join-Path $root "node\bin\node.exe"
    if (-not (Test-Path -LiteralPath $nodeExe -PathType Leaf)) {
      throw "Downloaded archive did not contain the bundled Node runtime"
    }

    Install-NodeBundleTree $root
    return $release.Version
  } finally {
    Remove-Item -LiteralPath $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Get-InstalledVersion {
  $target = if (Test-Path -LiteralPath $InstallCmdPath -PathType Leaf) { $InstallCmdPath } else { $InstallPath }
  if (-not (Test-Path -LiteralPath $target -PathType Leaf)) {
    return $null
  }
  try {
    $output = (& $target --version 2>$null)
    if ($LASTEXITCODE -ne 0) {
      return $null
    }
    $text = ($output | Out-String).Trim()
    if (-not $text) {
      return $null
    }
    return $text
  } catch {
    return $null
  }
}

function Verify-InstalledRuntime([string]$ExpectedVersion) {
  if (-not (Test-Path -LiteralPath $InstallCmdPath -PathType Leaf) -and -not (Test-Path -LiteralPath $InstallPath -PathType Leaf)) {
    throw "Installed ax-code launcher was not found at $InstallDir"
  }

  $directVersion = Get-InstalledVersion
  if (-not $directVersion) {
    Write-Warn "Installed ax-code launcher in $InstallDir did not run cleanly."
    return
  }
  if ($ExpectedVersion -and $ExpectedVersion -ne "local") {
    if ($directVersion -ne $ExpectedVersion -and $directVersion -ne "v$ExpectedVersion") {
      Write-Warn "Installed ax-code launcher in $InstallDir reported '$directVersion', expected '$ExpectedVersion'."
    }
  }
}

function Assert-NodeFfiRuntime([string]$NodePath) {
  if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) {
    throw "Installed AX Code bundled Node runtime was not found at $NodePath"
  }

  $originalNodeOptions = $env:NODE_OPTIONS
  try {
    $env:NODE_OPTIONS = ""
    $output = (& $NodePath --experimental-ffi --version 2>&1)
    if ($LASTEXITCODE -ne 0) {
      $details = ($output | Out-String).Trim()
      throw "Installed AX Code bundled Node runtime does not support --experimental-ffi. Reinstall AX Code from a current release. $details"
    }
  } finally {
    $env:NODE_OPTIONS = $originalNodeOptions
  }

  if ($originalNodeOptions -and $originalNodeOptions -match "--experimental-ffi") {
    Write-Warn "NODE_OPTIONS contains --experimental-ffi. AX Code passes this flag itself; remove it if Node reports duplicate or unsupported option errors."
  }
}

function Remove-FromUserPath {
  $currentUserPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if (-not $currentUserPath) {
    return
  }

  $parts = $currentUserPath -split ";" | Where-Object { $_ }
  $remaining = @()
  $removed = $false
  foreach ($part in $parts) {
    if ((Normalize-PathForCompare $part) -ieq (Normalize-PathForCompare $InstallDir)) {
      $removed = $true
      continue
    }
    $remaining += $part
  }

  if ($removed) {
    [Environment]::SetEnvironmentVariable("Path", ($remaining -join ";"), "User")
    Write-Info "Removed ax-code from the user PATH: $InstallDir"
  }

  $processParts = $env:Path -split ";" | Where-Object { $_ }
  $env:Path = (
    $processParts | Where-Object {
      (Normalize-PathForCompare $_) -ine (Normalize-PathForCompare $InstallDir)
    }
  ) -join ";"
}

function Uninstall-AxCode {
  Write-Info "Uninstalling ax-code from $InstallRoot"

  if (Test-Path -LiteralPath $InstallRoot -PathType Container) {
    Remove-Item -LiteralPath $InstallRoot -Recurse -Force -ErrorAction SilentlyContinue
  }

  Remove-FromUserPath

  $toolsRoot = Get-MinisignToolsRoot
  $toolsParent = Split-Path -Parent (Split-Path -Parent $toolsRoot)
  if (Test-Path -LiteralPath $toolsParent -PathType Container) {
    # Remove bootstrapped minisign cache when empty enough; keep other tools if any.
    if (Test-Path -LiteralPath $toolsRoot -PathType Container) {
      Remove-Item -LiteralPath $toolsRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
  }

  Write-Info "ax-code uninstalled. Open a new terminal if ax-code is still resolved from PATH."
}

function Add-ToUserPath {
  $currentUserPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $parts = @()
  if ($currentUserPath) {
    $parts = $currentUserPath -split ";" | Where-Object { $_ }
  }

  $alreadyPresent = $false
  foreach ($part in $parts) {
    if ((Normalize-PathForCompare $part) -ieq (Normalize-PathForCompare $InstallDir)) {
      $alreadyPresent = $true
      break
    }
  }

  if (-not $alreadyPresent) {
    $newPath = if ($currentUserPath) { "$InstallDir;$currentUserPath" } else { $InstallDir }
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    Write-Info "Added ax-code to the user PATH: $InstallDir"
  }

  $processParts = $env:Path -split ";" | Where-Object { $_ }
  $processHasInstallDir = $false
  foreach ($part in $processParts) {
    if ((Normalize-PathForCompare $part) -ieq (Normalize-PathForCompare $InstallDir)) {
      $processHasInstallDir = $true
      break
    }
  }

  if (-not $processHasInstallDir) {
    $env:Path = "$InstallDir;$env:Path"
  }
}

function Warn-PathPrecedence {
  $resolved = Get-Command ax-code -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($resolved -and $resolved.Source -and ($resolved.Source -ine $InstallCmdPath) -and ($resolved.Source -ine $InstallPath)) {
    Write-Warn "Your current shell resolves ax-code to $($resolved.Source)"
    Write-Info "Open a new shell or run: `$env:Path = `"$InstallDir;`$env:Path`""
  }
}

function Assert-CurrentPathLink {
  $resolved = Get-Command ax-code -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $resolved -or -not $resolved.Source) {
    throw "Installed ax-code into $InstallDir, but this PowerShell session cannot resolve ax-code on PATH. Run: `$env:Path = `"$InstallDir;`$env:Path`""
  }

  if (($resolved.Source -ieq $InstallCmdPath) -or ($resolved.Source -ieq $InstallPath)) {
    Write-Info "ax-code is available on PATH: $($resolved.Source)"
  }
}

if ($Help) {
  Show-Usage
  exit 0
}

if ($Uninstall) {
  Uninstall-AxCode
  exit 0
}

if ($Binary) {
  $installedVersion = Install-FromBinary $Binary
} else {
  $installedVersion = Install-FromRelease
}

$installedNodePath = Join-Path $InstallNodeDir "bin\node.exe"
if (Test-Path -LiteralPath $InstallCmdPath -PathType Leaf) {
  Assert-NodeFfiRuntime $installedNodePath
}

Verify-InstalledRuntime $installedVersion

if ($NoModifyPath) {
  Write-Info "Add this directory to PATH to use ax-code globally: $InstallDir"
} else {
  Add-ToUserPath
  Assert-CurrentPathLink
  Write-Info "Open a new terminal if the parent shell still cannot find ax-code."
}

Warn-PathPrecedence
Write-Info "ax-code installed at $InstallDir"
