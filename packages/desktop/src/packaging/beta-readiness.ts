import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { parseArgs } from "node:util"
import { desktopPackagingRepoRoot, resolveDesktopPackagingCliPath } from "./paths"
import {
  MAC_RELEASE_MANIFEST_NAME,
  hasPassedMacReleasePipeline,
  readDesktopReleaseDiagnostics,
  type DesktopReleaseDiagnostics,
} from "./release-diagnostics"

export type DesktopBetaReadinessCheck = {
  status: "passed" | "failed" | "warning"
  reason?: string
}

export type DesktopBetaReadinessReport = {
  ready: boolean
  release: DesktopReleaseDiagnostics
  checks: {
    releaseManifest: DesktopBetaReadinessCheck
    releasePipeline: DesktopBetaReadinessCheck
    liveSidecarQa: DesktopBetaReadinessCheck
    liveAttachQa: DesktopBetaReadinessCheck
  }
}

export type DesktopBetaReadinessOptions = {
  resourcesPath?: string
  macBundlePath?: string
  repoRoot?: string
  qaLiveSidecarPath?: string
  qaLiveAttachPath?: string
  requireLiveQa?: boolean
  requireRepresentativeLiveQa?: boolean
  requireReleasePipeline?: boolean
  updateManifestPath?: string
  releaseArchivePath?: string
}

type LiveBackendQaEvidence = {
  mode?: unknown
  startedSidecar?: unknown
  withinBudget?: unknown
  diagnostics?: {
    connected?: unknown
    streamObserved?: unknown
    withinRendererWindows?: unknown
  }
  eventStream?: {
    attempts?: unknown
    appliedEvents?: unknown
  }
  representative?: {
    required?: unknown
    passed?: unknown
    checks?: unknown
  }
}

export function createDesktopBetaReadinessReport(
  options: DesktopBetaReadinessOptions = {},
): DesktopBetaReadinessReport {
  const release = readDesktopReleaseDiagnostics({ resourcesPath: resolveDesktopBetaReadinessResourcesPath(options) })
  const checks = {
    releaseManifest: checkReleaseManifest(release),
    releasePipeline: checkReleasePipeline(release, options.requireReleasePipeline === true, {
      updateManifestPath: resolveDesktopPackagingCliPath(options.updateManifestPath),
      releaseArchivePath: resolveDesktopPackagingCliPath(options.releaseArchivePath),
    }),
    liveSidecarQa: checkLiveBackendQaEvidence(options.qaLiveSidecarPath, {
      required: options.requireLiveQa === true,
      expectedMode: "start",
      expectedStartedSidecar: true,
      requireRepresentative: options.requireRepresentativeLiveQa === true,
    }),
    liveAttachQa: checkLiveBackendQaEvidence(options.qaLiveAttachPath, {
      required: options.requireLiveQa === true,
      expectedMode: "attach",
      expectedStartedSidecar: false,
      requireRepresentative: options.requireRepresentativeLiveQa === true,
    }),
  }
  const ready = Object.values(checks).every((check) => check.status !== "failed")
  return { ready, release, checks }
}

