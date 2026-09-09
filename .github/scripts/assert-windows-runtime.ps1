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
try {
  try {
    # Windows PowerShell 5.1 promotes redirected native stderr to errors.
    # Keep diagnostics separate and decide success from this process's exit.
    $ErrorActionPreference = "Continue"
    $PSNativeCommandUseErrorActionPreference = $false
    # Native commands update the global automatic variable. A script-local
    # reset would shadow it when this helper is called from another script.
    $global:LASTEXITCODE = $null
    if ($Backend) {
      # Own the pipe and write request bytes directly. PowerShell 5.1 can add
      # a BOM through its native pipeline; file-backed stdin also behaves
      # differently from the real backend pipe through the Windows launcher.
      $ProcessLauncher = $Launcher
      $ProcessArguments = $ProbeArguments -join " "
      if ($env:OS -eq "Windows_NT") {
        # ProcessStartInfo needs cmd.exe to execute the installed .cmd launcher.
        # Double quoting keeps paths with spaces inside cmd's /s /c command.
        $ProcessLauncher = $env:ComSpec
        $ProcessArguments = '/d /s /c ""{0}" {1}"' -f $Launcher, ($ProbeArguments -join " ")
      }
      $Process = [System.Diagnostics.Process]::new()
      try {
        $Process.StartInfo.FileName = $ProcessLauncher
        $Process.StartInfo.Arguments = $ProcessArguments
        $Process.StartInfo.UseShellExecute = $false
        $Process.StartInfo.RedirectStandardInput = $true
        $Process.StartInfo.RedirectStandardOutput = $true
        $Process.StartInfo.RedirectStandardError = $true
        $Process.StartInfo.StandardOutputEncoding = [System.Text.UTF8Encoding]::new($false)
        $Process.StartInfo.StandardErrorEncoding = [System.Text.UTF8Encoding]::new($false)
        # .NET Framework creates an auto-flushing stdin writer with the console
        # input encoding during Start(), before our byte writes. Suppress that
        # writer's BOM as well, then restore the caller's console encoding.
        $PreviousInputEncoding = [Console]::InputEncoding
        try {
          [Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
          if (-not $Process.Start()) { throw "Could not start backend probe" }
        } finally { [Console]::InputEncoding = $PreviousInputEncoding }
        # Drain both streams concurrently so diagnostics cannot block stdout.
        $StdoutTask = $Process.StandardOutput.ReadToEndAsync()
        $StderrTask = $Process.StandardError.ReadToEndAsync()
        $RequestBytes = [System.Text.Encoding]::UTF8.GetBytes("{`"type`":`"rpc.request`",`"method`":`"health`",`"id`":1}`n")
        $Process.StandardInput.BaseStream.Write($RequestBytes, 0, $RequestBytes.Length)
        $Process.StandardInput.BaseStream.Close()
        $Process.WaitForExit()
        $ProbeExit = $Process.ExitCode
        $Output = $StdoutTask.GetAwaiter().GetResult().Trim()
        [System.IO.File]::WriteAllText($StderrPath, $StderrTask.GetAwaiter().GetResult(), [System.Text.UTF8Encoding]::new($false))
      } finally { $Process.Dispose() }
    } else {
      $Output = (& $Launcher @ProbeArguments 2>$StderrPath | Out-String).Trim()
      $ProbeExit = $global:LASTEXITCODE
    }
  } finally {
    $ErrorActionPreference = $PreviousErrorAction
    $PSNativeCommandUseErrorActionPreference = $PreviousNativeErrorAction
  }
  $Diagnostics = ([System.IO.File]::ReadAllText($StderrPath)).Trim()
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
