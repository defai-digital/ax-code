import z from "zod"
import semver from "semver"
import { which } from "@/util/which"
import { Filesystem } from "@/util/filesystem"
import {
  AX_ENGINE_BUNDLED_MIN_VERSION,
  AX_ENGINE_ERROR,
  AX_ENGINE_MIN_VERSION,
  AX_ENGINE_PINNED_DOWNLOAD_MIN_VERSION,
  noteAxEngineOnce,
} from "./constants"
import { getBundledBinary } from "./bundled"
import { getManagedBinary, isAxEngineInstallable, resolveInstallableRelease } from "./install"
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
  // The release `providers ax-engine install` would install on this host, when
  // it has a semver version (ADR-200). Absent on hosts with no release.
  pinnedVersion: z.string().optional(),
  // True only when an install would replace the binary resolution selects with
  // a newer pinned release: a managed or legacy bundled engine older than the
  // pin. Never for PATH or configured binaries, which outrank the managed copy.
  updateAvailable: z.boolean().optional(),
  blockers: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
})
export type AxEngineDependencyStatus = z.infer<typeof AxEngineDependencyStatus>

export type AxEngineDependencyOptions = {
  binaryPath?: unknown
  entryPath?: string
  [key: string]: unknown
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
      // A version belongs to the observed executable, never to its replacement.
      if (after !== identity) {
        if (versionCache.get(key) === entry) versionCache.delete(key)
        return undefined
      }
      if (detected && semver.coerce(detected)) {
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

// Coerce a probed version label without discarding a prerelease tag. A
// prerelease sorts BELOW its release (7.5.7-rc.1 < 7.5.7), so stripping it (the
// semver.coerce default) would let a pre-release clear a release floor. Build
// metadata does not affect precedence and is still dropped.
function coerceVersion(detected: string | undefined) {
  return detected ? semver.coerce(detected, { includePrerelease: true }) : undefined
}

function unsupportedVersionBlocker(detected: string | undefined) {
  const parsed = coerceVersion(detected)
  if (!parsed)
    return `${AX_ENGINE_ERROR.VersionUnsupported}: a verified AX Engine ${AX_ENGINE_MIN_VERSION} or later is required; detected ${detected ?? "unknown"}`
  if (semver.gte(parsed, AX_ENGINE_MIN_VERSION)) return undefined
  return `${AX_ENGINE_ERROR.VersionUnsupported}: ax-engine ${parsed.version} is installed; ${AX_ENGINE_MIN_VERSION} or later is required`
}

function lacksBundledContract(detected: string | undefined) {
  const parsed = coerceVersion(detected)
  return !parsed || semver.lt(parsed, AX_ENGINE_BUNDLED_MIN_VERSION)
}

function coercedVersionLabel(detected: string | undefined) {
  return coerceVersion(detected)?.version ?? detected ?? "unknown"
}

// The version an install would put on this host. An AX_ENGINE_INSTALL_URL
// override without a semver version ("custom") has no comparable pin.
function pinnedReleaseVersion() {
  const version = resolveInstallableRelease()?.version
  return version && semver.valid(version) ? version : undefined
}

function olderThanPin(detected: string | undefined, pinned: string | undefined) {
  const parsed = coerceVersion(detected)
  return Boolean(parsed && pinned && semver.lt(parsed, pinned))
}

function behindPinWarning(source: string, detected: string | undefined, pinned: string, advice: string) {
  return `${AX_ENGINE_ERROR.VersionUnsupported}: ${source} ax-engine ${coercedVersionLabel(detected)} is older than the ${pinned} release this AX Code installs; ${advice}`
}

const MANAGED_UPDATE_ADVICE = "run `ax-code providers ax-engine install` to update it"

export function pinnedDownloadVersionBlocker(detected: string | undefined) {
  const version = coerceVersion(detected)
  if (version && semver.gte(version, AX_ENGINE_PINNED_DOWNLOAD_MIN_VERSION)) return undefined
  return `${AX_ENGINE_ERROR.VersionUnsupported}: pinned Hub artifacts require a verified AX Engine ${AX_ENGINE_PINNED_DOWNLOAD_MIN_VERSION} or later`
}

export const AX_ENGINE_RELEASES_URL = "https://github.com/defai-digital/ax-engine/releases"

// AX Code does not ship ax-engine (ADR-190). The message is shown only when a
// local model is selected or `providers ax-engine status` runs, so cloud-only
// users never see it.
export function axEngineMissingBlocker(installable: boolean) {
  const prefix = `${AX_ENGINE_ERROR.BinaryMissing}:`
  if (!installable) {
    return [
      `${prefix} ax-engine is only available on Apple Silicon macOS.`,
      "Use a cloud provider, or point provider.ax-engine.options.baseURL at an external OpenAI-compatible server.",
    ].join("\n")
  }
  return [
    `${prefix} ax-engine was not found. It is only needed for local models; cloud providers work without it.`,
    "Install it with `brew install defai-digital/tap/ax-engine`, `ax-code providers ax-engine install`,",
    `or \`pip install "ax-engine[download]>=${AX_ENGINE_MIN_VERSION},<8"\` in a Python 3.12-3.14 virtualenv (this also provides the model download helpers),`,
    `or download a release (${AX_ENGINE_MIN_VERSION} or later) from ${AX_ENGINE_RELEASES_URL}`,
    "and set provider.ax-engine.options.binaryPath (or AX_ENGINE_BIN) to it.",
    "Check with `ax-code providers ax-engine status`.",
  ].join("\n")
}

export async function getDependencyStatus(options: AxEngineDependencyOptions = {}): Promise<AxEngineDependencyStatus> {
  const configured =
    typeof options.binaryPath === "string" && options.binaryPath.trim() ? options.binaryPath.trim() : undefined
  const env = process.env.AX_ENGINE_BIN?.trim() || undefined
  const candidate = configured ?? env
  const warnings: string[] = []
  const pinnedVersion = pinnedReleaseVersion()
  if (configured && env && configured !== env) {
    const message = `AX_ENGINE_BIN (${env}) is ignored because provider.ax-engine.options.binaryPath is set (${configured})`
    warnings.push(message)
    noteAxEngineOnce(message)
  }

  // Resolution order: explicit config/env wins when it meets AX_ENGINE_MIN_VERSION.
  // PATH, managed overlay, and the bundled sidecar must meet the same floor.
  if (candidate) {
    if (!(await Filesystem.isExecutable(candidate))) {
      return {
        available: false,
        mode: "configured",
        binaryPath: candidate,
        installable: false,
        pinnedVersion,
        updateAvailable: false,
        blockers: [`${AX_ENGINE_ERROR.BinaryMissing}: configured ax-engine binary is not executable`],
        warnings,
      }
    }
    const detectedVersion = await version(candidate)
    const versionBlocker = unsupportedVersionBlocker(detectedVersion)
    if (!versionBlocker && pinnedVersion && olderThanPin(detectedVersion, pinnedVersion)) {
      warnings.push(
        behindPinWarning(
          "configured",
          detectedVersion,
          pinnedVersion,
          "update it at its source, or clear provider.ax-engine.options.binaryPath / AX_ENGINE_BIN to use a managed install",
        ),
      )
    }
    return {
      available: !versionBlocker,
      mode: "configured",
      binaryPath: candidate,
      version: detectedVersion,
      installable: false,
      pinnedVersion,
      updateAvailable: false,
      blockers: versionBlocker ? [versionBlocker] : [],
      warnings,
    }
  }

  const found = which("ax-engine")
  if (found) {
    const detectedVersion = await version(found)
    const versionBlocker = unsupportedVersionBlocker(detectedVersion)
    if (!versionBlocker && !lacksBundledContract(detectedVersion)) {
      // PATH outranks the managed copy, so installing cannot fix this; only
      // the tool that put it on PATH can.
      if (pinnedVersion && olderThanPin(detectedVersion, pinnedVersion)) {
        warnings.push(
          behindPinWarning("PATH", detectedVersion, pinnedVersion, "update it with the tool that installed it"),
        )
      }
      return {
        available: true,
        mode: "path",
        binaryPath: found,
        version: detectedVersion,
        installable: false,
        pinnedVersion,
        updateAvailable: false,
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
      const updateAvailable = olderThanPin(detectedVersion, pinnedVersion)
      if (updateAvailable && pinnedVersion) {
        warnings.push(behindPinWarning("managed", detectedVersion, pinnedVersion, MANAGED_UPDATE_ADVICE))
      }
      return {
        available: true,
        mode: "managed",
        binaryPath: managed.path,
        version: detectedVersion,
        managedVersion: managed.version,
        installable: false,
        pinnedVersion,
        updateAvailable,
        blockers: [],
        warnings,
      }
    }
    warnings.push(
      versionBlocker ??
        `${AX_ENGINE_ERROR.VersionUnsupported}: managed ax-engine ${coercedVersionLabel(detectedVersion)} does not establish the required ${AX_ENGINE_BUNDLED_MIN_VERSION} contract; using the bundled runtime instead`,
    )
  }

  // Legacy: runtimes built before ADR-190 carry engine/<version>/. New releases
  // do not bundle ax-engine, so this only matches an older pinned runtime.
  const bundled = await getBundledBinary({ entryPath: options.entryPath })
  if (bundled) {
    const detectedVersion = await version(bundled.path)
    const versionBlocker = unsupportedVersionBlocker(detectedVersion)
    if (!versionBlocker && !lacksBundledContract(detectedVersion)) {
      // A managed install outranks the legacy bundled copy, so it can update it.
      const updateAvailable = olderThanPin(detectedVersion, pinnedVersion)
      if (updateAvailable && pinnedVersion) {
        warnings.push(behindPinWarning("bundled", detectedVersion, pinnedVersion, MANAGED_UPDATE_ADVICE))
      }
      return {
        available: true,
        mode: "bundled",
        binaryPath: bundled.path,
        version: detectedVersion,
        installable: false,
        pinnedVersion,
        updateAvailable,
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
    pinnedVersion,
    updateAvailable: false,
    blockers: [axEngineMissingBlocker(installable)],
    warnings,
  }
}
