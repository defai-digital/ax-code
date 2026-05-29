import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import { createDesktopBetaReadinessReport, writeDesktopBetaReadinessReport } from "../src/packaging/beta-readiness"
import { MAC_RELEASE_MANIFEST_NAME } from "../src/packaging/release-diagnostics"

describe("desktop beta readiness", () => {
  test("passes internal beta readiness with closed release gates and live QA evidence", () => {
    const root = path.join(tmpdir(), `ax-code-beta-ready-${Date.now()}`)
    const resourcesPath = path.join(root, "Resources")
    mkdirSync(resourcesPath, { recursive: true })
    writeReleaseManifest(resourcesPath, {
      signed: false,
      notarized: false,
      updaterConfigured: false,
    })
    const sidecarPath = path.join(root, "qa-live-sidecar.json")
    const attachPath = path.join(root, "qa-live-attach.json")
    writeLiveQaEvidence(sidecarPath, { mode: "start", startedSidecar: true })
    writeLiveQaEvidence(attachPath, { mode: "attach", startedSidecar: false })

    const report = createDesktopBetaReadinessReport({
      resourcesPath,
      qaLiveSidecarPath: sidecarPath,
      qaLiveAttachPath: attachPath,
      requireLiveQa: true,
    })

    expect(report.ready).toBe(true)
    expect(report.checks.releaseManifest.status).toBe("passed")
    expect(report.checks.releasePipeline).toMatchObject({ status: "warning" })
    expect(report.checks.liveSidecarQa.status).toBe("passed")
    expect(report.checks.liveAttachQa.status).toBe("passed")
  })

  test("fails when required live QA evidence is missing", () => {
    const resourcesPath = path.join(tmpdir(), `ax-code-beta-missing-qa-${Date.now()}`)
    mkdirSync(resourcesPath, { recursive: true })
    writeReleaseManifest(resourcesPath, {
      signed: false,
      notarized: false,
      updaterConfigured: false,
    })

    const report = createDesktopBetaReadinessReport({
      resourcesPath,
      requireLiveQa: true,
    })

    expect(report.ready).toBe(false)
    expect(report.checks.liveSidecarQa).toMatchObject({ status: "failed" })
    expect(report.checks.liveAttachQa).toMatchObject({ status: "failed" })
  })

  test("finds the default package:mac bundle manifest from the repo root", () => {
    const repoRoot = path.join(tmpdir(), `ax-code-beta-default-bundle-${Date.now()}`)
    const resourcesPath = path.join(repoRoot, "packages/desktop/dist/mac/AX Code.app/Contents/Resources")
    mkdirSync(resourcesPath, { recursive: true })
    writeReleaseManifest(resourcesPath, {
      signed: false,
      notarized: false,
      updaterConfigured: false,
    })

    const report = createDesktopBetaReadinessReport({ repoRoot })

    expect(report.ready).toBe(true)
    expect(report.release.manifestPath).toBe(path.join(resourcesPath, MAC_RELEASE_MANIFEST_NAME))
    expect(report.checks.releaseManifest.status).toBe("passed")
  })

  test("fails public release readiness when signing, notarization, or updater gates are closed", () => {
    const resourcesPath = path.join(tmpdir(), `ax-code-release-not-ready-${Date.now()}`)
    mkdirSync(resourcesPath, { recursive: true })
    writeReleaseManifest(resourcesPath, {
      signed: false,
      notarized: false,
      updaterConfigured: false,
    })

    const report = createDesktopBetaReadinessReport({
      resourcesPath,
      requireReleasePipeline: true,
    })

    expect(report.ready).toBe(false)
    expect(report.checks.releasePipeline).toMatchObject({
      status: "failed",
      reason: "Release pipeline requires signed, notarized, update-feed-backed artifacts.",
    })
  })

  test("fails public release readiness when gate statuses contradict enabled flags", () => {
    const root = path.join(tmpdir(), `ax-code-release-inconsistent-${Date.now()}`)
    const resourcesPath = path.join(root, "Resources")
    mkdirSync(resourcesPath, { recursive: true })
    writeReleaseManifest(resourcesPath, {
      signed: true,
      notarized: true,
      updaterConfigured: true,
      updateFeed: {
        url: "https://updates.example.test/ax-code/",
        manifestName: "ax-code-update.json",
        manifestPath: path.join(root, "ax-code-update.json"),
        artifactPath: path.join(root, "AX Code.app.zip"),
        artifactName: "AX Code.app.zip",
        artifactUrl: "https://updates.example.test/ax-code/AX%20Code.app.zip",
        sha256: "a".repeat(64),
        sizeBytes: 123,
      },
      gates: {
        signing: { configured: true, status: "passed" },
        notarization: { configured: true, status: "blocked", reason: "notary failed" },
        updater: { configured: true, status: "passed" },
      },
    })

    const report = createDesktopBetaReadinessReport({
      resourcesPath,
      requireReleasePipeline: true,
    })

    expect(report.ready).toBe(false)
    expect(report.release.updatePolicy).toBe("disabled-until-release-pipeline")
    expect(report.checks.releasePipeline).toMatchObject({
      status: "failed",
      reason: "Release pipeline requires signed, notarized, update-feed-backed artifacts.",
    })
  })

  test("passes public release readiness when signed, notarized, and update-feed-backed", () => {
    const root = path.join(tmpdir(), `ax-code-release-ready-${Date.now()}`)
    const resourcesPath = path.join(root, "Resources")
    mkdirSync(resourcesPath, { recursive: true })
    const updateFeed = writeUpdateFeedEvidence(root)
    writeReleaseManifest(resourcesPath, {
      signed: true,
      notarized: true,
      updaterConfigured: true,
      updateFeed,
    })

    const report = createDesktopBetaReadinessReport({
      resourcesPath,
      requireReleasePipeline: true,
    })

    expect(report.ready).toBe(true)
    expect(report.checks.releasePipeline).toMatchObject({ status: "passed" })
  })

  test("passes public release readiness with a signed installed update feed locator plus external artifact evidence", () => {
    const root = path.join(tmpdir(), `ax-code-release-locator-ready-${Date.now()}`)
    const resourcesPath = path.join(root, "Resources")
    mkdirSync(resourcesPath, { recursive: true })
    const evidence = writeUpdateFeedEvidence(root)
    writeReleaseManifest(resourcesPath, {
      signed: true,
      notarized: true,
      updaterConfigured: true,
      updateFeed: {
        url: "https://updates.example.test/ax-code/",
        manifestName: "ax-code-update.json",
      },
    })

    const report = createDesktopBetaReadinessReport({
      resourcesPath,
      requireReleasePipeline: true,
      updateManifestPath: evidence.manifestPath,
      releaseArchivePath: evidence.artifactPath,
    })

    expect(report.ready).toBe(true)
    expect(report.release.updatePolicy).toBe("feed-configured")
    expect(report.checks.releasePipeline).toMatchObject({ status: "passed" })
  })

  test("fails public release readiness when external artifact evidence is not supplied", () => {
    const root = path.join(tmpdir(), `ax-code-release-locator-missing-evidence-${Date.now()}`)
    const resourcesPath = path.join(root, "Resources")
    mkdirSync(resourcesPath, { recursive: true })
    writeReleaseManifest(resourcesPath, {
      signed: true,
      notarized: true,
      updaterConfigured: true,
      updateFeed: {
        url: "https://updates.example.test/ax-code/",
        manifestName: "ax-code-update.json",
      },
    })

    const report = createDesktopBetaReadinessReport({
      resourcesPath,
      requireReleasePipeline: true,
    })

    expect(report.ready).toBe(false)
    expect(report.release.updatePolicy).toBe("feed-configured")
    expect(report.checks.releasePipeline.reason ?? "").toContain("update feed manifest path evidence is missing")
  })

  test("fails public release readiness when update-feed manifest locator is missing", () => {
    const root = path.join(tmpdir(), `ax-code-release-incomplete-feed-${Date.now()}`)
    const resourcesPath = path.join(root, "Resources")
    mkdirSync(resourcesPath, { recursive: true })
    writeReleaseManifest(resourcesPath, {
      signed: true,
      notarized: true,
      updaterConfigured: true,
      updateFeed: {
        url: "https://updates.example.test/ax-code/",
        artifactName: "AX Code.app.zip",
        sha256: "a".repeat(64),
        sizeBytes: 123,
      },
    })

    const report = createDesktopBetaReadinessReport({
      resourcesPath,
      requireReleasePipeline: true,
    })

    expect(report.ready).toBe(false)
    expect(report.release.updatePolicy).toBe("disabled-until-release-pipeline")
    expect(report.checks.releasePipeline).toMatchObject({
      status: "failed",
      reason: "Release pipeline requires signed, notarized, update-feed-backed artifacts.",
    })
  })

  test("fails public release readiness when archive hash does not match update-feed evidence", () => {
    const root = path.join(tmpdir(), `ax-code-release-bad-archive-${Date.now()}`)
    const resourcesPath = path.join(root, "Resources")
    mkdirSync(resourcesPath, { recursive: true })
    const updateFeed = writeUpdateFeedEvidence(root)
    writeFileSync(updateFeed.artifactPath, "tampered archive")
    writeReleaseManifest(resourcesPath, {
      signed: true,
      notarized: true,
      updaterConfigured: true,
      updateFeed: {
        url: updateFeed.url,
        manifestName: updateFeed.manifestName,
      },
    })

    const report = createDesktopBetaReadinessReport({
      resourcesPath,
      requireReleasePipeline: true,
      updateManifestPath: updateFeed.manifestPath,
      releaseArchivePath: updateFeed.artifactPath,
    })

    expect(report.ready).toBe(false)
    expect(report.checks.releasePipeline.status).toBe("failed")
    expect(report.checks.releasePipeline.reason ?? "").toContain("release archive size mismatch")
  })

  test("fails public release readiness when update artifact URL is outside the feed", () => {
    const root = path.join(tmpdir(), `ax-code-release-bad-feed-url-${Date.now()}`)
    const resourcesPath = path.join(root, "Resources")
    mkdirSync(resourcesPath, { recursive: true })
    const updateFeed = writeUpdateFeedEvidence(root, {
      artifactUrl: "https://updates.example.test/other/AX%20Code.app.zip",
    })
    writeReleaseManifest(resourcesPath, {
      signed: true,
      notarized: true,
      updaterConfigured: true,
      updateFeed: {
        url: updateFeed.url,
        manifestName: updateFeed.manifestName,
      },
    })

    const report = createDesktopBetaReadinessReport({
      resourcesPath,
      requireReleasePipeline: true,
      updateManifestPath: updateFeed.manifestPath,
      releaseArchivePath: updateFeed.artifactPath,
    })

    expect(report.ready).toBe(false)
    expect(report.checks.releasePipeline.status).toBe("failed")
    expect(report.checks.releasePipeline.reason ?? "").toContain("release artifact URL is outside the configured update feed")
  })

  test("writes a machine-readable readiness report artifact", () => {
    const root = path.join(tmpdir(), `ax-code-beta-readiness-output-${Date.now()}`)
    const resourcesPath = path.join(root, "Resources")
    const outputPath = path.join(root, "release-readiness.json")
    mkdirSync(resourcesPath, { recursive: true })
    const updateFeed = writeUpdateFeedEvidence(root, { artifactBytes: "alternate release archive" })
    writeReleaseManifest(resourcesPath, {
      signed: true,
      notarized: true,
      updaterConfigured: true,
      updateFeed: {
        url: updateFeed.url,
        manifestName: updateFeed.manifestName,
      },
    })

    const report = createDesktopBetaReadinessReport({
      resourcesPath,
      requireReleasePipeline: true,
      updateManifestPath: updateFeed.manifestPath,
      releaseArchivePath: updateFeed.artifactPath,
    })
    writeDesktopBetaReadinessReport(report, outputPath)

    expect(JSON.parse(readFileSync(outputPath, "utf8"))).toMatchObject({
      ready: true,
      checks: {
        releaseManifest: { status: "passed" },
        releasePipeline: { status: "passed" },
      },
    })
  })
})

