import fs from "fs/promises"
import { constants as fsConstants } from "fs"
import path from "path"
import z from "zod"
import { FileLock } from "@/util/filelock"
import { Filesystem } from "@/util/filesystem"
import { Process } from "@/util/process"
import { Ssrf } from "@/util/ssrf"
import { Log } from "@/util/log"
import { toErrorMessage } from "@/util/error-message"
import { installReleaseBin } from "@/lsp/server-releases"
import {
  AX_ENGINE_BINARY_RELEASE,
  AX_ENGINE_ERROR,
  AX_ENGINE_EXPECTED_TEAM_ID,
  AX_ENGINE_INSTALL_ENV,
  type AxEngineBinaryRelease,
} from "./constants"
import { AxEnginePaths } from "./paths"
import { requirePlatformEligibility } from "./platform"

const log = Log.create({ service: "ax-engine-install" })

// Overall cap for a single binary download+install, independent of any caller
// abort signal. The binary is far smaller than the model weights, so a fresh
// install should never legitimately take this long.
const INSTALL_TIMEOUT_MS = 30 * 60 * 1000

export const AxEngineInstallState = z.object({
  version: z.string(),
  path: z.string(),
  installedAt: z.number(),
  sha256: z.string().optional(),
})
export type AxEngineInstallState = z.infer<typeof AxEngineInstallState>

export const AxEngineInstallResult = z.object({
  installed: z.boolean(),
  alreadyPresent: z.boolean(),
  version: z.string(),
  binaryPath: z.string(),
})
export type AxEngineInstallResult = z.infer<typeof AxEngineInstallResult>

export type AxEngineInstallRuntime = {
  requireEligibility?: typeof requirePlatformEligibility
  resolveRelease?: () => AxEngineBinaryRelease | undefined
  install?: typeof installReleaseBin
  verifyCodesign?: (binaryPath: string, expectedTeamId?: string) => Promise<void>
  clearQuarantine?: (binaryPath: string) => Promise<void>
}

function assetNameFromUrl(url: string): string {
  try {
    const base = new URL(url).pathname.split("/").filter(Boolean).at(-1)
    return base && base.length ? base : "ax-engine.tar.gz"
  } catch {
    return "ax-engine.tar.gz"
  }
}

// Resolve the ax-engine release the current host should install, or undefined
// when there is none. The binary only ships for Apple Silicon macOS. An
// AX_ENGINE_INSTALL_URL env override wins over the pinned constant so a machine
// can target a specific artifact without a code change.
export function resolveInstallableRelease(
  platform: string = process.platform,
  arch: string = process.arch,
  env: NodeJS.ProcessEnv = process.env,
): AxEngineBinaryRelease | undefined {
  if (platform !== "darwin" || arch !== "arm64") return undefined

  const overrideUrl = env[AX_ENGINE_INSTALL_ENV.url]?.trim()
  if (overrideUrl) {
    return {
      version: env[AX_ENGINE_INSTALL_ENV.version]?.trim() || "custom",
      assetName: assetNameFromUrl(overrideUrl),
      url: overrideUrl,
      sha256: env[AX_ENGINE_INSTALL_ENV.sha256]?.trim() || undefined,
      teamId: env[AX_ENGINE_INSTALL_ENV.teamId]?.trim() || AX_ENGINE_EXPECTED_TEAM_ID || undefined,
    }
  }

  const pinned = AX_ENGINE_BINARY_RELEASE
  if (pinned && pinned.url && pinned.sha256) {
    return { ...pinned, teamId: pinned.teamId ?? (AX_ENGINE_EXPECTED_TEAM_ID || undefined) }
  }
  return undefined
}

// Whether AX Code can offer a managed install on this host. Meant for status /
// UI gating; the full platform eligibility check runs inside installAxEngineBinary.
export function isAxEngineInstallable(platform?: string, arch?: string, env?: NodeJS.ProcessEnv): boolean {
  return !!resolveInstallableRelease(platform, arch, env)
}

