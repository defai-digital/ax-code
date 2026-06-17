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
$InstallPath = Join-Path $InstallDir "ax-code.exe"

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
  irm https://raw.githubusercontent.com/defai-digital/ax-code/main/install.ps1 | iex
  .\install.ps1 -Version 5.8.0
  .\install.ps1 -Binary C:\path\to\ax-code.exe
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

function Get-LatestVersion {
  $release = Invoke-RestMethod `
    -Uri "https://api.github.com/repos/$Repo/releases/latest" `
    -UseBasicParsing `
    -Headers @{ "User-Agent" = "$App-installer" }

  $tag = [string]$release.tag_name
  if (-not $tag) {
    throw "Failed to fetch latest release version"
  }
  return $tag.TrimStart("v")
}

# Returns $true / $false when AVX2 support can be determined, or $null when it
# cannot (e.g. Windows PowerShell 5.1, whose .NET Framework lacks the intrinsics
# type). The default x64 build requires AVX2; a CPU without it needs the
# `-baseline` asset. See #274.
function Get-Avx2Support {
  try {
    $type = [Type]::GetType("System.Runtime.Intrinsics.X86.Avx2")
    if ($type) {
      $prop = $type.GetProperty("IsSupported")
      if ($prop) {
        return [bool]$prop.GetValue($null)
      }
    }
  } catch {
    # Fall through to "unknown".
  }
  return $null
}

function Resolve-ReleaseDownload([bool]$Baseline = $false) {
  $requested = Get-RequestedVersion
  $arch = Get-TargetArch
  # The baseline (AVX2-free) variant is only published for Windows x64.
  $variant = if ($Baseline -and $arch -eq "x64") { "-baseline" } else { "" }
  $filename = "$App-windows-$arch$variant.zip"

  if ($requested) {
    $specificVersion = $requested.TrimStart("v")
    $url = "https://github.com/$Repo/releases/download/v$specificVersion/$filename"
  } else {
    $specificVersion = Get-LatestVersion
    $url = "https://github.com/$Repo/releases/latest/download/$filename"
  }

  return @{
    Version = $specificVersion
    FileName = $filename
    Url = $url
  }
}

function Install-FromBinary([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Binary not found at $Path"
  }

  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  Copy-Item -LiteralPath $Path -Destination $InstallPath -Force
  Write-Info "Installed ax-code from: $Path"
  return "local"
}

function Install-FromRelease([bool]$Baseline = $false) {
  $release = Resolve-ReleaseDownload $Baseline
  $tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ("ax_code_install_" + [System.Guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null

  try {
    $archive = Join-Path $tmpDir $release.FileName
    Write-Info "Installing ax-code version: $($release.Version)"
    Invoke-WebRequest -Uri $release.Url -OutFile $archive -UseBasicParsing -Headers @{ "User-Agent" = "$App-installer" }

    Expand-Archive -Path $archive -DestinationPath $tmpDir -Force
    $binary = Get-ChildItem -Path $tmpDir -Filter "ax-code.exe" -Recurse | Select-Object -First 1
    if (-not $binary) {
      throw "Downloaded archive did not contain ax-code.exe"
    }

    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
    Copy-Item -LiteralPath $binary.FullName -Destination $InstallPath -Force
    return $release.Version
  } finally {
    Remove-Item -LiteralPath $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}

# Runs the installed binary and returns its --version output, or $null if it
# fails to run at all. A binary built for an unsupported instruction set (e.g.
# an AVX2 build on a no_avx2 CPU) crashes here with a native illegal-instruction
# fault, which surfaces as a thrown NativeCommandError or a non-zero exit. See #274.
function Get-InstalledBinaryVersion {
  if (-not (Test-Path -LiteralPath $InstallPath -PathType Leaf)) {
    return $null
  }
  try {
    $output = (& $InstallPath --version 2>$null)
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

function Verify-InstalledBinary([string]$ExpectedVersion) {
  if (-not (Test-Path -LiteralPath $InstallPath -PathType Leaf)) {
    throw "Installed binary was not found at $InstallPath"
  }

  $directVersion = Get-InstalledBinaryVersion
  if (-not $directVersion) {
    Write-Warn "Installed binary at $InstallPath did not run cleanly."
    return
  }
  if ($ExpectedVersion -and $ExpectedVersion -ne "local") {
    if ($directVersion -ne $ExpectedVersion -and $directVersion -ne "v$ExpectedVersion") {
      Write-Warn "Installed binary at $InstallPath reported '$directVersion', expected '$ExpectedVersion'."
    }
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
  if ($resolved -and $resolved.Source -and ($resolved.Source -ine $InstallPath)) {
    Write-Warn "Your current shell resolves ax-code to $($resolved.Source)"
    Write-Info "Open a new shell or run: `$env:Path = `"$InstallDir;`$env:Path`""
  }
}

if ($Help) {
  Show-Usage
  exit 0
}

if ($Binary) {
  $installedVersion = Install-FromBinary $Binary
} else {
  $arch = Get-TargetArch

  # Prefer the AVX2-free baseline build up front when we can positively confirm
  # the CPU lacks AVX2; this avoids downloading a binary that would crash.
  $useBaseline = $false
  if ($arch -eq "x64" -and (Get-Avx2Support) -eq $false) {
    Write-Info "CPU does not support AVX2; installing the baseline ax-code build."
    $useBaseline = $true
  }

  $installedVersion = Install-FromRelease $useBaseline

  # Fallback for environments where AVX2 support could not be detected ahead of
  # time (e.g. Windows PowerShell 5.1): if the default x64 build won't run, it is
  # almost certainly an AVX2/no_avx2 mismatch — retry once with the baseline asset.
  if ($arch -eq "x64" -and -not $useBaseline -and -not (Get-InstalledBinaryVersion)) {
    Write-Warn "The default ax-code build failed to start (likely a CPU without AVX2 support)."
    Write-Info "Retrying with the baseline (AVX2-free) build..."
    try {
      $installedVersion = Install-FromRelease $true
      $useBaseline = $true
    } catch {
      Write-Warn "Could not install the baseline build: $($_.Exception.Message)"
      Write-Warn "This ax-code version may not ship a baseline asset for your CPU."
    }
  }
}

Verify-InstalledBinary $installedVersion

if ($NoModifyPath) {
  Write-Info "Add this directory to PATH to use ax-code globally: $InstallDir"
} else {
  Add-ToUserPath
}

Warn-PathPrecedence
Write-Info "ax-code installed at $InstallPath"