function writeReleaseManifest(
  resourcesPath: string,
  input: {
    signed: boolean
    notarized: boolean
    updaterConfigured: boolean
    updateFeed?: Record<string, unknown>
    gates?: Record<string, unknown>
  },
) {
  writeFileSync(
    path.join(resourcesPath, MAC_RELEASE_MANIFEST_NAME),
    JSON.stringify({
      productName: "AX Code",
      version: "9.8.7",
      packageTarget: "mac",
      signed: input.signed,
      notarized: input.notarized,
      updaterConfigured: input.updaterConfigured,
      updateFeed: input.updateFeed,
      gates: input.gates ?? {
        signing: { configured: input.signed, status: input.signed ? "passed" : "blocked" },
        notarization: { configured: input.notarized, status: input.notarized ? "passed" : "blocked" },
        updater: { configured: input.updaterConfigured, status: input.updaterConfigured ? "passed" : "blocked" },
      },
    }),
  )
}

function writeUpdateFeedEvidence(root: string, options: { artifactBytes?: string; artifactUrl?: string } = {}) {
  const manifestName = "ax-code-update.json"
  const artifactName = "AX Code.app.zip"
  const manifestPath = path.join(root, manifestName)
  const artifactPath = path.join(root, artifactName)
  const artifactUrl = options.artifactUrl ?? "https://updates.example.test/ax-code/AX%20Code.app.zip"
  const artifactBytes = options.artifactBytes ?? "release archive"
  writeFileSync(artifactPath, artifactBytes)
  const sha256 = createHash("sha256").update(readFileSync(artifactPath)).digest("hex")
  const sizeBytes = readFileSync(artifactPath).byteLength
  const updateFeed = {
    url: "https://updates.example.test/ax-code/",
    manifestName,
    manifestPath,
    artifactPath,
    artifactName,
    artifactUrl,
    sha256,
    sizeBytes,
  }
  writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        productName: "AX Code",
        version: "9.8.7",
        platform: "darwin",
        manifestName,
        artifactName,
        artifactUrl,
        sha256,
        sizeBytes,
      },
      null,
      2,
    ),
  )
  return updateFeed
}

function writeLiveQaEvidence(
  file: string,
  input: {
    mode: "start" | "attach"
    startedSidecar: boolean
  },
) {
  writeFileSync(
    file,
    JSON.stringify({
      mode: input.mode,
      startedSidecar: input.startedSidecar,
      withinBudget: true,
      diagnostics: {
        connected: true,
        streamObserved: true,
        withinRendererWindows: true,
      },
      eventStream: {
        attempts: 1,
        appliedEvents: 1,
      },
    }),
  )
}
