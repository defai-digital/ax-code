import { createHash, randomUUID } from "node:crypto"
import { createReadStream } from "node:fs"
import { lstat, mkdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { hasPassedMacReleasePipeline, type DesktopReleaseDiagnostics } from "../packaging/release-diagnostics"

export type DesktopUpdateCheckResult = {
  status: "disabled" | "current" | "available" | "error"
  currentVersion?: string
  latestVersion?: string
  feedUrl?: string
  artifactUrl?: string
  sha256?: string
  sizeBytes?: number
  reason?: string
}

export type DesktopUpdateFeedManifest = {
  productName?: string
  version?: string
  platform?: string
  artifactName?: string
  artifactUrl?: string
  sha256?: string
  sizeBytes?: number
}

export type DesktopUpdateDownloadResult = {
  status: "disabled" | "current" | "downloaded" | "error"
  currentVersion?: string
  latestVersion?: string
  artifactPath?: string
  artifactUrl?: string
  sha256?: string
  sizeBytes?: number
  reason?: string
}

export type DesktopUpdateOpenResult = {
  status: "disabled" | "opened" | "error"
  currentVersion?: string
  latestVersion?: string
  artifactPath?: string
  sha256?: string
  sizeBytes?: number
  reason?: string
}

type DesktopUpdateEnabledRelease = DesktopReleaseDiagnostics & {
  productName: "AX Code"
  packageTarget: "mac"
  version: string
  updateFeed: NonNullable<DesktopReleaseDiagnostics["updateFeed"]>
}

const DEFAULT_UPDATE_REQUEST_TIMEOUT_MS = 30_000

export async function checkDesktopUpdate(
  release: DesktopReleaseDiagnostics,
  options: {
    fetch?: typeof fetch
    platform?: string
    requestTimeoutMs?: number
  } = {},
): Promise<DesktopUpdateCheckResult> {
  if (!hasEnabledDesktopUpdates(release)) {
    return {
      status: "disabled",
      currentVersion: release.version,
      reason: desktopUpdateDisabledReason(release, "check"),
    }
  }
  const feedBaseUrl = withTrailingSlash(release.updateFeed.url)
  const feedUrl = new URL(updateFeedManifestName(release.updateFeed), feedBaseUrl).toString()
  try {
    const response = await fetchDesktopUpdateResource(options.fetch ?? fetch, feedUrl, { method: "GET" }, options)
    if (!response.ok) {
      return {
        status: "error",
        currentVersion: release.version,
        feedUrl,
        reason: `Update feed request failed (${response.status}): ${response.statusText}`,
      }
    }
    const manifest = normalizeUpdateFeedManifest(await response.json())
    const validationError = validateUpdateFeedManifest(manifest, {
      feedBaseUrl,
      platform: options.platform ?? process.platform,
    })
    if (validationError) {
      return {
        status: "error",
        currentVersion: release.version,
        latestVersion: manifest.version,
        feedUrl,
        reason: validationError,
      }
    }
    const comparison = compareVersions(manifest.version!, release.version ?? "0.0.0")
    return {
      status: comparison > 0 ? "available" : "current",
      currentVersion: release.version,
      latestVersion: manifest.version,
      feedUrl,
      artifactUrl: manifest.artifactUrl,
      sha256: manifest.sha256,
      sizeBytes: manifest.sizeBytes,
    }
  } catch (error) {
    return {
      status: "error",
      currentVersion: release.version,
      feedUrl,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function downloadDesktopUpdate(
  release: DesktopReleaseDiagnostics,
  options: {
    fetch?: typeof fetch
    platform?: string
    updateDirectory?: string
    requestTimeoutMs?: number
  } = {},
): Promise<DesktopUpdateDownloadResult> {
  const update = await checkDesktopUpdate(release, options)
  if (update.status !== "available") {
    return {
      status: update.status === "error" ? "error" : update.status,
      currentVersion: update.currentVersion,
      latestVersion: update.latestVersion,
      artifactUrl: update.artifactUrl,
      sha256: update.sha256,
      sizeBytes: update.sizeBytes,
      reason: update.reason ?? (update.status === "current" ? "No newer desktop update is available." : undefined),
    }
  }
  if (!update.artifactUrl || !update.sha256 || !update.sizeBytes) {
    return {
      status: "error",
      currentVersion: update.currentVersion,
      latestVersion: update.latestVersion,
      reason: "Update feed did not include complete artifact metadata.",
    }
  }

  try {
    const response = await fetchDesktopUpdateResource(options.fetch ?? fetch, update.artifactUrl, { method: "GET" }, options)
    if (!response.ok) {
      return {
        status: "error",
        currentVersion: update.currentVersion,
        latestVersion: update.latestVersion,
        artifactUrl: update.artifactUrl,
        reason: `Update artifact request failed (${response.status}): ${response.statusText}`,
      }
    }
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength !== update.sizeBytes) {
      return {
        status: "error",
        currentVersion: update.currentVersion,
        latestVersion: update.latestVersion,
        artifactUrl: update.artifactUrl,
        reason: `Update artifact size mismatch: expected ${update.sizeBytes}, received ${bytes.byteLength}.`,
      }
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex")
    if (sha256.toLowerCase() !== update.sha256.toLowerCase()) {
      return {
        status: "error",
        currentVersion: update.currentVersion,
        latestVersion: update.latestVersion,
        artifactUrl: update.artifactUrl,
        reason: "Update artifact SHA-256 verification failed.",
      }
    }
    const updateDirectory = options.updateDirectory ?? path.join(tmpdir(), "ax-code-desktop-updates")
    await ensureUpdateDirectory(updateDirectory)
    const artifactPath = path.join(updateDirectory, updateArtifactFileName(update.artifactUrl, update.latestVersion))
    await writeDownloadedUpdateArtifact(artifactPath, bytes)
    return {
      status: "downloaded",
      currentVersion: update.currentVersion,
      latestVersion: update.latestVersion,
      artifactPath,
      artifactUrl: update.artifactUrl,
      sha256,
      sizeBytes: bytes.byteLength,
    }
  } catch (error) {
    return {
      status: "error",
      currentVersion: update.currentVersion,
      latestVersion: update.latestVersion,
      artifactUrl: update.artifactUrl,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

async function ensureUpdateDirectory(updateDirectory: string) {
  await mkdir(updateDirectory, { recursive: true })
  await realUpdateDirectoryPath(updateDirectory)
}

async function realUpdateDirectoryPath(updateDirectory: string) {
  const info = await lstat(updateDirectory)
  if (info.isSymbolicLink()) throw new Error("Update download directory must not be a symbolic link.")
  if (!info.isDirectory()) throw new Error("Update download path is not a directory.")
  return realpath(updateDirectory)
}

async function writeDownloadedUpdateArtifact(artifactPath: string, bytes: Uint8Array) {
  const directory = path.dirname(artifactPath)
  const tempPath = path.join(directory, `.${path.basename(artifactPath)}.${randomUUID()}.tmp`)
  try {
    await writeFile(tempPath, bytes, { flag: "wx" })
    await rename(tempPath, artifactPath)
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {})
    throw error
  }
}

export async function openDownloadedDesktopUpdate(
  release: DesktopReleaseDiagnostics,
  input: { artifactPath?: string },
  options: {
    fetch?: typeof fetch
    platform?: string
    updateDirectory?: string
    requestTimeoutMs?: number
    openArtifact(path: string): Promise<void>
  },
): Promise<DesktopUpdateOpenResult> {
  if (!hasEnabledDesktopUpdates(release)) {
    return {
      status: "disabled",
      reason: desktopUpdateDisabledReason(release, "apply"),
    }
  }
  const artifactPath = input.artifactPath?.trim()
  if (!artifactPath) {
    return {
      status: "error",
      reason: "Downloaded update artifact path is required.",
    }
  }

  try {
    const updateDirectory = options.updateDirectory ?? path.join(tmpdir(), "ax-code-desktop-updates")
    const realUpdateDirectory = await realUpdateDirectoryPath(updateDirectory)
    const realArtifactPath = await realpath(artifactPath)
    if (!isPathInsideDirectory(realArtifactPath, realUpdateDirectory)) {
      return {
        status: "error",
        artifactPath,
        reason: "Downloaded update artifact must stay inside the controlled update download directory.",
      }
    }
    const artifactStats = await stat(realArtifactPath)
    if (!artifactStats.isFile()) {
      return {
        status: "error",
        artifactPath,
        reason: "Downloaded update artifact is not a file.",
      }
    }
    const update = await checkDesktopUpdate(release, {
      fetch: options.fetch,
      platform: options.platform,
      requestTimeoutMs: options.requestTimeoutMs,
    })
    if (update.status !== "available") {
      return {
        status: update.status === "error" ? "error" : "disabled",
        currentVersion: update.currentVersion,
        latestVersion: update.latestVersion,
        artifactPath,
        reason: update.reason ?? "No verified update artifact is currently available to open.",
      }
    }
    if (!update.artifactUrl || !update.sha256 || !update.sizeBytes) {
      return {
        status: "error",
        currentVersion: update.currentVersion,
        latestVersion: update.latestVersion,
        artifactPath,
        reason: "Update feed did not include complete artifact metadata.",
      }
    }
    const expectedFileName = updateArtifactFileName(update.artifactUrl, update.latestVersion)
    if (path.basename(realArtifactPath) !== expectedFileName) {
      return {
        status: "error",
        currentVersion: update.currentVersion,
        latestVersion: update.latestVersion,
        artifactPath,
        reason: "Downloaded update artifact name does not match the verified update feed.",
      }
    }
    if (artifactStats.size !== update.sizeBytes) {
      return {
        status: "error",
        currentVersion: update.currentVersion,
        latestVersion: update.latestVersion,
        artifactPath,
        reason: `Downloaded update artifact size mismatch: expected ${update.sizeBytes}, received ${artifactStats.size}.`,
      }
    }
    const sha256 = await hashFileSha256(realArtifactPath)
    if (sha256.toLowerCase() !== update.sha256.toLowerCase()) {
      return {
        status: "error",
        currentVersion: update.currentVersion,
        latestVersion: update.latestVersion,
        artifactPath,
        reason: "Downloaded update artifact SHA-256 verification failed.",
      }
    }
    await options.openArtifact(realArtifactPath)
    return {
      status: "opened",
      currentVersion: update.currentVersion,
      latestVersion: update.latestVersion,
      artifactPath: realArtifactPath,
      sha256,
      sizeBytes: artifactStats.size,
    }
  } catch (error) {
    return {
      status: "error",
      artifactPath,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

function hashFileSha256(filePath: string) {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256")
    const stream = createReadStream(filePath)
    stream.on("data", (chunk) => hash.update(chunk))
    stream.on("error", reject)
    stream.on("end", () => resolve(hash.digest("hex")))
  })
}

async function fetchDesktopUpdateResource(
  fetcher: typeof fetch,
  input: string,
  init: RequestInit,
  options: { requestTimeoutMs?: number },
) {
  const timeoutMs = updateRequestTimeoutMs(options.requestTimeoutMs)
  const timeoutMessage = `Desktop update request timed out after ${timeoutMs}ms.`
  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | undefined
  let timedOut = false
  const request = Promise.resolve(fetcher(input, { ...init, signal: controller.signal }))
  const deadline = new Promise<Response>((_resolve, reject) => {
    timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
      reject(new Error(timeoutMessage))
    }, timeoutMs)
  })
  try {
    return await Promise.race([request, deadline])
  } catch (error) {
    if (timedOut) throw new Error(timeoutMessage)
    throw error
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

function updateRequestTimeoutMs(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : DEFAULT_UPDATE_REQUEST_TIMEOUT_MS
}

function normalizeUpdateFeedManifest(value: unknown): DesktopUpdateFeedManifest {
  const record = readRecord(value)
  return {
    productName: readString(record, "productName"),
    version: readString(record, "version"),
    platform: readString(record, "platform"),
    artifactName: readString(record, "artifactName"),
    artifactUrl: readString(record, "artifactUrl"),
    sha256: readString(record, "sha256"),
    sizeBytes: readNumber(record, "sizeBytes"),
  }
}

function validateUpdateFeedManifest(
  manifest: DesktopUpdateFeedManifest,
  input: { feedBaseUrl: string; platform: string },
) {
  if (manifest.productName !== "AX Code") return "Update feed product is not AX Code."
  if (!manifest.version) return "Update feed is missing a version."
  if (manifest.platform !== input.platform)
    return `Update feed platform ${manifest.platform ?? "unknown"} does not match ${input.platform}.`
  if (!manifest.artifactUrl) return "Update feed is missing an artifact URL."
  if (!isHttpsUrl(manifest.artifactUrl)) return "Update artifact URL must use HTTPS."
  if (!isUnderFeedBase(manifest.artifactUrl, input.feedBaseUrl))
    return "Update artifact URL must stay under the configured update feed URL."
  if (!manifest.artifactName) return "Update feed is missing an artifact name."
  if (manifest.artifactName !== artifactNameFromUrl(manifest.artifactUrl)) {
    return "Update feed artifact name does not match the artifact URL."
  }
  if (!manifest.sha256 || !/^[a-f0-9]{64}$/i.test(manifest.sha256)) return "Update feed is missing a valid SHA-256."
  if (!manifest.sizeBytes || manifest.sizeBytes <= 0) return "Update feed is missing a valid artifact size."
  return undefined
}

function hasEnabledDesktopUpdates(release: DesktopReleaseDiagnostics): release is DesktopUpdateEnabledRelease {
  return hasPassedMacReleasePipeline(release)
}

function desktopUpdateDisabledReason(release: DesktopReleaseDiagnostics, action: "check" | "apply") {
  if (release.productName !== "AX Code" || release.packageTarget !== "mac" || !release.version) {
    return action === "check"
      ? "Update checks require an installed AX Code mac release manifest."
      : "Applying updates requires an installed AX Code mac release manifest."
  }
  if (!release.signed || !release.notarized || !release.updaterConfigured || !release.updateFeed) {
    return action === "check"
      ? "Update checks are disabled until signed, notarized, update-feed-backed artifacts are installed."
      : "Update apply is disabled until signed, notarized, update-feed-backed artifacts are installed."
  }
  return action === "check"
    ? "Update checks are disabled until signing, notarization, and updater gates have passed."
    : "Update apply is disabled until signing, notarization, and updater gates have passed."
}

function compareVersions(a: string, b: string) {
  const left = versionParts(a)
  const right = versionParts(b)
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

function versionParts(version: string) {
  return version
    .replace(/^v/, "")
    .split(/[.-]/)
    .map((part) => Number(part))
    .filter((part) => Number.isFinite(part))
}

function isHttpsUrl(value: string) {
  try {
    return new URL(value).protocol === "https:"
  } catch {
    return false
  }
}

function isUnderFeedBase(artifactUrl: string, feedBaseUrl: string) {
  try {
    const artifact = new URL(artifactUrl)
    const feedBase = new URL(withTrailingSlash(feedBaseUrl))
    return artifact.origin === feedBase.origin && artifact.pathname.startsWith(feedBase.pathname)
  } catch {
    return false
  }
}

function artifactNameFromUrl(artifactUrl: string) {
  try {
    const name = path.basename(new URL(artifactUrl).pathname)
    return name ? decodeURIComponent(name) : undefined
  } catch {
    return undefined
  }
}

function isPathInsideDirectory(targetPath: string, directory: string) {
  const relative = path.relative(directory, targetPath)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

function updateArtifactFileName(artifactUrl: string, latestVersion: string | undefined) {
  const name = (path.basename(new URL(artifactUrl).pathname) || "AX-Code.app.zip").replace(/[^A-Za-z0-9._%-]/g, "-")
  const version = latestVersion?.replace(/[^A-Za-z0-9._-]/g, "-")
  return version ? `${version}-${name}` : name
}

function updateFeedManifestName(updateFeed: NonNullable<DesktopReleaseDiagnostics["updateFeed"]>) {
  const configuredName = updateFeed.manifestName || (updateFeed.manifestPath ? path.basename(updateFeed.manifestPath) : "")
  const name = path.basename(configuredName).replace(/[^A-Za-z0-9._-]/g, "-")
  return name || "ax-code-update.json"
}

function withTrailingSlash(url: string) {
  return url.endsWith("/") ? url : `${url}/`
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

function readString(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === "string" ? value : undefined
}

function readNumber(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}
