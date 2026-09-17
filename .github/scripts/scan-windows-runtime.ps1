param([Parameter(Mandatory = $true)][string]$Root, [Parameter(Mandatory = $true)][string]$ReportDirectory)
$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $ReportDirectory | Out-Null
$status = Get-MpComputerStatus
$status | Select-Object AMProductVersion, AMEngineVersion, AntivirusSignatureVersion, AntivirusSignatureLastUpdated, AntivirusEnabled, RealTimeProtectionEnabled | ConvertTo-Json | Set-Content (Join-Path $ReportDirectory "defender-status.json")
if (-not $status.AntivirusEnabled -or -not $status.RealTimeProtectionEnabled) {
  throw "Defender protection is unavailable; no antivirus acceptance result can be recorded"
}
$scanner = Get-ChildItem -Path "$env:ProgramData\Microsoft\Windows Defender\Platform\*\MpCmdRun.exe" | Sort-Object FullName -Descending | Select-Object -First 1
if (-not $scanner) { throw "Defender scanner is unavailable" }
Get-ChildItem -LiteralPath $Root -Recurse -File | Get-FileHash -Algorithm SHA256 | ConvertTo-Json | Set-Content (Join-Path $ReportDirectory "files.json")
& $scanner.FullName -Scan -ScanType 3 -File $Root -DisableRemediation 2>&1 | Tee-Object -FilePath (Join-Path $ReportDirectory "defender-scan.txt")
if ($LASTEXITCODE -ne 0) { throw "Defender scan did not pass (exit $LASTEXITCODE); inspect the captured report" }
