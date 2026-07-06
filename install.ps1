param(
  [Alias("v")]
  [string]$Version = "",

  [Alias("b")]
  [string]$Binary = "",

  [switch]$NoModifyPath,
  [switch]$Help
)

$ErrorActionPreference = "Stop"

$App = "ax-code"
$Repo = "defai-digital/ax-code"
$InstallDir = Join-Path $HOME ".ax-code\bin"
$InstallRoot = Split-Path -Parent $InstallDir
$InstallPath = Join-Path $InstallDir "ax-code.exe"
$InstallCmdPath = Join-Path $InstallDir "ax-code.cmd"
$InstallLibDir = Join-Path $InstallRoot "lib"
$InstallNodeModulesDir = Join-Path $InstallRoot "node_modules"
$InstallPackageJson = Join-Path $InstallRoot "package.json"

function Show-Usage {
  @"
AX Code Installer

Usage: install.ps1 [options]

Options:
  -Help                 Display this help message
  -Version <version>    Install a specific version (e.g., 5.8.0)
  -Binary <path>        Install from a local binary instead of downloading
  -NoModifyPath         Do not update the user PATH

Examples:
  irm https://github.com/defai-digital/ax-code/releases/latest/download/install.ps1 | iex
  .\install.ps1 -Version 5.8.0
  .\install.ps1 -Binary C:\path\to\ax-code.cmd
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

function Install-NodeBundleTree([string]$Root) {
  $launcher = Join-Path $Root "bin\ax-code.cmd"
  $lib = Join-Path $Root "lib"
  $entry = Join-Path $lib "index-node-tui.js"
  $nodeModules = Join-Path $Root "node_modules"
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

  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  Remove-Item -LiteralPath $InstallPath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $InstallCmdPath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $InstallLibDir -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $InstallNodeModulesDir -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $InstallPackageJson -Force -ErrorAction SilentlyContinue
  Copy-Item -LiteralPath $launcher -Destination $InstallCmdPath -Force
  Copy-Item -LiteralPath $lib -Destination $InstallLibDir -Recurse -Force
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
  $release = Resolve-ReleaseDownload
  $tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ("ax_code_install_" + [System.Guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null

  try {
    $archive = Join-Path $tmpDir $release.FileName
    Write-Info "Installing ax-code version: $($release.Version)"
    Invoke-WebRequest -Uri $release.Url -OutFile $archive -UseBasicParsing -Headers @{ "User-Agent" = "$App-installer" }

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

function Assert-NodeFfiRuntime {
  $node = Get-Command node -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $node -or -not $node.Source) {
    throw "AX Code requires Node.js with --experimental-ffi support. Install Node.js 26 or newer, then rerun this installer."
  }

  $originalNodeOptions = $env:NODE_OPTIONS
  try {
    $env:NODE_OPTIONS = ""
    $output = (& $node.Source --experimental-ffi --version 2>&1)
    if ($LASTEXITCODE -ne 0) {
      $details = ($output | Out-String).Trim()
      throw "AX Code requires a Node.js runtime that supports --experimental-ffi. Run: winget upgrade -e --id OpenJS.NodeJS. Then restart PowerShell and rerun this installer. $details"
    }
  } finally {
    $env:NODE_OPTIONS = $originalNodeOptions
  }

  if ($originalNodeOptions -and $originalNodeOptions -match "--experimental-ffi") {
    Write-Warn "NODE_OPTIONS contains --experimental-ffi. AX Code passes this flag itself; remove it if Node reports duplicate or unsupported option errors."
  }
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

if ($Help) {
  Show-Usage
  exit 0
}

Assert-NodeFfiRuntime

if ($Binary) {
  $installedVersion = Install-FromBinary $Binary
} else {
  $installedVersion = Install-FromRelease
}

Verify-InstalledRuntime $installedVersion

if ($NoModifyPath) {
  Write-Info "Add this directory to PATH to use ax-code globally: $InstallDir"
} else {
  Add-ToUserPath
}

Warn-PathPrecedence
Write-Info "ax-code installed at $InstallDir"