async function isExecutable(file: string): Promise<boolean> {
  return fs
    .access(file, fsConstants.X_OK)
    .then(() => true)
    .catch(() => false)
}

async function readInstallState(): Promise<AxEngineInstallState | undefined> {
  try {
    return AxEngineInstallState.parse(await Filesystem.readJson(AxEnginePaths.installState))
  } catch {
    return undefined
  }
}

// The currently-installed managed ax-engine binary, if the recorded marker
// still points at an executable on disk. Used by dependency resolution as the
// lowest-priority binary source. A partially-written install (no marker, or a
// marker whose binary is gone) resolves to undefined, so it is never trusted.
export async function getManagedBinary(): Promise<{ path: string; version: string } | undefined> {
  const state = await readInstallState()
  if (!state) return undefined
  if (!(await isExecutable(state.path))) return undefined
  return { path: state.path, version: state.version }
}

async function verifyCodesign(binaryPath: string, expectedTeamId?: string): Promise<void> {
  // codesign is always present on macOS. `--verify` validates the binary's
  // embedded code hashes, catching post-extraction tampering; AX Engine ships
  // ad-hoc-signed binaries, which pass this. Team-identifier enforcement is
  // opt-in (expectedTeamId): ad-hoc binaries have no team, so it is skipped
  // unless a Developer-ID team is explicitly required.
  const verify = await Process.run(["codesign", "--verify", "--strict", binaryPath], {
    timeout: 15_000,
    nothrow: true,
  })
  if (verify.code !== 0) {
    throw new Error(
      `${AX_ENGINE_ERROR.BinaryMissing}: downloaded ax-engine binary failed code-signature verification (${
        verify.stderr.toString().trim() || `codesign exited ${verify.code}`
      })`,
    )
  }
  if (!expectedTeamId) return
  const info = await Process.run(["codesign", "-dv", "--verbose=4", binaryPath], {
    timeout: 15_000,
    nothrow: true,
  })
  // codesign prints its metadata (including TeamIdentifier=...) on stderr.
  const teamId = `${info.stdout.toString()}\n${info.stderr.toString()}`.match(/TeamIdentifier=([A-Z0-9]+)/)?.[1]
  if (teamId !== expectedTeamId) {
    throw new Error(
      `${AX_ENGINE_ERROR.BinaryMissing}: downloaded ax-engine binary is signed by an unexpected team (${
        teamId ?? "unsigned"
      }, expected ${expectedTeamId})`,
    )
  }
}

async function clearQuarantine(binaryPath: string): Promise<void> {
  // A programmatically-downloaded file usually has no com.apple.quarantine
  // xattr, but strip it if present so Gatekeeper never blocks the first launch.
  await Process.run(["xattr", "-d", "com.apple.quarantine", binaryPath], { timeout: 5_000, nothrow: true }).catch(
    () => undefined,
  )
}

// Best-effort GC of older managed versions once a new one is installed.
async function cleanupOtherVersions(keep: string): Promise<void> {
  const entries = await fs.readdir(AxEnginePaths.bin, { withFileTypes: true }).catch(() => [])
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && entry.name !== keep)
      .map((entry) =>
        fs.rm(path.join(AxEnginePaths.bin, entry.name), { recursive: true, force: true }).catch(() => undefined),
      ),
  )
}

// FileLock is cross-process but not reentrant; guard concurrent same-process
// callers (e.g. two UI clicks / a click racing status polling) with an
// in-process single-flight keyed by version so they share one install.
const inflight = new Map<string, Promise<AxEngineInstallResult>>()

