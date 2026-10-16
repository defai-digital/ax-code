import fs from "fs/promises"
import path from "path"
import z from "zod"
import semver from "semver"
import { FileLock } from "@/util/filelock"
import { Filesystem } from "@/util/filesystem"
import { Process } from "@/util/process"
import { Ssrf } from "@/util/ssrf"
import { Log } from "@/util/log"
import { toErrorMessage } from "@/util/error-message"
import { installReleaseBin } from "@ax-code/ax-code-intel/server-releases"
import {
  AX_ENGINE_BINARY_RELEASE,
  AX_ENGINE_ERROR,
  AX_ENGINE_EXPECTED_TEAM_ID,
  AX_ENGINE_INSTALL_ENV,
  AX_ENGINE_SERVER_LOCK_STALE_MS,
  type AxEngineBinaryRelease,
} from "./constants"
import { AxEnginePaths } from "./paths"
import { probeVersion } from "./version-probe"
import { requirePlatformEligibility } from "./platform"
import { runningServerBinaryPath } from "./server"
import { axEngineRuntimeFile, AX_ENGINE_RUNTIME_REQUIRED_FILES, AX_ENGINE_RUNTIME_SIGNED_FILES } from "./payload"

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
  smoke?: (binaryPath: string, expectedVersion: string) => Promise<void>
  runningServerBinary?: () => Promise<string | undefined>
  acquireServerLock?: () => Promise<Disposable>
}

function assetNameFromUrl(url: string): string {
  try {
    const base = new URL(url).pathname.split("/").filter(Boolean).at(-1)
    return base && base.length ? base : "ax-engine.tar.gz"
  } catch {
    return "ax-engine.tar.gz"
  }
}

function optionalTrimmed(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

// Resolve the ax-engine release the current host should install, or undefined
// when there is none. The binary only ships for Apple Silicon macOS. An
// AX_ENGINE_INSTALL_URL env override wins so a machine can target a specific
// artifact without a code change. The default pin is the self-contained 7.7.0
// archive staged into darwin-arm64 AX Code releases.
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
      teamId: optionalTrimmed(env[AX_ENGINE_INSTALL_ENV.teamId]) ?? optionalTrimmed(AX_ENGINE_EXPECTED_TEAM_ID),
    }
  }

  return AX_ENGINE_BINARY_RELEASE
}

// Whether AX Code can offer a managed install on this host. Meant for status /
// UI gating; the full platform eligibility check runs inside installAxEngineBinary.
export function isAxEngineInstallable(platform?: string, arch?: string, env?: NodeJS.ProcessEnv): boolean {
  return !!resolveInstallableRelease(platform, arch, env)
}

async function pathExists(file: string): Promise<boolean> {
  return fs
    .access(file)
    .then(() => true)
    .catch(() => false)
}

export async function assertAxEngineRuntimePayload(installDir: string): Promise<void> {
  const missing: string[] = []
  for (const name of AX_ENGINE_RUNTIME_REQUIRED_FILES) {
    if (!(await pathExists(axEngineRuntimeFile(installDir, name)))) missing.push(name)
  }
  if (missing.length) {
    throw new Error(
      `${AX_ENGINE_ERROR.DownloadFailed}: ax-engine archive is missing ${missing.join(", ")} — refusing to record a managed install`,
    )
  }
}

async function chmodRuntimePayload(installDir: string): Promise<void> {
  await Promise.all(
    AX_ENGINE_RUNTIME_SIGNED_FILES.map((name) =>
      fs.chmod(axEngineRuntimeFile(installDir, name), 0o755).catch(() => undefined),
    ),
  )
}

async function smokeInstalledBinary(binaryPath: string, expectedVersion: string): Promise<void> {
  const detected = await probeVersion(binaryPath)
  const parsed = detected ? semver.coerce(detected) : undefined
  if (!parsed || (semver.valid(expectedVersion) && !semver.eq(parsed, expectedVersion))) {
    throw new Error(
      `${AX_ENGINE_ERROR.BinaryMissing}: installed ax-engine version ${detected ?? "unknown"} does not match ${expectedVersion}`,
    )
  }
}

async function readInstallState(): Promise<AxEngineInstallState | undefined> {
  try {
    return AxEngineInstallState.parse(await Filesystem.readJson(AxEnginePaths.installState))
  } catch {
    return undefined
  }
}

