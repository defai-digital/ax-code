// Custom electron-builder sign hook for Azure Trusted Signing.
// electron-builder 25's built-in signing only handles file/store certs, so
// Authenticode signing via Trusted Signing goes through this hook (wired in via
// `win.sign` in electron-builder.yml). It shells out to signtool.exe + the
// Azure.CodeSigning dlib so signing happens INSIDE the packaging pipeline —
// required so the latest.yml/blockmap hashes match the signed installer.
//
// Env (set by CI only when signing is configured):
//   AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET   service principal
//   AZURE_TRUSTED_SIGNING_ENDPOINT   e.g. https://eus.codesigning.azure.net/
//   AZURE_TRUSTED_SIGNING_ACCOUNT    Trusted Signing account name
//   AZURE_TRUSTED_SIGNING_PROFILE    certificate profile name
//   SIGNTOOL_PATH                    absolute path to signtool.exe
//   AZURE_CODESIGNING_DLIB           absolute path to Azure.CodeSigning.Dlib.dll
//
// No-ops (file left unsigned) when env is absent, mirroring the old WIN_CSC
// behaviour so forks/PRs without secrets still build.
const { execFileSync } = require("node:child_process")
const { writeFileSync, mkdtempSync } = require("node:fs")
const os = require("node:os")
const path = require("node:path")

let metadataPath
function metadata(endpoint, account, profile) {
  if (metadataPath) return metadataPath
  const dir = mkdtempSync(path.join(os.tmpdir(), "ts-meta-"))
  metadataPath = path.join(dir, "metadata.json")
  writeFileSync(
    metadataPath,
    JSON.stringify({ Endpoint: endpoint, CodeSigningAccountName: account, CertificateProfileName: profile }),
  )
  return metadataPath
}

exports.default = async function sign(configuration) {
  const file = configuration.path
  const endpoint = process.env.AZURE_TRUSTED_SIGNING_ENDPOINT
  const account = process.env.AZURE_TRUSTED_SIGNING_ACCOUNT
  const profile = process.env.AZURE_TRUSTED_SIGNING_PROFILE
  const signtool = process.env.SIGNTOOL_PATH
  const dlib = process.env.AZURE_CODESIGNING_DLIB

  if (!endpoint || !account || !profile || !signtool || !dlib) {
    console.warn(`⚠  Azure Trusted Signing not configured — leaving ${path.basename(file)} UNSIGNED`)
    return
  }

  execFileSync(
    signtool,
    [
      "sign",
      "/v",
      "/fd",
      "SHA256",
      "/tr",
      "http://timestamp.acs.microsoft.com",
      "/td",
      "SHA256",
      "/dlib",
      dlib,
      "/dmdf",
      metadata(endpoint, account, profile),
      file,
    ],
    { stdio: "inherit" },
  )
}