export function writeDesktopBetaReadinessReport(report: DesktopBetaReadinessReport, outputPath: string) {
  mkdirSync(path.dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`)
}

export function resolveDesktopBetaReadinessResourcesPath(options: DesktopBetaReadinessOptions = {}) {
  const repoRoot = options.repoRoot ?? desktopPackagingRepoRoot()
  const explicitResourcesPath = resolveDesktopPackagingCliPath(options.resourcesPath, repoRoot)
  if (explicitResourcesPath) return explicitResourcesPath

  const macBundlePath =
    resolveDesktopPackagingCliPath(options.macBundlePath, repoRoot) ??
    path.join(repoRoot, "packages/desktop/dist/mac/AX Code.app")
  const resourcesPath = path.join(macBundlePath, "Contents/Resources")
  if (
    options.macBundlePath ||
    existsSync(resourcesPath) ||
    existsSync(path.join(resourcesPath, MAC_RELEASE_MANIFEST_NAME))
  ) {
    return resourcesPath
  }
  return undefined
}

function checkReleaseManifest(release: DesktopReleaseDiagnostics): DesktopBetaReadinessCheck {
  if (release.status !== "manifest-found") {
    return {
      status: "failed",
      reason: release.error ?? "Desktop release manifest is missing or invalid.",
    }
  }
  if (release.productName !== "AX Code" || release.packageTarget !== "mac") {
    return {
      status: "failed",
      reason: "Desktop release manifest does not describe the AX Code macOS package.",
    }
  }
  return { status: "passed" }
}

function checkReleasePipeline(
  release: DesktopReleaseDiagnostics,
  requireReleasePipeline: boolean,
  evidence: { updateManifestPath?: string; releaseArchivePath?: string },
): DesktopBetaReadinessCheck {
  if (hasPassedMacReleasePipeline(release)) {
    if (!requireReleasePipeline) return { status: "passed" }
    const evidenceError = validatePublicReleaseArtifactEvidence(release, evidence)
    return evidenceError
      ? { status: "failed", reason: `Release pipeline artifact evidence is invalid: ${evidenceError}` }
      : { status: "passed" }
  }
  const gatesClosed = !release.signed && !release.notarized && !release.updaterConfigured
  if (!requireReleasePipeline) {
    return gatesClosed
      ? {
          status: "warning",
          reason: "Signing, notarization, and updater gates are closed; acceptable for internal maintainer beta only.",
        }
      : {
          status: "failed",
          reason:
            "Release pipeline gate metadata is inconsistent; close all gates for internal beta or pass the full public release pipeline.",
        }
  }
  return {
    status: "failed",
    reason: "Release pipeline requires signed, notarized, update-feed-backed artifacts.",
  }
}

function validatePublicReleaseArtifactEvidence(
  release: DesktopReleaseDiagnostics,
  evidence: { updateManifestPath?: string; releaseArchivePath?: string },
) {
  const updateFeed = release.updateFeed
  if (!updateFeed) return "update feed metadata is missing"
  if (!updateFeed.manifestName) return "update feed manifest name is missing"
  const manifestPath = evidence.updateManifestPath ?? updateFeed.manifestPath
  const artifactPath = evidence.releaseArchivePath ?? updateFeed.artifactPath
  if (!manifestPath) return "update feed manifest path evidence is missing"
  if (!artifactPath) return "release archive path evidence is missing"
  if (path.basename(manifestPath) !== updateFeed.manifestName) {
    return `update feed manifest path does not match installed manifest locator: expected ${updateFeed.manifestName}, got ${path.basename(manifestPath)}`
  }
  if (!existsSync(manifestPath)) return `update feed manifest is missing: ${manifestPath}`
  if (!existsSync(artifactPath)) return `release archive is missing: ${artifactPath}`

  let feedRecord: Record<string, unknown>
  try {
    feedRecord = readRecord(JSON.parse(readFileSync(manifestPath, "utf8")) as unknown)
  } catch (error) {
    return `update feed manifest is invalid JSON: ${error instanceof Error ? error.message : String(error)}`
  }
  const feedArtifactName = readString(feedRecord, "artifactName")
  const feedArtifactUrl = readString(feedRecord, "artifactUrl")
  const feedSha256 = readString(feedRecord, "sha256")
  const feedSizeBytes = readNumber(feedRecord, "sizeBytes")
  if (!feedArtifactName) return "update feed manifest is missing artifactName"
  if (!feedArtifactUrl) return "update feed manifest is missing artifactUrl"
  if (!feedSha256 || !/^[a-f0-9]{64}$/i.test(feedSha256)) return "update feed manifest is missing a valid SHA-256"
  if (!feedSizeBytes || feedSizeBytes <= 0) return "update feed manifest is missing a valid artifact size"
  if (path.basename(artifactPath) !== feedArtifactName) {
    return `release archive path does not match update feed artifact: expected ${feedArtifactName}, got ${path.basename(artifactPath)}`
  }
  if (!artifactUrlStaysUnderFeed(feedArtifactUrl, updateFeed.url)) {
    return "release artifact URL is outside the configured update feed"
  }
  if (!artifactUrlMatchesName(feedArtifactUrl, feedArtifactName)) {
    return "release artifact URL does not match the artifact name"
  }

  const artifactSize = statSync(artifactPath).size
  if (artifactSize !== feedSizeBytes) {
    return `release archive size mismatch: expected ${feedSizeBytes}, got ${artifactSize}`
  }
  const artifactSha256 = createHash("sha256").update(readFileSync(artifactPath)).digest("hex")
  if (artifactSha256 !== feedSha256) {
    return `release archive sha256 mismatch: expected ${feedSha256}, got ${artifactSha256}`
  }

  const mismatches = [
    feedRecord.productName === "AX Code" ? undefined : "productName",
    feedRecord.version === release.version ? undefined : "version",
    feedRecord.platform === "darwin" ? undefined : "platform",
    feedRecord.manifestName === updateFeed.manifestName ? undefined : "manifestName",
    updateFeed.artifactName && feedRecord.artifactName !== updateFeed.artifactName ? "artifactName" : undefined,
    updateFeed.artifactUrl && feedRecord.artifactUrl !== updateFeed.artifactUrl ? "artifactUrl" : undefined,
    updateFeed.sha256 && feedRecord.sha256 !== updateFeed.sha256 ? "sha256" : undefined,
    updateFeed.sizeBytes !== undefined && feedRecord.sizeBytes !== updateFeed.sizeBytes ? "sizeBytes" : undefined,
  ].filter((item): item is string => Boolean(item))
  return mismatches.length > 0 ? `update feed manifest mismatch: ${mismatches.join(", ")}` : undefined
}

function artifactUrlStaysUnderFeed(artifactUrl: string | undefined, feedUrl: string | undefined) {
  if (!artifactUrl || !feedUrl) return false
  try {
    return new URL(artifactUrl).toString().startsWith(withTrailingSlash(new URL(feedUrl).toString()))
  } catch {
    return false
  }
}

function artifactUrlMatchesName(artifactUrl: string | undefined, artifactName: string | undefined) {
  if (!artifactUrl || !artifactName) return false
  try {
    return decodeURIComponent(path.basename(new URL(artifactUrl).pathname)) === artifactName
  } catch {
    return false
  }
}

function withTrailingSlash(value: string) {
  return value.endsWith("/") ? value : `${value}/`
}

function checkLiveBackendQaEvidence(
  file: string | undefined,
  options: {
    required: boolean
    expectedMode: "start" | "attach"
    expectedStartedSidecar: boolean
    requireRepresentative: boolean
  },
): DesktopBetaReadinessCheck {
  if (!file) {
    return options.required
      ? { status: "failed", reason: `Missing qa:live ${options.expectedMode} evidence file.` }
      : { status: "warning", reason: `qa:live ${options.expectedMode} evidence file was not provided.` }
  }
  if (!existsSync(file)) return { status: "failed", reason: `qa:live evidence file is missing: ${file}` }

  let evidence: LiveBackendQaEvidence
  try {
    evidence = JSON.parse(readFileSync(file, "utf8")) as LiveBackendQaEvidence
  } catch (error) {
    return {
      status: "failed",
      reason: `qa:live evidence is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  if (evidence.mode !== options.expectedMode) {
    return { status: "failed", reason: `Expected qa:live mode ${options.expectedMode}.` }
  }
  if (evidence.startedSidecar !== options.expectedStartedSidecar) {
    return { status: "failed", reason: `qa:live ${options.expectedMode} sidecar ownership did not match.` }
  }
  if (evidence.withinBudget !== true) return { status: "failed", reason: "qa:live did not finish within budget." }
  if (evidence.diagnostics?.connected !== true) return { status: "failed", reason: "qa:live did not connect." }
  if (evidence.diagnostics?.streamObserved !== true) {
    return { status: "failed", reason: "qa:live did not observe the event stream." }
  }
  if (evidence.diagnostics?.withinRendererWindows !== true) {
    return { status: "failed", reason: "qa:live renderer windows were not bounded." }
  }
  if (!isPositiveNumber(evidence.eventStream?.attempts)) {
    return { status: "failed", reason: "qa:live did not record event-stream attempts." }
  }
  if (!isPositiveNumber(evidence.eventStream?.appliedEvents)) {
    return { status: "failed", reason: "qa:live did not apply backend events." }
  }
  if (options.requireRepresentative) {
    if (evidence.representative?.required !== true) {
      return { status: "failed", reason: "qa:live did not run with representative coverage requirements." }
    }
    if (evidence.representative?.passed !== true) {
      return {
        status: "failed",
        reason: `qa:live representative coverage failed: ${representativeFailureSummary(evidence.representative.checks)}`,
      }
    }
  }
  return { status: "passed" }
}

function isPositiveNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
}

