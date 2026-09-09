[CmdletBinding(DefaultParameterSetName = "Version")]
param(
  [Parameter(Mandatory = $true)]
  [string]$Launcher,
  [Parameter(Mandatory = $true, ParameterSetName = "Version")]
  [string]$Version,
  [Parameter(Mandatory = $true, ParameterSetName = "Doctor")]
  [switch]$Doctor
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path -LiteralPath $Launcher -PathType Leaf)) {
  throw "Runtime launcher not found: $Launcher"
}

$ProbeArguments = if ($Doctor) { @("doctor") } else { @("--version") }
$StderrPath = [System.IO.Path]::GetTempFileName()
$PreviousErrorAction = $ErrorActionPreference
$PreviousNativeErrorAction = $PSNativeCommandUseErrorActionPreference
try {
  try {
    # Windows PowerShell 5.1 promotes redirected native stderr to errors.
    # Keep diagnostics separate and decide success from this process's exit.
    $ErrorActionPreference = "Continue"
    $PSNativeCommandUseErrorActionPreference = $false
    # Native commands update the global automatic variable. A script-local
    # reset would shadow it when this helper is called from another script.
    $global:LASTEXITCODE = $null
    $Output = (& $Launcher @ProbeArguments 2>$StderrPath | Out-String).Trim()
    $ProbeExit = $global:LASTEXITCODE
  } finally {
    $ErrorActionPreference = $PreviousErrorAction
    $PSNativeCommandUseErrorActionPreference = $PreviousNativeErrorAction
  }
  $Diagnostics = (Get-Content -LiteralPath $StderrPath -Raw | Out-String).Trim()
  if ($Diagnostics) { Write-Host $Diagnostics }
  if ($Output) { Write-Host $Output }
  if ($null -eq $ProbeExit -or $ProbeExit -ne 0) {
    throw "Runtime probe '$($ProbeArguments -join ' ')' failed (exit code $ProbeExit). $Diagnostics"
  }
  if ($Doctor) {
    if ($Output -notmatch 'Runtime: Node .* \(node-bundled\)') {
      throw "Windows installation did not report a bundled Node runtime on stdout. Output: $Output"
    }
  } elseif ($Output -ne $Version -and $Output -ne "v$Version") {
    throw "Expected runtime version $Version, got '$Output'"
  }
} finally {
  Remove-Item -LiteralPath $StderrPath -Force -ErrorAction SilentlyContinue
}
