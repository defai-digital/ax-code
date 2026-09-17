import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const { createDistributionManifest, writeRuntimeManifest } = require("./runtime-manifest.cjs")

/** Seal the full payload inventory before the outer archive is signed.
 * Runs on the release publisher (macOS), never during client installation.
 */
export function sealWindowsRuntime(archive: string, sign: (manifest: string) => void) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ax-code-seal-"))
  try {
    execFileSync("unzip", ["-q", path.resolve(archive), "-d", root])
    const manifestPath = path.join(root, "runtime-integrity.json")
    // Recompute rather than trusting build metadata or omitting late additions.
    const manifest = createDistributionManifest(root)
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    sign(manifestPath)
    if (!fs.existsSync(`${manifestPath}.minisig`)) throw new Error("Distribution manifest signature is missing")
    // Keep the Desktop non-native staging contract valid after adding metadata.
    writeRuntimeManifest(root)
    execFileSync(
      "zip",
      [
        "-q",
        "-X",
        path.resolve(archive),
        "runtime-integrity.json",
        "runtime-integrity.json.minisig",
        "runtime-manifest.json",
      ],
      { cwd: root },
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export function verifyWindowsRuntimeArchive(archive: string, publicKey: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ax-code-verify-sealed-"))
  try {
    execFileSync("unzip", ["-q", path.resolve(archive), "-d", root])
    const manifestPath = path.join(root, "runtime-integrity.json")
    execFileSync("minisign", ["-V", "-p", path.resolve(publicKey), "-m", manifestPath, "-x", `${manifestPath}.minisig`])
    const expected = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
    if (JSON.stringify(expected) !== JSON.stringify(createDistributionManifest(root))) {
      throw new Error("Sealed Windows distribution does not match its authenticated manifest")
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

if (import.meta.main) {
  if (process.argv.length !== 4) throw new Error("Usage: seal-windows-runtime.ts <archive> <public-key-file>")
  verifyWindowsRuntimeArchive(process.argv[2], process.argv[3])
}
