import { spawn, spawnSync } from "node:child_process"
import { createServer } from "node:http"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, test } from "vitest"

const root = path.resolve(import.meta.dirname, "..")
const powershell = process.env.AX_TEST_POWERSHELL ?? (process.platform === "win32" ? "powershell.exe" : "pwsh")
const powershellAvailable =
  spawnSync(powershell, ["-NoProfile", "-NonInteractive", "-Command", "exit 0"], { timeout: 30_000 }).status === 0
if (process.platform === "win32" && !powershellAvailable) throw new Error("Windows installer requires PowerShell")

async function transfer(
  runtime: "bash" | "powershell" | "powershell-legacy",
  statuses: number[],
  signatureValid = true,
  archive: boolean | "progress" = false,
) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ax-code-download-test-"))
  let requests = 0
  const server = createServer((_request, response) => {
    const status = statuses[Math.min(requests++, statuses.length - 1)]!
    response.writeHead(status)
    response.end(status === 200 ? "signed payload" : "upstream error")
  })
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Missing fixture port")
    const url = `http://127.0.0.1:${address.port}/artifact`
    const output = path.join(directory, "payload [1]")
    const neighbor = path.join(directory, "payload 1")
    await writeFile(neighbor, "existing neighboring file")
    let command: string
    let args: string[]
    if (runtime === "bash") {
      const source = await readFile(path.join(root, "install"), "utf8")
      const helperStart = source.indexOf("download_file() {")
      const helper = helperStart === -1 ? "" : source.slice(helperStart, source.indexOf("\n}\n", helperStart) + 3)
      const functions = source.slice(source.indexOf("unbuffered_sed() {"), source.indexOf("install_from_binary() {"))
      const script = path.join(directory, "test.sh")
      await writeFile(
        script,
        `set -euo pipefail
${helper}
${functions}
MUTED='' NC='' ORANGE='' AX_CODE_MINISIGN_PUBLIC_KEY='fixture'
print_message() { :; }
minisign() { printf 'SIGNATURE_CHECK\\n' >&2; return ${signatureValid ? 0 : 7}; }
if [ "$AX_TEST_ARCHIVE" = progress ]; then
  download_with_progress "$AX_TEST_URL" "$AX_TEST_OUTPUT"
elif [ "$AX_TEST_ARCHIVE" = 1 ]; then
  os=windows specific_version=9.9.9 filename=archive.zip url="$AX_TEST_URL"
  verify_downloaded_archive() { printf 'VERIFICATION_REACHED\\n'; exit 99; }
  download_and_install
else
  verify_downloaded_archive unused "$AX_TEST_URL" "$AX_TEST_OUTPUT"
fi
printf 'DOWNLOAD_COMPLETED\\n'
`,
      )
      command = "bash"
      args = [script]
    } else {
      const script = path.join(directory, "test.ps1")
      await writeFile(
        script,
        `$ErrorActionPreference = "Stop"
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($env:AX_TEST_INSTALLER, [ref]$null, [ref]$parseErrors)
if ($parseErrors) { throw ($parseErrors | Out-String) }
foreach ($statement in $ast.EndBlock.Statements) {
  if ($statement -is [System.Management.Automation.Language.FunctionDefinitionAst]) {
    . ([scriptblock]::Create($statement.Extent.Text))
  }
}
$App = "ax-code"
${
  runtime === "powershell-legacy"
    ? `function Invoke-WebRequest {
  param([string]$Uri, [string]$OutFile, [switch]$UseBasicParsing, [int]$TimeoutSec, $Headers, $ErrorAction)
  Invoke-LegacyReleaseDownload -Uri $Uri -OutFile $OutFile
}`
    : ""
}
$AxCodeMinisignPublicKey = "fixture"
function Test-SkipMinisignVerify { return $false }
function Get-MinisignCommand { return "Confirm-FixtureSignature" }
function Confirm-FixtureSignature { $global:LASTEXITCODE = ${signatureValid ? 0 : 7} }
Verify-DownloadedArchive -ArchivePath unused -SignatureUrl $env:AX_TEST_URL -SignaturePath $env:AX_TEST_OUTPUT
Write-Output "DOWNLOAD_COMPLETED"
`,
      )
      command = powershell
      args = ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", script]
    }
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(command, args, {
        timeout: 20_000,
        env: {
          ...process.env,
          AX_TEST_URL: url,
          AX_TEST_OUTPUT: output,
          AX_TEST_ARCHIVE: archive === "progress" ? archive : archive ? "1" : "0",
          AX_TEST_INSTALLER: path.join(root, "install.ps1"),
          TMPDIR: directory,
        },
        stdio: ["ignore", "pipe", "pipe"],
      })
      let stdout = ""
      let stderr = ""
      child.stdout.on("data", (chunk) => (stdout += chunk))
      child.stderr.on("data", (chunk) => (stderr += chunk))
      child.on("error", reject)
      child.on("close", (code) => resolve({ code, stdout, stderr }))
    })
    return {
      ...result,
      requests,
      payload: await readFile(output, "utf8").catch(() => undefined),
      neighbor: await readFile(neighbor, "utf8"),
    }
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(directory, { recursive: true, force: true })
  }
}

for (const runtime of ["bash", "powershell", "powershell-legacy"] as const) {
  const available = runtime === "bash" ? process.platform !== "win32" : powershellAvailable
  describe.skipIf(!available)(`${runtime} installer downloads`, () => {
    test.each([500, 503, 429])("recovers from transient HTTP %s without retaining its error body", async (status) => {
      const result = await transfer(runtime, [status, 200])
      expect(result.code, result.stderr).toBe(0)
      expect(result.requests).toBe(2)
      expect(result.payload).toBe("signed payload")
      expect(result.neighbor).toBe("existing neighboring file")
      expect(result.stdout).toContain("DOWNLOAD_COMPLETED")
    })

    test("stops after four failed requests", async () => {
      const result = await transfer(runtime, [503])
      expect(result.code).not.toBe(0)
      expect(result.requests).toBe(4)
      expect(result.stdout).not.toContain("DOWNLOAD_COMPLETED")
    })

    test("does not retry a missing artifact", async () => {
      const result = await transfer(runtime, [404])
      expect(result.code).not.toBe(0)
      expect(result.requests).toBe(1)
      expect(result.stdout).not.toContain("DOWNLOAD_COMPLETED")
    })

    test("does not retry failed signature verification", async () => {
      const result = await transfer(runtime, [200], false)
      expect(result.code).not.toBe(0)
      expect(result.requests).toBe(1)
      expect(result.stdout).not.toContain("DOWNLOAD_COMPLETED")
    })
  })
}

describe.skipIf(process.platform === "win32")("Unix download admission", () => {
  test("the progress transport survives a retry and closes its trace pipe", async () => {
    const result = await transfer("bash", [503, 200], true, "progress")
    expect(result.code, result.stderr).toBe(0)
    expect(result.requests).toBe(2)
    expect(result.payload).toBe("signed payload")
  })

  test("rejects an HTTP archive error before verification or extraction", async () => {
    const result = await transfer("bash", [404], true, true)
    expect(result.code).toBe(22)
    expect(result.requests).toBe(1)
    expect(result.stdout).not.toContain("VERIFICATION_REACHED")
  })
})