// The currently-installed managed ax-engine binary, if the recorded marker
// still points at an executable on disk. Dependency resolution checks it after
// PATH and before the bundled runtime. A partially-written install (no marker, or a
// marker whose runtime payload is incomplete) resolves to undefined, so it is
// never trusted and a normal install can repair it.
export async function getManagedBinary(): Promise<{ path: string; version: string } | undefined> {
  const state = await readInstallState()
  if (!state) return undefined
  if (!(await Filesystem.isExecutable(state.path))) return undefined
  try {
    await assertAxEngineRuntimePayload(path.dirname(state.path))
  } catch {
    return undefined
  }
  return { path: state.path, version: state.version }
}

async function verifyCodesign(binaryPath: string, expectedTeamId?: string): Promise<void> {
  // codesign is always present on macOS. `--verify` validates the binary's
  // embedded code hashes, catching post-extraction tampering. AX Engine 7.4.0+
  // ships Developer ID signed (team N5ZUZDUJS6) with hardened runtime; the pin
  // passes expectedTeamId so a swapped ad-hoc binary cannot be recorded.
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
  // Strip quarantine from a file or the whole extracted runtime tree so
  // Gatekeeper never blocks the first `ax-engine serve`.
  await Process.run(["xattr", "-cr", binaryPath], { timeout: 5_000, nothrow: true }).catch(() => undefined)
}

// A cold server start holds this lock until the model is ready, so wait a
// bounded time and report a busy server as a domain error, not a lock timeout.
async function acquireServerLockForInstall(): Promise<Disposable> {
  try {
    return await FileLock.acquire(AxEnginePaths.serverLock, {
      timeoutMs: 30_000,
      staleMs: AX_ENGINE_SERVER_LOCK_STALE_MS,
    })
  } catch (error) {
    throw new Error(
      `${AX_ENGINE_ERROR.ServerRunning}: an ax-engine server is starting or stopping; retry once it settles (${toErrorMessage(error)})`,
    )
  }
}

