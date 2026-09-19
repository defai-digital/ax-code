import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import { AX_ENGINE_BINARY_RELEASE, type AxEngineBinaryRelease } from "../src/provider/ax-engine/constants"
import { AX_ENGINE_BUNDLED_DIR_NAME, missingAxEngineRuntimeFiles } from "../src/provider/ax-engine/payload"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))

export const AX_ENGINE_BUNDLE_ARCHIVE_ENV = "AX_ENGINE_BUNDLE_ARCHIVE"

function exists(file: string) {
  return fs.existsSync(file)
}

function sha256File(file: string) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex")
}

export function defaultLocalEngineArchive(
  release: AxEngineBinaryRelease = AX_ENGINE_BINARY_RELEASE,
): string | undefined {
  const fromEnv = process.env[AX_ENGINE_BUNDLE_ARCHIVE_ENV]?.trim()
  if (fromEnv) return fromEnv
  const sibling = path.resolve(
    scriptDir,
    "../../../ax-engine/target/release-artifacts",
    `v${release.version}`,
    release.assetName,
  )
  if (exists(sibling)) return sibling
  return undefined
}

export function stageAxEngineRuntime(input: {
  destRoot: string
  release?: AxEngineBinaryRelease
  archivePath?: string
  required?: boolean
}): { version: string; dir: string } | undefined {
  const release = input.release ?? AX_ENGINE_BINARY_RELEASE
  const archivePath = input.archivePath ?? defaultLocalEngineArchive(release)
  if (!archivePath) {
    if (input.required) throw new Error(`AX Engine bundle archive is required for ${release.version}`)
    return undefined
  }
  if (!exists(archivePath)) {
    if (input.required) throw new Error(`AX Engine bundle archive is missing: ${archivePath}`)
    return undefined
  }
  if (release.sha256) {
    const actual = sha256File(archivePath)
    if (actual !== release.sha256.toLowerCase()) {
      throw new Error(`AX Engine bundle SHA-256 mismatch: expected ${release.sha256}, got ${actual}`)
    }
  }

  const dest = path.join(input.destRoot, AX_ENGINE_BUNDLED_DIR_NAME, release.version)
  fs.rmSync(dest, { recursive: true, force: true })
  fs.mkdirSync(dest, { recursive: true })

  const extract = spawnSync("tar", ["-xf", archivePath, "-C", dest], { encoding: "utf8" })
  if (extract.status !== 0) {
    fs.rmSync(dest, { recursive: true, force: true })
    throw new Error(`Failed to extract AX Engine archive: ${extract.stderr || extract.status}`)
  }

  const missing = missingAxEngineRuntimeFiles(dest, exists)
  if (missing.length) {
    fs.rmSync(dest, { recursive: true, force: true })
    throw new Error(`AX Engine archive is missing ${missing.join(", ")}`)
  }

  return { version: release.version, dir: dest }
}

export function resolveEngineArchiveForRelease(
  release: AxEngineBinaryRelease = AX_ENGINE_BINARY_RELEASE,
): string | undefined {
  return defaultLocalEngineArchive(release)
}
