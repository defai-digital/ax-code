import { execFileSync, spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import { sealWindowsRuntime, verifyWindowsRuntimeArchive } from "./seal-windows-runtime"

const require = createRequire(import.meta.url)
const {
  createDistributionManifest,
  writeDistributionManifest,
  verifyRuntimeManifest,
} = require("./runtime-manifest.cjs")
const roots: string[] = []
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ax-code-distribution-"))
  roots.push(root)
  for (const [name, body] of Object.entries({
    "lib/index-node-tui.js": "export {}",
    "node/bin/node.exe": "MZupstream signed runtime",
    "bin/ax-code.cmd": "@echo off",
    "node_modules/@ax-code/fs/addon.node": "MZsigned native addon",
    "package.json": "{}",
  })) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true })
    fs.writeFileSync(path.join(root, name), body)
  }
  // Windows Defender can quarantine a tiny fake node.exe; a real PE stays on disk
  // so the signer can audit node/bin/node.exe.
  if (process.platform === "win32" && process.execPath.endsWith(".exe")) {
    fs.copyFileSync(process.execPath, path.join(root, "node/bin/node.exe"))
  }
  return root
}
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe("final distribution manifest", () => {
  test("rejects files the Windows installer cannot stage", () => {
    const root = fixture()
    fs.writeFileSync(path.join(root, "unexpected.txt"), "unsupported root payload")
    expect(() => createDistributionManifest(root)).toThrow("Unsupported or duplicate")
  })
  test.skipIf(process.platform === "win32" || spawnSync("minisign", ["-v"]).status !== 0)(
    "verifies an officially signed sealed ZIP and rejects modified or absent metadata",
    () => {
      const root = fixture()
      const keys = fs.mkdtempSync(path.join(os.tmpdir(), "ax-code-signing-test-"))
      roots.push(keys)
      const archive = path.join(keys, "runtime.zip")
      const publicKey = path.join(keys, "public.key")
      const secretKey = path.join(keys, "secret.key")
      execFileSync("minisign", ["-G", "-W", "-p", publicKey, "-s", secretKey])
      execFileSync("zip", ["-qr", archive, "."], { cwd: root })
      expect(() => verifyWindowsRuntimeArchive(archive, publicKey)).toThrow()
      sealWindowsRuntime(archive, (manifest) => {
        execFileSync("minisign", ["-S", "-s", secretKey, "-m", manifest, "-x", `${manifest}.minisig`])
      })
      expect(() => verifyWindowsRuntimeArchive(archive, publicKey)).not.toThrow()
      fs.appendFileSync(path.join(root, "lib/index-node-tui.js"), "changed")
      execFileSync("zip", ["-q", archive, "lib/index-node-tui.js"], { cwd: root })
      expect(() => verifyWindowsRuntimeArchive(archive, publicKey)).toThrow("does not match")
    },
  )

  test("covers native and JavaScript bytes and detects post-sign changes", () => {
    const root = fixture()
    const before = createDistributionManifest(root)
    expect(before.files.map((file: { path: string }) => file.path)).toContain("node_modules/@ax-code/fs/addon.node")
    fs.appendFileSync(path.join(root, "node_modules/@ax-code/fs/addon.node"), "changed")
    expect(createDistributionManifest(root)).not.toEqual(before)
  })
  test.skipIf(process.platform === "win32")("rejects symlinks instead of hashing through them", () => {
    const root = fixture()
    fs.symlinkSync("index-node-tui.js", path.join(root, "lib/alias.js"))
    expect(() => createDistributionManifest(root)).toThrow("symlinks")
  })
  test.skipIf(process.platform === "win32")(
    "seals the manifest inside the final ZIP and preserves Desktop manifest compatibility",
    () => {
      const root = fixture()
      const archive = path.join(os.tmpdir(), `${path.basename(root)}.zip`)
      const output = fs.mkdtempSync(path.join(os.tmpdir(), "ax-code-sealed-"))
      roots.push(output)
      try {
        writeDistributionManifest(root)
        execFileSync("zip", ["-qr", archive, "."], { cwd: root })
        sealWindowsRuntime(archive, (manifest) => fs.writeFileSync(`${manifest}.minisig`, "test signature"))
        execFileSync("unzip", ["-q", archive, "-d", output])
        expect(fs.readFileSync(path.join(output, "runtime-integrity.json.minisig"), "utf8")).toBe("test signature")
        expect(JSON.parse(fs.readFileSync(path.join(output, "runtime-integrity.json"), "utf8"))).toEqual(
          createDistributionManifest(output),
        )
        expect(() => verifyRuntimeManifest(output)).not.toThrow()
      } finally {
        fs.rmSync(archive, { force: true })
      }
    },
  )
})