// Download, verify, and install the managed ax-engine binary for this host.
// Idempotent: returns the existing install when the pinned version is already
// present (unless `force`). Throws an AX_ENGINE_* domain error on unsupported
// hosts, when no release is available, or on any integrity/signature failure.
export async function installAxEngineBinary(
  input: { signal?: AbortSignal; force?: boolean } = {},
  runtime: AxEngineInstallRuntime = {},
): Promise<AxEngineInstallResult> {
  const requireEligibility = runtime.requireEligibility ?? requirePlatformEligibility
  const resolveRelease = runtime.resolveRelease ?? (() => resolveInstallableRelease())
  const install = runtime.install ?? installReleaseBin
  const verify = runtime.verifyCodesign ?? verifyCodesign
  const clearXattr = runtime.clearQuarantine ?? clearQuarantine

  await requireEligibility()

  const release = resolveRelease()
  if (!release) {
    throw new Error(
      `${AX_ENGINE_ERROR.BinaryMissing}: no installable ax-engine release is available for this host — install ax-engine manually or set ${AX_ENGINE_INSTALL_ENV.url}`,
    )
  }

  const existing = inflight.get(release.version)
  if (existing) return existing

  const run = (async (): Promise<AxEngineInstallResult> => {
    const binaryPath = AxEnginePaths.managedBinary(release.version)

    const present = async () => {
      if (input.force) return undefined
      const current = await getManagedBinary()
      return current && current.version === release.version ? current : undefined
    }

    const before = await present()
    if (before) {
      return { installed: false, alreadyPresent: true, version: before.version, binaryPath: before.path }
    }

    using _ = await FileLock.acquire(AxEnginePaths.installLock, { timeoutMs: 60_000, staleMs: 30 * 60_000 })

    // Another process may have finished the install while we waited for the lock.
    const afterLock = await present()
    if (afterLock) {
      return { installed: false, alreadyPresent: true, version: afterLock.version, binaryPath: afterLock.path }
    }

    input.signal?.throwIfAborted()

    const installDir = AxEnginePaths.managedBinaryDir(release.version)
    await fs.rm(installDir, { recursive: true, force: true }).catch(() => undefined)
    await fs.mkdir(installDir, { recursive: true })

    const timeoutSignal = AbortSignal.timeout(INSTALL_TIMEOUT_MS)
    const signal = input.signal ? AbortSignal.any([input.signal, timeoutSignal]) : timeoutSignal

    const installed = await install({
      id: "ax-engine",
      assetName: release.assetName,
      url: release.url,
      bin: binaryPath,
      installDir,
      sha256: release.sha256,
      fetcher: (url) => Ssrf.pinnedFetch(url, { label: "ax-engine.release", signal }),
    }).catch((error: unknown) => {
      log.warn("ax-engine binary download failed", {
        status: "error",
        durationMs: 0,
        errorCode: AX_ENGINE_ERROR.DownloadFailed,
        error: toErrorMessage(error),
      })
      return undefined
    })

    if (!installed) {
      await fs.rm(installDir, { recursive: true, force: true }).catch(() => undefined)
      throw new Error(`${AX_ENGINE_ERROR.DownloadFailed}: failed to download or verify the ax-engine binary`)
    }

    try {
      await clearXattr(binaryPath)
      await verify(binaryPath, release.teamId)
    } catch (error) {
      // Never leave an unverified binary behind — a later resolution must not
      // pick it up.
      await fs.rm(installDir, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }

    const state: AxEngineInstallState = {
      version: release.version,
      path: binaryPath,
      installedAt: Date.now(),
      sha256: release.sha256,
    }
    await Filesystem.writeJson(AxEnginePaths.installState, state)
    await cleanupOtherVersions(release.version).catch(() => undefined)

    log.info("installed managed ax-engine binary", {
      status: "success",
      durationMs: 0,
      version: release.version,
      binaryPath,
    })
    return { installed: true, alreadyPresent: false, version: release.version, binaryPath }
  })()

  inflight.set(release.version, run)
  try {
    return await run
  } finally {
    inflight.delete(release.version)
  }
}
