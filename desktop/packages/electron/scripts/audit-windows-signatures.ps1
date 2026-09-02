param(
  [Parameter(Mandatory = $true)]
  [string] $Root,
  [Parameter(Mandatory = $true)]
  [string] $ExpectedThumbprint
)

$ErrorActionPreference = "Stop"
$expected = ($ExpectedThumbprint -replace "[^a-fA-F0-9]", "").ToUpperInvariant()
if ($expected.Length -ne 40) {
  throw "ExpectedThumbprint must be a 40-character SHA-1 thumbprint"
}

$files = @(Get-ChildItem -LiteralPath $Root -Recurse -File | Where-Object {
  $_.Extension.ToLowerInvariant() -in @(".exe", ".dll", ".node")
})
if ($files.Count -eq 0) {
  throw "No Windows PE files found under $Root"
}

foreach ($file in $files) {
  $signature = Get-AuthenticodeSignature -LiteralPath $file.FullName
  if ($signature.Status.ToString() -ne "Valid") {
    throw "Invalid Authenticode signature for $($file.FullName): $($signature.Status) $($signature.StatusMessage)"
  }
  $actual = $signature.SignerCertificate.Thumbprint.ToUpperInvariant()
  if ($actual -ne $expected) {
    throw "Unexpected Authenticode certificate for $($file.FullName): $actual"
  }
  if ($null -eq $signature.TimeStamperCertificate) {
    throw "Authenticode signature has no timestamp: $($file.FullName)"
  }
  Write-Host "Verified Authenticode signature and timestamp: $($file.FullName)"
}

Write-Host "Verified $($files.Count) Windows PE files under $Root"
