import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

export const MAC_RELEASE_MANIFEST_NAME = "ax-code-release.json"

export type MacReleaseGate = {
  configured: boolean
  status: "blocked" | "passed"
  reason?: string
  evidence?: string
}

export type MacReleaseUpdateFeed = {
  url: string
  manifestName?: string
  manifestPath?: string
  artifactPath?: string
  artifactName?: string
  artifactUrl?: string
  sha256?: string
  sizeBytes?: number
}

export type MacReleaseManifest = {
  productName: "AX Code"
  version: string
  packageTarget: "mac"
  appPath: string
  resourcesAppPath: string
  mainPath: string
  preloadPath: string
  rendererIndexPath: string
  electronVersion: string
  signed: boolean
  notarized: boolean
  updaterConfigured: boolean
  updateFeed?: MacReleaseUpdateFeed
  gates: {
    signing: MacReleaseGate
    notarization: MacReleaseGate
    updater: MacReleaseGate
  }
}

export type DesktopReleaseDiagnostics = {
  status: "manifest-found" | "manifest-missing" | "manifest-invalid"
  updatePolicy: "disabled-until-release-pipeline" | "feed-configured"
  manifestPath?: string
  productName?: string
  version?: string
  packageTarget?: string
  updateFeed?: MacReleaseUpdateFeed
  signed: boolean
  notarized: boolean
  updaterConfigured: boolean
  gates: Record<string, { configured: boolean; status: string; reason?: string; evidence?: string }>
  error?: string
}

export type DesktopReleaseWithPassedPipeline = DesktopReleaseDiagnostics & {
  productName: "AX Code"
  version: string
  packageTarget: "mac"
  updateFeed: MacReleaseUpdateFeed
}

export function readDesktopReleaseDiagnostics(input: { resourcesPath?: string } = {}): DesktopReleaseDiagnostics {
  const manifestPath = resolveReleaseManifestPath(input.resourcesPath)
  if (!manifestPath || !existsSync(manifestPath)) {
    return {
      status: "manifest-missing",
      updatePolicy: "disabled-until-release-pipeline",
      manifestPath,
      signed: false,
      notarized: false,
      updaterConfigured: false,
      gates: {},
    }
  }

  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown
    return normalizeReleaseManifest(manifest, manifestPath)
  } catch (error) {
    return {
      status: "manifest-invalid",
      updatePolicy: "disabled-until-release-pipeline",
      manifestPath,
      signed: false,
      notarized: false,
      updaterConfigured: false,
      gates: {},
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function normalizeReleaseManifest(manifest: unknown, manifestPath: string): DesktopReleaseDiagnostics {
  const record = readRecord(manifest)
  const gates = readRecord(record["gates"])
  const updateFeed = normalizeUpdateFeed(record["updateFeed"])
  const signed = readBoolean(record, "signed") === true
  const notarized = readBoolean(record, "notarized") === true
  const updaterConfigured = readBoolean(record, "updaterConfigured") === true
  const normalizedGates = {
    signing: normalizeGate(gates["signing"]),
    notarization: normalizeGate(gates["notarization"]),
    updater: normalizeGate(gates["updater"]),
  }
  const diagnostics: DesktopReleaseDiagnostics = {
    status: "manifest-found",
    updatePolicy: "disabled-until-release-pipeline",
    manifestPath,
    productName: readString(record, "productName"),
    version: readString(record, "version"),
    packageTarget: readString(record, "packageTarget"),
    updateFeed,
    signed,
    notarized,
    updaterConfigured,
    gates: normalizedGates,
  }
  return {
    ...diagnostics,
    updatePolicy: hasPassedMacReleasePipeline(diagnostics) ? "feed-configured" : "disabled-until-release-pipeline",
  }
}

export function hasPassedMacReleasePipeline(
  release: DesktopReleaseDiagnostics,
): release is DesktopReleaseWithPassedPipeline {
  return (
    release.productName === "AX Code" &&
    release.packageTarget === "mac" &&
    Boolean(release.version) &&
    release.signed &&
    release.notarized &&
    release.updaterConfigured &&
    hasConfiguredUpdateFeed(release.updateFeed) &&
    hasPassedReleaseGate(release, "signing") &&
    hasPassedReleaseGate(release, "notarization") &&
    hasPassedReleaseGate(release, "updater")
  )
}

function hasPassedReleaseGate(release: DesktopReleaseDiagnostics, name: "signing" | "notarization" | "updater") {
  const gate = release.gates[name]
  return gate?.configured === true && gate.status === "passed"
}

function hasConfiguredUpdateFeed(updateFeed: MacReleaseUpdateFeed | undefined) {
  if (!updateFeed) return false
  return isHttpsUrl(updateFeed.url) && Boolean(updateFeed.manifestName)
}

function isHttpsUrl(value: string | undefined) {
  if (!value) return false
  try {
    return new URL(value).protocol === "https:"
  } catch {
    return false
  }
}

function normalizeGate(value: unknown) {
  const record = readRecord(value)
  return {
    configured: readBoolean(record, "configured") === true,
    status: readString(record, "status") ?? "unknown",
    reason: readString(record, "reason"),
    evidence: readString(record, "evidence"),
  }
}

function normalizeUpdateFeed(value: unknown): MacReleaseUpdateFeed | undefined {
  const record = readRecord(value)
  const url = readString(record, "url")
  const manifestName = readString(record, "manifestName")
  const manifestPath = readString(record, "manifestPath")
  const artifactPath = readString(record, "artifactPath")
  const artifactName = readString(record, "artifactName")
  const artifactUrl = readString(record, "artifactUrl")
  const sha256 = readString(record, "sha256")
  const sizeBytes = readNumber(record, "sizeBytes")
  if (!url) return undefined
  return {
    url,
    ...(manifestName ? { manifestName } : {}),
    ...(manifestPath ? { manifestPath } : {}),
    ...(artifactPath ? { artifactPath } : {}),
    ...(artifactName ? { artifactName } : {}),
    ...(artifactUrl ? { artifactUrl } : {}),
    ...(sha256 ? { sha256 } : {}),
    ...(sizeBytes === undefined ? {} : { sizeBytes }),
  }
}

function resolveReleaseManifestPath(resourcesPath: string | undefined) {
  const explicit = resourcesPath || readProcessResourcesPath()
  return explicit ? path.join(explicit, MAC_RELEASE_MANIFEST_NAME) : undefined
}

function readProcessResourcesPath() {
  const resourcesPath = (process as { resourcesPath?: unknown }).resourcesPath
  return typeof resourcesPath === "string" ? resourcesPath : undefined
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

function readString(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === "string" ? value : undefined
}

function readBoolean(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === "boolean" ? value : undefined
}

function readNumber(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}
