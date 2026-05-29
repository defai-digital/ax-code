import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

export const MAC_RELEASE_MANIFEST_NAME = "ax-code-release.json"

export type MacReleaseGate = {
  configured: false
  status: "blocked"
  reason: string
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
  signed: false
  notarized: false
  updaterConfigured: false
  gates: {
    signing: MacReleaseGate
    notarization: MacReleaseGate
    updater: MacReleaseGate
  }
}

export type DesktopReleaseDiagnostics = {
  status: "manifest-found" | "manifest-missing" | "manifest-invalid"
  updatePolicy: "disabled-until-release-pipeline"
  manifestPath?: string
  productName?: string
  version?: string
  packageTarget?: string
  signed: boolean
  notarized: boolean
  updaterConfigured: boolean
  gates: Record<string, { configured: boolean; status: string; reason?: string }>
  error?: string
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
  return {
    status: "manifest-found",
    updatePolicy: "disabled-until-release-pipeline",
    manifestPath,
    productName: readString(record, "productName"),
    version: readString(record, "version"),
    packageTarget: readString(record, "packageTarget"),
    signed: readBoolean(record, "signed") === true,
    notarized: readBoolean(record, "notarized") === true,
    updaterConfigured: readBoolean(record, "updaterConfigured") === true,
    gates: {
      signing: normalizeGate(gates["signing"]),
      notarization: normalizeGate(gates["notarization"]),
      updater: normalizeGate(gates["updater"]),
    },
  }
}

function normalizeGate(value: unknown) {
  const record = readRecord(value)
  return {
    configured: readBoolean(record, "configured") === true,
    status: readString(record, "status") ?? "unknown",
    reason: readString(record, "reason"),
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
