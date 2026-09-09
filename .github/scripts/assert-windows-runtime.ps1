[CmdletBinding(DefaultParameterSetName = "Version")]
param(
  [Parameter(Mandatory = $true)]
  [string]$Launcher,
  [Parameter(Mandatory = $true, ParameterSetName = "Version")]
  [Parameter(Mandatory = $true, ParameterSetName = "Backend")]
  [string]$Version,
  [Parameter(Mandatory = $true, ParameterSetName = "Doctor")]
  [switch]$Doctor,
  [Parameter(Mandatory = $true, ParameterSetName = "Backend")]
  [switch]$Backend
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path -LiteralPath $Launcher -PathType Leaf)) {
  throw "Runtime launcher not found: $Launcher"
}

[string[]]$ProbeArguments = if ($Backend) { @("tui-backend", "--stdio") } elseif ($Doctor) { @("doctor") } else { @("--version") }
$ProbeLabel = $ProbeArguments -join " "
$StderrPath = [System.IO.Path]::GetTempFileName()
$PreviousErrorAction = $ErrorActionPreference
$PreviousNativeErrorAction = $PSNativeCommandUseErrorActionPreference
$PreviousOutputEncoding = $OutputEncoding
try {
  try {
    # Windows PowerShell 5.1 promotes redirected native stderr to errors.
    # Keep diagnostics separate and decide success from this process's exit.
    $ErrorActionPreference = "Continue"
    $PSNativeCommandUseErrorActionPreference = $false
    # PowerShell 5.1 can inherit UTF-8 with a BOM. RPC stdin must start with
    # the JSON request itself; preserve the caller's encoding after the probe.
    $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    # Native commands update the global automatic variable. A script-local
    # reset would shadow it when this helper is called from another script.
    $global:LASTEXITCODE = $null
    $Output = if ($Backend) {
      ('{"type":"rpc.request","method":"health","id":1}' | & $Launcher @ProbeArguments 2>$StderrPath | Out-String).Trim()
    } else {
      (& $Launcher @ProbeArguments 2>$StderrPath | Out-String).Trim()
    }
    $ProbeExit = $global:LASTEXITCODE
  } finally {
    $ErrorActionPreference = $PreviousErrorAction
    $PSNativeCommandUseErrorActionPreference = $PreviousNativeErrorAction
    $OutputEncoding = $PreviousOutputEncoding
  }
  $Diagnostics = (Get-Content -LiteralPath $StderrPath -Raw | Out-String).Trim()
  if ($Diagnostics) { Write-Host $Diagnostics }
  if ($Output) { Write-Host $Output }
  if ($null -eq $ProbeExit -or $ProbeExit -ne 0) {
    throw "Runtime probe '$ProbeLabel' failed (exit code $ProbeExit). $Diagnostics"
  }
  if ($Backend) {
    $Replies = @(
      foreach ($Line in ($Output -split '\r?\n')) {
        if (-not $Line.Trim()) { continue }
        try { $Message = ConvertFrom-Json -InputObject $Line -ErrorAction Stop } catch {
          throw "Invalid backend probe output: $Line"
        }
        if ($Message.id -eq 1 -and $Message.type -eq "rpc.error") {
          throw "Backend health probe returned an RPC error: $Line"
        }
        if ($Message.id -eq 1 -and $Message.type -eq "rpc.result") { $Message }
      }
    )
    if ($Replies.Count -ne 1 -or $Replies[0].result.runtimeMode -cne "node-bundled") {
      throw "Backend health probe did not return one bundled Node runtime result. Output: $Output"
    }
    $BackendVersion = $Replies[0].result.version
    if ($BackendVersion -ne $Version -and $BackendVersion -ne "v$Version") {
      throw "Expected backend runtime version $Version, got '$BackendVersion'"
    }
  } elseif ($Doctor) {
    if ($Output -notmatch 'Runtime: Node .* \(node-bundled\)') {
      throw "Windows installation did not report a bundled Node runtime on stdout. Output: $Output"
    }
  } elseif ($Output -ne $Version -and $Output -ne "v$Version") {
    throw "Expected runtime version $Version, got '$Output'"
  }
} finally {
  Remove-Item -LiteralPath $StderrPath -Force -ErrorAction SilentlyContinue
}
