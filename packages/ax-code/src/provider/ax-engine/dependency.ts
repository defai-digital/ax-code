import fs from "fs/promises"
import { constants } from "fs"
import z from "zod"
import semver from "semver"
import { which } from "@/util/which"
import {
  AX_ENGINE_BINARY_RELEASE,
  AX_ENGINE_BUNDLED_MIN_VERSION,
  AX_ENGINE_ERROR,
  AX_ENGINE_MIN_VERSION,
  AX_ENGINE_PINNED_DOWNLOAD_MIN_VERSION,
  noteAxEngineOnce,
} from "./constants"
import { getBundledBinary } from "./bundled"
import { getManagedBinary, isAxEngineInstallable } from "./install"
import { axEngineBinaryIdentity } from "./binary-identity"
import { probeVersion } from "./version-probe"

export const AxEngineDependencyStatus = z.object({
  available: z.boolean(),
  mode: z.enum(["configured", "path", "managed", "bundled", "missing"]),
  binaryPath: z.string().optional(),
  version: z.string().optional(),
  // Version of the AX Code-managed binary, when `mode` is "managed".
  managedVersion: z.string().optional(),
  // When missing, whether AX Code can download + install the binary on this host.
  installable: z.boolean().default(false),
  blockers: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
})
export type AxEngineDependencyStatus = z.infer<typeof AxEngineDependencyStatus>

export type AxEngineDependencyOptions = {
  binaryPath?: unknown
  entryPath?: string
  [key: string]: unknown
}

async function isExecutable(file: string) {
  return fs
    .access(file, constants.X_OK)
    .then(() => true)
    .catch(() => false)
}

// Selection and executable access remain live. Only successful version probes
// are reused; metadata catches launcher/native upgrades, and the TTL bounds
// changes to wrapper dependencies that are outside that identity.
const VERSION_CACHE_TTL_MS = 5 * 60_000
const VERSION_CACHE_LIMIT = 64
const versionCache = new Map<string, { identity: string; expires: number; result: Promise<string | undefined> }>()

async function version(binaryPath: string): Promise<string | undefined> {
  const identity = await axEngineBinaryIdentity({ binaryPath }).catch(() => undefined)
  if (!identity) return probeVersion(binaryPath)
  const key = binaryPath
  // @scan-suppress race_scan - Single-flight cache ownership is checked after awaits; stale probes cannot evict replacements.
  const cached = versionCache.get(key)
  if (cached?.identity === identity && cached.expires > performance.now()) return cached.result
  if (versionCache.size >= VERSION_CACHE_LIMIT) versionCache.delete(versionCache.keys().next().value!)
  const entry = { identity, expires: Infinity, result: Promise.resolve<string | undefined>(undefined) }
  entry.result = (async () => {
    try {
      const detected = await probeVersion(binaryPath)
      const after = await axEngineBinaryIdentity({ binaryPath }).catch(() => undefined)
      if (detected && semver.coerce(detected) && after === identity) {
        entry.expires = performance.now() + VERSION_CACHE_TTL_MS
      } else if (versionCache.get(key) === entry) {
        versionCache.delete(key)
      }
      return detected
    } catch (error) {
      if (versionCache.get(key) === entry) versionCache.delete(key)
      throw error
    }
  })()
  versionCache.set(key, entry)
  return entry.result
}

function unsupportedVersionBlocker(detected: string | undefined) {
  if (!detected) return undefined
  const parsed = semver.coerce(detected)
  if (!parsed || semver.gte(parsed, AX_ENGINE_MIN_VERSION)) return undefined
  return `${AX_ENGINE_ERROR.VersionUnsupported}: ax-engine ${parsed.version} is installed; ${AX_ENGINE_MIN_VERSION} or later is required`
}

function lacksBundledContract(detected: string | undefined) {
  const parsed = detected ? semver.coerce(detected) : undefined
  return !parsed || semver.lt(parsed, AX_ENGINE_BUNDLED_MIN_VERSION)
}

function coercedVersionLabel(detected: string | undefined) {
  return semver.coerce(detected)?.version ?? detected ?? "unknown"
}

export function pinnedDownloadVersionBlocker(detected: string | undefined) {
  const version = detected ? semver.coerce(detected) : undefined
  if (version && semver.gte(version, AX_ENGINE_PINNED_DOWNLOAD_MIN_VERSION)) return undefined
  return `${AX_ENGINE_ERROR.VersionUnsupported}: pinned Hub artifacts require a verified AX Engine ${AX_ENGINE_PINNED_DOWNLOAD_MIN_VERSION} or later`
}