const powershell = process.env.AX_TEST_POWERSHELL ?? (process.platform === "win32" ? "powershell.exe" : "pwsh")
const available = spawnSync(powershell, ["-NoProfile", "-Command", "exit 0"], { timeout: 30000 }).status === 0
if (process.platform === "win32" && !available) throw new Error("PowerShell is required on Windows")
function runPowerShell(root: string, body: string) {
  const script = path.join(root, "test.ps1")
  fs.writeFileSync(script, body)
  return spawnSync(powershell, ["-NoProfile", "-NonInteractive", "-File", script], {
    encoding: "utf8",
    timeout: 30000,
    env: {
      ...process.env,
      AX_TEST_BUNDLE: root,
      AX_TEST_INSTALLER: path.resolve("install.ps1"),
      AX_TEST_SIGNER: path.resolve("script/sign-windows-runtime.ps1"),
    },
  })
}
const loadInstaller = `
$ErrorActionPreference = "Stop"
$ast = [System.Management.Automation.Language.Parser]::ParseFile($env:AX_TEST_INSTALLER, [ref]$null, [ref]$null)
foreach ($statement in $ast.EndBlock.Statements) {
  if ($statement -is [System.Management.Automation.Language.FunctionDefinitionAst]) { . ([scriptblock]::Create($statement.Extent.Text)) }
}
$manifest = Get-Content -LiteralPath (Join-Path $env:AX_TEST_BUNDLE "runtime-integrity.json") -Raw | ConvertFrom-Json
`
describe.skipIf(!available)("PowerShell distribution admission", () => {
  test.each(["lib/index-node-tui.js", "node_modules/@ax-code/fs/addon.node"])("rejects changed %s", (relative) => {
    const root = fixture()
    writeDistributionManifest(root)
    const clean = runPowerShell(root, loadInstaller + "\nAssert-RuntimeIntegrity $env:AX_TEST_BUNDLE $manifest")
    expect(clean.status, clean.stderr).toBe(0)
    fs.appendFileSync(path.join(root, relative), "tampered")
    const result = runPowerShell(root, loadInstaller + "\nAssert-RuntimeIntegrity $env:AX_TEST_BUNDLE $manifest")
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("Runtime integrity mismatch")
  })
  test.each(["../escape", "lib/../escape", "lib/x:stream", "lib/x.", "lib//x", "lib/NUL", "node/COM1.dll"])(
    "rejects unsafe manifest path %s",
    (relative) => {
      const root = fixture()
      const manifest = createDistributionManifest(root)
      manifest.files[0].path = relative
      fs.writeFileSync(path.join(root, "runtime-integrity.json"), JSON.stringify(manifest))
      const result = runPowerShell(root, loadInstaller + "\nAssert-RuntimeIntegrity $env:AX_TEST_BUNDLE $manifest")
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain("Invalid runtime integrity entry")
    },
  )
  test("rejects a directory junction or symlink before hashing its contents", () => {
    const root = fixture()
    writeDistributionManifest(root)
    const target = path.join(root, "original-lib")
    fs.renameSync(path.join(root, "lib"), target)
    fs.symlinkSync(target, path.join(root, "lib"), process.platform === "win32" ? "junction" : "dir")
    const result = runPowerShell(root, loadInstaller + "\nAssert-RuntimeIntegrity $env:AX_TEST_BUNDLE $manifest")
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("reparse point")
  })

  test("rejects undeclared executable code", () => {
    const root = fixture()
    writeDistributionManifest(root)
    fs.writeFileSync(path.join(root, "lib/extra.js"), "unexpected")
    const result = runPowerShell(root, loadInstaller + "\nAssert-RuntimeIntegrity $env:AX_TEST_BUNDLE $manifest")
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("not listed in manifest")
  })
  test("fails release signing closed without credentials", () => {
    const root = fixture()
    const result = runPowerShell(
      root,
      '$env:WINDOWS_CERTIFICATE_SHA1 = ""\n& $env:AX_TEST_SIGNER -Root $env:AX_TEST_BUNDLE',
    )
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("WINDOWS_CERTIFICATE_SHA1")
  })
  test.each(["valid", "bad-node", "wrong-publisher", "no-timestamp", "verify-unsigned"])(
    "enforces signing policy: %s",
    (scenario) => {
      const root = fixture()
      const result = runPowerShell(
        root,
        `
$ErrorActionPreference = "Stop"
$env:WINDOWS_CERTIFICATE_SHA1 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
$env:AZURE_SIGNTOOL_PATH = 'Invoke-TestSigning'
$env:AZURE_CLIENT_ID = 'test-client'
$env:AZURE_CLIENT_SECRET = 'test-only-placeholder'
$env:AZURE_TENANT_ID = 'test-tenant'
$env:AZURE_KEY_VAULT_URL = 'https://test.vault.azure.net'
$env:AZURE_KEY_VAULT_CERTIFICATE = 'test-certificate'
$global:Signed = $false
function global:Invoke-TestSigning { $global:Signed = $true; $global:LASTEXITCODE = 0 }
function global:Get-AuthenticodeSignature([string]$LiteralPath) {
  $node = $LiteralPath.EndsWith('node.exe')
  $status = if ($node -or $global:Signed) { 'Valid' } else { 'NotSigned' }
  if ('${scenario}' -eq 'bad-node' -and $node) { $status = 'HashMismatch' }
  $thumbprint = if ('${scenario}' -eq 'wrong-publisher') { 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB' } else { $env:WINDOWS_CERTIFICATE_SHA1 }
  $subject = if ($node) { 'CN=OpenJS Foundation' } else { 'CN=DEFAI Private Limited' }
  $timestamp = if ('${scenario}' -eq 'no-timestamp') { $null } else { [pscustomobject]@{ Subject = 'Test timestamp' } }
  return [pscustomobject]@{ Status = $status; SignerCertificate = [pscustomobject]@{ Subject = $subject; Thumbprint = $thumbprint }; TimeStamperCertificate = $timestamp }
}
& $env:AX_TEST_SIGNER -Root $env:AX_TEST_BUNDLE ${scenario === "verify-unsigned" ? "-VerifyOnly" : ""}
`,
      )
      if (scenario === "valid") expect(result.status, result.stderr).toBe(0)
      else expect(result.status, result.stdout).not.toBe(0)
    },
  )
})