function isInside(root: string, file: string) {
  const relative = path.relative(path.resolve(root), path.resolve(file))
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
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
  const smoke = runtime.smoke ?? smokeInstalledBinary
  const runningServer = runtime.runningServerBinary ?? runningServerBinaryPath
  const acquireServerLock = runtime.acquireServerLock ?? acquireServerLockForInstall

  await requireEligibility()

  const release = resolveRelease()
  if (!release) {
    throw new Error(
      `${AX_ENGINE_ERROR.BinaryMissing}: no installable ax-engine release is available for this host — install ax-engine manually or set ${AX_ENGINE_INSTALL_ENV.url}`,
    )
  }

  // Never install an unverifiable archive. Without a pinned digest (an
  // AX_ENGINE_INSTALL_URL override with no AX_ENGINE_INSTALL_SHA256, since the
  // built-in pin always carries one) the managed install degrades from
  // hash-pinned to trust-the-network, and plain http makes that trivially
  // exploitable. The ad-hoc `codesign --verify` that follows is not a
  // countermeasure — any attacker binary can be ad-hoc signed.
  if (!release.sha256?.trim()) {
    throw new Error(
      `${AX_ENGINE_ERROR.DownloadFailed}: refusing to install ax-engine without a pinned SHA-256 — set ${AX_ENGINE_INSTALL_ENV.sha256} for the overridden release`,
    )
  }
  if (!release.url.startsWith("https://")) {
    throw new Error(`${AX_ENGINE_ERROR.DownloadFailed}: refusing to install ax-engine from a non-HTTPS URL`)
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

    // Guards that must hold before any file under the managed tree changes
    // (ADR-200): the install removes the target directory and every other
    // version, so it never runs under a live managed server, and it never
    // replaces a newer managed binary with an older pin. They run before the
    // download and again before the switch, since a server can start while
    // the archive downloads.
    const assertReplaceable = async () => {
      const current = await getManagedBinary()
      const currentVersion = current ? semver.coerce(current.version, { includePrerelease: true }) : undefined
      if (current && currentVersion && semver.valid(release.version) && semver.gt(currentVersion, release.version)) {
        throw new Error(
          `${AX_ENGINE_ERROR.DowngradeRefused}: managed ax-engine ${current.version} is newer than the ${release.version} release this AX Code installs; not downgrading`,
        )
      }
      const serverBinary = await runningServer()
      if (serverBinary && isInside(AxEnginePaths.bin, serverBinary)) {
        throw new Error(
          `${AX_ENGINE_ERROR.ServerRunning}: stop the running ax-engine server before installing ax-engine ${release.version}`,
        )
      }
    }

    const before = await present()
    if (before) {
      return { installed: false, alreadyPresent: true, version: before.version, binaryPath: before.path }
    }
    await assertReplaceable()

    using _ = await FileLock.acquire(AxEnginePaths.installLock, { timeoutMs: 60_000, staleMs: 45 * 60_000 })

    // Another process may have finished the install while we waited for the lock.
    const afterLock = await present()
    if (afterLock) {
      return { installed: false, alreadyPresent: true, version: afterLock.version, binaryPath: afterLock.path }
    }
    await assertReplaceable()

    input.signal?.throwIfAborted()

    const installDir = AxEnginePaths.managedBinaryDir(release.version)
    // Download and verify outside the selectable version tree. A same-version
    // repair must leave the installed payload intact until the locked switch.
    await fs.mkdir(AxEnginePaths.root, { recursive: true })
    // @scan-suppress security_scan - Trusted contained AX Engine cache root plus a fixed temporary-directory prefix.
    const staging = await fs.mkdtemp(path.join(AxEnginePaths.root, "install-"))
    // @scan-suppress security_scan - mkdtemp-owned directory plus a fixed payload leaf.
    const stagedDir = path.join(staging, "payload")
    // @scan-suppress security_scan - mkdtemp-owned payload directory plus the fixed managed executable basename.
    const stagedBinary = path.join(stagedDir, path.basename(binaryPath))
    let cleanupStaging = true
    try {
      await fs.mkdir(stagedDir)
      const timeoutSignal = AbortSignal.timeout(INSTALL_TIMEOUT_MS)
      const signal = input.signal ? AbortSignal.any([input.signal, timeoutSignal]) : timeoutSignal

      const installed = await install({
        id: "ax-engine",
        assetName: release.assetName,
        url: release.url,
        bin: stagedBinary,
        installDir: stagedDir,
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
        await fs.rm(stagedDir, { recursive: true, force: true }).catch(() => undefined)
        throw new Error(`${AX_ENGINE_ERROR.DownloadFailed}: failed to download or verify the ax-engine binary`)
      }

      try {
        await assertAxEngineRuntimePayload(stagedDir)
        await chmodRuntimePayload(stagedDir)
        await clearXattr(stagedDir)
        for (const name of AX_ENGINE_RUNTIME_SIGNED_FILES) {
          const runtimeFile = axEngineRuntimeFile(stagedDir, name)
          await clearXattr(runtimeFile)
          await verify(runtimeFile, release.teamId)
        }
        await smoke(stagedBinary, release.version)
      } catch (error) {
        // Never leave an unverified binary behind — a later resolution must not
        // pick it up.
        await fs.rm(stagedDir, { recursive: true, force: true }).catch(() => undefined)
        throw error
      }

      // Keep replacement, state publication and old-version cleanup in the same
      // server critical section. Startup must never observe a half-switched tree.
      using _server = await acquireServerLock()
      input.signal?.throwIfAborted()
      await assertReplaceable()
      await fs.mkdir(AxEnginePaths.bin, { recursive: true })
      // @scan-suppress security_scan - mkdtemp-owned directory plus a fixed backup leaf.
      const previous = path.join(staging, "previous")
      const backedUp = await fs.rename(installDir, previous).then(
        () => true,
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return false
          throw error
        },
      )
      let promoted = false
      try {
        await fs.rename(stagedDir, installDir)
        promoted = true
        const state: AxEngineInstallState = {
          version: release.version,
          path: binaryPath,
          installedAt: Date.now(),
          sha256: release.sha256,
        }
        await Filesystem.writeJson(AxEnginePaths.installState, state)
      } catch (error) {
        try {
          if (promoted) await fs.rm(installDir, { recursive: true, force: true })
          if (backedUp) await fs.rename(previous, installDir)
        } catch (rollbackError) {
          // Retain the backup if the filesystem cannot complete restoration.
          cleanupStaging = false
          throw new AggregateError([error, rollbackError], "Failed to restore the previous AX Engine installation")
        }
        throw error
      }
      await cleanupOtherVersions(release.version).catch(() => undefined)

      log.info("installed managed ax-engine binary", {
        status: "success",
        durationMs: 0,
        version: release.version,
        binaryPath,
      })
      return { installed: true, alreadyPresent: false, version: release.version, binaryPath }
    } finally {
      if (cleanupStaging) await fs.rm(staging, { recursive: true, force: true })
    }
  })()

  inflight.set(release.version, run)
  try {
    return await run
  } finally {
    inflight.delete(release.version)
  }
}