export async function getDependencyStatus(options: AxEngineDependencyOptions = {}): Promise<AxEngineDependencyStatus> {
  const configured =
    typeof options.binaryPath === "string" && options.binaryPath.trim() ? options.binaryPath.trim() : undefined
  const env = process.env.AX_ENGINE_BIN?.trim() || undefined
  const candidate = configured ?? env
  const warnings: string[] = []
  if (configured && env && configured !== env) {
    const message = `AX_ENGINE_BIN (${env}) is ignored because provider.ax-engine.options.binaryPath is set (${configured})`
    warnings.push(message)
    noteAxEngineOnce(message)
  }

  // Resolution order: explicit config/env wins. PATH wins only when it meets
  // the bundled MTP floor. Managed overlay then bundled floor, then missing.
  if (candidate) {
    if (!(await isExecutable(candidate))) {
      return {
        available: false,
        mode: "configured",
        binaryPath: candidate,
        installable: false,
        blockers: [`${AX_ENGINE_ERROR.BinaryMissing}: configured ax-engine binary is not executable`],
        warnings,
      }
    }
    const detectedVersion = await version(candidate)
    const versionBlocker = unsupportedVersionBlocker(detectedVersion)
    return {
      available: !versionBlocker,
      mode: "configured",
      binaryPath: candidate,
      version: detectedVersion,
      installable: false,
      blockers: versionBlocker ? [versionBlocker] : [],
      warnings,
    }
  }

  const found = which("ax-engine")
  if (found) {
    const detectedVersion = await version(found)
    const versionBlocker = unsupportedVersionBlocker(detectedVersion)
    if (!versionBlocker && !lacksBundledContract(detectedVersion)) {
      if (AX_ENGINE_BINARY_RELEASE && detectedVersion && semver.coerce(detectedVersion)) {
        const parsed = semver.coerce(detectedVersion)
        if (parsed && semver.lt(parsed, AX_ENGINE_BINARY_RELEASE.version)) {
          warnings.push(
            `${AX_ENGINE_ERROR.VersionUnsupported}: PATH ax-engine ${parsed.version} is older than the bundled ${AX_ENGINE_BINARY_RELEASE.version} runtime`,
          )
        }
      }
      return {
        available: true,
        mode: "path",
        binaryPath: found,
        version: detectedVersion,
        installable: false,
        blockers: [],
        warnings,
      }
    }
    warnings.push(
      versionBlocker ??
        `${AX_ENGINE_ERROR.VersionUnsupported}: PATH ax-engine ${coercedVersionLabel(detectedVersion)} does not establish the required ${AX_ENGINE_BUNDLED_MIN_VERSION} contract; using the AX Code runtime instead`,
    )
  }

  const managed = await getManagedBinary()
  if (managed) {
    const detectedVersion = await version(managed.path)
    const versionBlocker = unsupportedVersionBlocker(detectedVersion)
    if (!versionBlocker && !lacksBundledContract(detectedVersion)) {
      return {
        available: true,
        mode: "managed",
        binaryPath: managed.path,
        version: detectedVersion,
        managedVersion: managed.version,
        installable: false,
        blockers: [],
        warnings,
      }
    }
    warnings.push(
      versionBlocker ??
        `${AX_ENGINE_ERROR.VersionUnsupported}: managed ax-engine ${coercedVersionLabel(detectedVersion)} does not establish the required ${AX_ENGINE_BUNDLED_MIN_VERSION} contract; using the bundled runtime instead`,
    )
  }

  const bundled = await getBundledBinary({ entryPath: options.entryPath })
  if (bundled) {
    const detectedVersion = await version(bundled.path)
    const versionBlocker = unsupportedVersionBlocker(detectedVersion)
    if (!versionBlocker && !lacksBundledContract(detectedVersion)) {
      return {
        available: true,
        mode: "bundled",
        binaryPath: bundled.path,
        version: detectedVersion,
        installable: false,
        blockers: [],
        warnings,
      }
    }
    warnings.push(
      versionBlocker ??
        `${AX_ENGINE_ERROR.VersionUnsupported}: bundled ax-engine ${coercedVersionLabel(detectedVersion)} does not establish the required ${AX_ENGINE_BUNDLED_MIN_VERSION} contract; reinstall the AX Code runtime or install a managed engine`,
    )
  }

  const installable = isAxEngineInstallable()
  return {
    available: false,
    mode: "missing",
    installable,
    blockers: [
      installable
        ? `${AX_ENGINE_ERROR.BinaryMissing}: ax-engine is not installed — Mac releases include it, or run \`ax-code providers ax-engine install\``
        : `${AX_ENGINE_ERROR.BinaryMissing}: install AX Engine from AX Code, or configure provider.ax-engine.options.binaryPath`,
    ],
    warnings,
  }
}