function representativeFailureSummary(value: unknown) {
  const checks = value && typeof value === "object" ? (value as Record<string, unknown>) : {}
  const failed = Object.entries(checks)
    .map(([name, raw]) => {
      const check = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
      return check.passed === false
        ? `${name} actual=${String(check.actual ?? "unknown")} minimum=${String(check.minimum ?? "unknown")}`
        : undefined
    })
    .filter((item): item is string => Boolean(item))
  return failed.length > 0 ? failed.join("; ") : "representative checks did not pass"
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

if (import.meta.main) {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      "resources-path": { type: "string" },
      "mac-bundle-path": { type: "string" },
      "qa-live-sidecar": { type: "string" },
      "qa-live-attach": { type: "string" },
      "require-live-qa": { type: "boolean", default: false },
      "require-representative-live-qa": { type: "boolean", default: false },
      "require-release-pipeline": { type: "boolean", default: false },
      "update-manifest-path": { type: "string" },
      "release-archive-path": { type: "string" },
      output: { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  })
  const macBundlePath = resolveDesktopPackagingCliPath(values["mac-bundle-path"])
  const report = createDesktopBetaReadinessReport({
    resourcesPath: resolveDesktopPackagingCliPath(values["resources-path"]),
    macBundlePath,
    qaLiveSidecarPath: resolveDesktopPackagingCliPath(values["qa-live-sidecar"]),
    qaLiveAttachPath: resolveDesktopPackagingCliPath(values["qa-live-attach"]),
    requireLiveQa: values["require-live-qa"],
    requireRepresentativeLiveQa: values["require-representative-live-qa"],
    requireReleasePipeline: values["require-release-pipeline"],
    updateManifestPath: values["update-manifest-path"],
    releaseArchivePath: values["release-archive-path"],
  })
  const json = JSON.stringify(report, null, 2)
  if (values.output) writeDesktopBetaReadinessReport(report, values.output)
  console.log(json)
  if (!report.ready) process.exitCode = 1
}
