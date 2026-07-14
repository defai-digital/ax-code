// Custom electron-builder sign hook for an Authenticode certificate whose
// private key is held by Azure Key Vault. AzureSignTool performs the signing
// operation remotely, so the private key never enters the CI runner.
//
// Release CI sets WINDOWS_SIGNING_REQUIRED=true and provides:
//   AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET
//   AZURE_KEY_VAULT_URL
//   AZURE_KEY_VAULT_CERTIFICATE
//   AZURE_SIGNTOOL_PATH
//   WINDOWS_CERTIFICATE_SHA1
//
// Local builds without AZURE_SIGNTOOL_PATH remain unsigned. Once signing is
// requested, missing configuration, signing errors, an unexpected certificate,
// or a missing RFC 3161 timestamp fails the build.
const { execFileSync } = require("node:child_process")
const path = require("node:path")

const REQUIRED_ENV = [
  "AZURE_TENANT_ID",
  "AZURE_CLIENT_ID",
  "AZURE_CLIENT_SECRET",
  "AZURE_KEY_VAULT_URL",
  "AZURE_KEY_VAULT_CERTIFICATE",
  "AZURE_SIGNTOOL_PATH",
  "WINDOWS_CERTIFICATE_SHA1",
]

const TIMESTAMP_URL = "http://timestamp.digicert.com"

function normalizeThumbprint(value) {
  const normalized = value.replace(/[^a-fA-F0-9]/g, "").toUpperCase()
  if (!/^[A-F0-9]{40}$/.test(normalized)) {
    throw new Error("WINDOWS_CERTIFICATE_SHA1 must be a 40-character SHA-1 certificate thumbprint")
  }
  return normalized
}

function resolveSigningConfiguration(env) {
  const requested = env.WINDOWS_SIGNING_REQUIRED === "true" || Boolean(env.AZURE_SIGNTOOL_PATH)
  if (!requested) return null

  const missing = REQUIRED_ENV.filter((name) => !env[name])
  if (missing.length > 0) {
    throw new Error(`Windows signing is required but configuration is missing: ${missing.join(", ")}`)
  }

  const vaultUrl = new URL(env.AZURE_KEY_VAULT_URL)
  if (vaultUrl.protocol !== "https:" || !vaultUrl.hostname.endsWith(".vault.azure.net")) {
    throw new Error("AZURE_KEY_VAULT_URL must be an HTTPS Azure Key Vault URL")
  }

  return {
    certificateName: env.AZURE_KEY_VAULT_CERTIFICATE,
    expectedThumbprint: normalizeThumbprint(env.WINDOWS_CERTIFICATE_SHA1),
    toolPath: env.AZURE_SIGNTOOL_PATH,
    vaultUrl: vaultUrl.toString(),
  }
}

function buildSignArguments(file, config) {
  return [
    "sign",
    "--azure-key-vault-managed-identity",
    "--azure-key-vault-url",
    config.vaultUrl,
    "--azure-key-vault-certificate",
    config.certificateName,
    "--file-digest",
    "sha256",
    "--timestamp-rfc3161",
    TIMESTAMP_URL,
    "--timestamp-digest",
    "sha256",
    "--description",
    "AX Code",
    "--description-url",
    "https://github.com/defai-digital/ax-code",
    "--verbose",
    file,
  ]
}

const VERIFY_SCRIPT = String.raw`
$ErrorActionPreference = "Stop"
$signature = Get-AuthenticodeSignature -LiteralPath $env:AX_SIGNED_FILE

if ($signature.Status.ToString() -ne "Valid") {
  throw "Authenticode verification failed for '$env:AX_SIGNED_FILE': $($signature.Status) $($signature.StatusMessage)"
}

$actualThumbprint = $signature.SignerCertificate.Thumbprint.ToUpperInvariant()
if ($actualThumbprint -ne $env:AX_EXPECTED_CERTIFICATE_SHA1) {
  throw "Unexpected signing certificate for '$env:AX_SIGNED_FILE': $actualThumbprint"
}

if ($null -eq $signature.TimeStamperCertificate) {
  throw "Authenticode signature has no timestamp: '$env:AX_SIGNED_FILE'"
}

Write-Host "Verified Authenticode signature and timestamp: $env:AX_SIGNED_FILE"
`

function verifySignature(file, expectedThumbprint, env) {
  execFileSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", VERIFY_SCRIPT], {
    env: {
      ...env,
      AX_EXPECTED_CERTIFICATE_SHA1: expectedThumbprint,
      AX_SIGNED_FILE: file,
    },
    stdio: "inherit",
    windowsHide: true,
  })
}

exports.default = async function sign(configuration) {
  const file = configuration.path
  const config = resolveSigningConfiguration(process.env)

  if (!config) {
    console.warn(`⚠  Azure Key Vault signing not configured — leaving ${path.basename(file)} UNSIGNED`)
    return
  }

  if (configuration.hash && configuration.hash.toLowerCase() !== "sha256") {
    throw new Error(`Unsupported Windows signing digest requested by electron-builder: ${configuration.hash}`)
  }

  execFileSync(config.toolPath, buildSignArguments(file, config), {
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  })

  verifySignature(file, config.expectedThumbprint, process.env)
}

exports.__test = {
  buildSignArguments,
  normalizeThumbprint,
  resolveSigningConfiguration,
}
