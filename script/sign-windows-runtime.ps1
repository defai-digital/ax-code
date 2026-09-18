param(
  [Parameter(Mandatory = $true)][string]$Root,
  [switch]$VerifyOnly,
  [string]$ReportPath
)
$ErrorActionPreference = "Stop"
$expected = $env:WINDOWS_CERTIFICATE_SHA1
if ($expected -notmatch '^[a-fA-F0-9]{40}$') { throw "WINDOWS_CERTIFICATE_SHA1 must identify the expected publisher certificate" }
if (-not $VerifyOnly) {
  foreach ($name in @("AZURE_SIGNTOOL_PATH", "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET", "AZURE_TENANT_ID", "AZURE_KEY_VAULT_URL", "AZURE_KEY_VAULT_CERTIFICATE")) {
    if (-not [Environment]::GetEnvironmentVariable($name)) { throw "$name is required for Windows release signing" }
  }
  $vault = [uri]$env:AZURE_KEY_VAULT_URL
  if ($vault.Scheme -ne "https" -or -not $vault.Host.EndsWith(".vault.azure.net")) { throw "Invalid Azure Key Vault URL" }
}
$rootPath = (Resolve-Path -LiteralPath $Root).Path
$pending = [Collections.Generic.Stack[string]]::new()
$pending.Push($rootPath)
$files = @()
while ($pending.Count -gt 0) {
  $directory = $pending.Pop()
  if ((Get-Item -LiteralPath $directory -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Cannot sign a reparse tree: $directory" }
  foreach ($item in Get-ChildItem -LiteralPath $directory -Force) {
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Cannot sign reparse point: $($item.FullName)" }
    if ($item.PSIsContainer) { $pending.Push($item.FullName) } else { $files += $item }
  }
}
# Windows PowerShell 5.1 enumerates OrderedDictionary on array +=, which drops
# .path and fails the bundled Node audit even after the file was inspected.
$records = [Collections.Generic.List[object]]::new()
foreach ($file in $files) {
  if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Cannot sign reparse point: $($file.FullName)" }
  $stream = [IO.File]::OpenRead($file.FullName)
  try { $isPe = $stream.ReadByte() -eq 0x4d -and $stream.ReadByte() -eq 0x5a } finally { $stream.Dispose() }
  if (-not $isPe) { continue }
  $relative = $file.FullName.Substring($rootPath.Length + 1).Replace('\', '/')
  $signature = Get-AuthenticodeSignature -LiteralPath $file.FullName
  $upstreamNode = $relative -eq "node/bin/node.exe"
  # Preserve the upstream runtime identity; never replace an invalid signature
  # with ours. Other already-signed dependencies retain their publisher too.
  if ($upstreamNode) {
    if ($signature.Status -ne "Valid" -or $signature.SignerCertificate.Subject -notmatch '(?:^|,\s*)(?:CN|O)=(?:OpenJS Foundation|Node\.js Foundation)(?:,|$)') {
      throw "Bundled Node must have a valid upstream Authenticode signature"
    }
  } elseif (-not $VerifyOnly -and $signature.Status -eq "NotSigned") {
    # AzureSignTool reads its service-principal credentials from its documented
    # environment variables; never put the client secret on the command line.
    $global:LASTEXITCODE = $null
    & $env:AZURE_SIGNTOOL_PATH sign --azure-key-vault-managed-identity --azure-key-vault-url $env:AZURE_KEY_VAULT_URL --azure-key-vault-certificate $env:AZURE_KEY_VAULT_CERTIFICATE --file-digest sha256 --timestamp-rfc3161 "http://timestamp.digicert.com" --timestamp-digest sha256 --description "AX Code" $file.FullName | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "AzureSignTool failed for $relative" }
    $signature = Get-AuthenticodeSignature -LiteralPath $file.FullName
    if ($signature.SignerCertificate.Thumbprint -ne $expected) { throw "Unexpected publisher certificate: $relative" }
  }
  if ($relative -match '^node_modules/@ax-code/' -and $signature.SignerCertificate.Thumbprint -ne $expected) {
    throw "Unexpected DEFAI publisher certificate: $relative"
  }
  if ($signature.Status -ne "Valid" -or $null -eq $signature.TimeStamperCertificate) {
    throw "Missing valid Authenticode signature or timestamp: $relative"
  }
  [void]$records.Add([pscustomobject]@{
    path = $relative
    subject = $signature.SignerCertificate.Subject
    thumbprint = $signature.SignerCertificate.Thumbprint
    timestampSubject = $signature.TimeStamperCertificate.Subject
  })
}
if (-not ($records | Where-Object { $_.path -eq "node/bin/node.exe" })) { throw "Bundled Node executable was not audited" }
$report = ConvertTo-Json -InputObject @($records.ToArray()) -Depth 4
if ($ReportPath) { [IO.File]::WriteAllText($ReportPath, $report, [Text.UTF8Encoding]::new($false)) }
$report
