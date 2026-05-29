import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import { createDesktopBetaEvidenceBundle } from "../src/packaging/beta-evidence"
import { MAC_RELEASE_MANIFEST_NAME } from "../src/packaging/release-diagnostics"

describe("desktop beta evidence bundle", () => {
  test("passes strict internal beta evidence when every handoff artifact is present", () => {
    const root = path.join(tmpdir(), `ax-code-beta-evidence-${Date.now()}`)
    const resourcesPath = path.join(root, "Resources")
    mkdirSync(resourcesPath, { recursive: true })
    writeReleaseManifest(resourcesPath)
    const qaBetaPath = path.join(root, "qa-beta.json")
    const sidecarPath = path.join(root, "qa-live-sidecar.json")
    const attachPath = path.join(root, "qa-live-attach.json")
    const rendererSmokePath = path.join(root, "renderer-smoke.json")
    const packagedSmokePath = path.join(root, "packaged-smoke.json")
    const commandEvidencePath = path.join(root, "commands.json")
    writeQaBetaEvidence(qaBetaPath)
    writeLiveQaEvidence(sidecarPath, { mode: "start", startedSidecar: true })
    writeLiveQaEvidence(attachPath, { mode: "attach", startedSidecar: false })
    writeRendererSmokeEvidence(rendererSmokePath)
    writePackagedSmokeEvidence(packagedSmokePath)
    writeCommandEvidence(commandEvidencePath)

    const bundle = createDesktopBetaEvidenceBundle({
      resourcesPath,
      qaBetaPath,
      qaLiveSidecarPath: sidecarPath,
      qaLiveAttachPath: attachPath,
      rendererSmokePath,
      packagedSmokePath,
      commandEvidencePath,
      strict: true,
    })

    expect(bundle.ready).toBe(true)
    expect(bundle.checks["release-readiness"].status).toBe("passed")
    expect(bundle.checks["qa-beta"].status).toBe("passed")
    expect(bundle.checks["renderer-smoke"].status).toBe("passed")
    expect(bundle.checks["command-evidence"].status).toBe("passed")
    expect(bundle.betaReadiness.checks.releasePipeline.status).toBe("warning")
  })

  test("fails strict beta evidence when required artifacts or command checks are missing", () => {
    const root = path.join(tmpdir(), `ax-code-beta-evidence-fail-${Date.now()}`)
    const resourcesPath = path.join(root, "Resources")
    mkdirSync(resourcesPath, { recursive: true })
    writeReleaseManifest(resourcesPath)
    const commandEvidencePath = path.join(root, "commands.json")
    writeCommandEvidence(commandEvidencePath, { failedName: "desktop:smoke:renderer", omitName: "app:qa:beta" })

    const bundle = createDesktopBetaEvidenceBundle({
      resourcesPath,
      commandEvidencePath,
      strict: true,
    })

    expect(bundle.ready).toBe(false)
    expect(bundle.checks["qa-beta"]).toMatchObject({ status: "failed" })
    expect(bundle.checks["qa-live-sidecar"]).toMatchObject({ status: "failed" })
    expect(bundle.checks["renderer-smoke"]).toMatchObject({ status: "failed" })
    const commandEvidence = bundle.checks["command-evidence"]
    expect(commandEvidence.status).toBe("failed")
    expect(commandEvidence.reason ?? "").toContain("failed desktop:smoke:renderer")
    expect(commandEvidence.reason ?? "").toContain("missing app:qa:beta")
  })

  test("fails strict command evidence when live QA command outcomes are missing", () => {
    const root = path.join(tmpdir(), `ax-code-beta-evidence-live-command-${Date.now()}`)
    const resourcesPath = path.join(root, "Resources")
    mkdirSync(resourcesPath, { recursive: true })
    writeReleaseManifest(resourcesPath)
    const qaBetaPath = path.join(root, "qa-beta.json")
    const sidecarPath = path.join(root, "qa-live-sidecar.json")
    const attachPath = path.join(root, "qa-live-attach.json")
    const rendererSmokePath = path.join(root, "renderer-smoke.json")
    const packagedSmokePath = path.join(root, "packaged-smoke.json")
    const commandEvidencePath = path.join(root, "commands.json")
    writeQaBetaEvidence(qaBetaPath)
    writeLiveQaEvidence(sidecarPath, { mode: "start", startedSidecar: true })
    writeLiveQaEvidence(attachPath, { mode: "attach", startedSidecar: false })
    writeRendererSmokeEvidence(rendererSmokePath)
    writePackagedSmokeEvidence(packagedSmokePath)
    writeCommandEvidence(commandEvidencePath, {
      omitNames: ["app:qa:live:sidecar", "app:qa:live:attach"],
    })

    const bundle = createDesktopBetaEvidenceBundle({
      resourcesPath,
      qaBetaPath,
      qaLiveSidecarPath: sidecarPath,
      qaLiveAttachPath: attachPath,
      rendererSmokePath,
      packagedSmokePath,
      commandEvidencePath,
      strict: true,
    })

    expect(bundle.ready).toBe(false)
    expect(bundle.checks["qa-live-sidecar"].status).toBe("passed")
    expect(bundle.checks["qa-live-attach"].status).toBe("passed")
    expect(bundle.checks["command-evidence"].status).toBe("failed")
    expect(bundle.checks["command-evidence"].reason ?? "").toContain("missing app:qa:live:sidecar")
    expect(bundle.checks["command-evidence"].reason ?? "").toContain("missing app:qa:live:attach")
  })

  test("fails strict command evidence when command outputs do not match supplied artifacts", () => {
    const root = path.join(tmpdir(), `ax-code-beta-evidence-output-${Date.now()}`)
    const resourcesPath = path.join(root, "Resources")
    mkdirSync(resourcesPath, { recursive: true })
    writeReleaseManifest(resourcesPath)
    const qaBetaPath = path.join(root, "qa-beta.json")
    const sidecarPath = path.join(root, "qa-live-sidecar.json")
    const attachPath = path.join(root, "qa-live-attach.json")
    const rendererSmokePath = path.join(root, "renderer-smoke.json")
    const packagedSmokePath = path.join(root, "packaged-smoke.json")
    const commandEvidencePath = path.join(root, "commands.json")
    writeQaBetaEvidence(qaBetaPath)
    writeLiveQaEvidence(sidecarPath, { mode: "start", startedSidecar: true })
    writeLiveQaEvidence(attachPath, { mode: "attach", startedSidecar: false })
    writeRendererSmokeEvidence(rendererSmokePath)
    writePackagedSmokeEvidence(packagedSmokePath)
    writeCommandEvidence(commandEvidencePath, {
      outputPathOverrides: {
        "desktop:smoke:packaged": path.join(root, "stale-packaged-smoke.json"),
      },
    })

    const bundle = createDesktopBetaEvidenceBundle({
      resourcesPath,
      qaBetaPath,
      qaLiveSidecarPath: sidecarPath,
      qaLiveAttachPath: attachPath,
      rendererSmokePath,
      packagedSmokePath,
      commandEvidencePath,
      strict: true,
    })

    expect(bundle.ready).toBe(false)
    expect(bundle.checks["packaged-smoke"].status).toBe("passed")
    expect(bundle.checks["command-evidence"].status).toBe("failed")
    expect(bundle.checks["command-evidence"].reason ?? "").toContain("outputPath mismatch desktop:smoke:packaged")
  })

  test("fails packaged smoke evidence when it did not validate the mac app bundle", () => {
    const root = path.join(tmpdir(), `ax-code-beta-evidence-packaged-${Date.now()}`)
    const resourcesPath = path.join(root, "Resources")
    mkdirSync(resourcesPath, { recursive: true })
    writeReleaseManifest(resourcesPath)
    const packagedSmokePath = path.join(root, "packaged-smoke.json")
    writePackagedSmokeEvidence(packagedSmokePath, { macBundle: false })

    const bundle = createDesktopBetaEvidenceBundle({
      resourcesPath,
      packagedSmokePath,
      requirePackagedSmoke: true,
    })

    expect(bundle.ready).toBe(false)
    expect(bundle.checks["packaged-smoke"]).toMatchObject({
      status: "failed",
      reason: "packaged smoke checks failed: macBundle, releaseManifest",
    })
  })

  test("fails packaged smoke evidence when clean shutdown contract evidence is missing", () => {
    const root = path.join(tmpdir(), `ax-code-beta-evidence-shutdown-${Date.now()}`)
    const resourcesPath = path.join(root, "Resources")
    mkdirSync(resourcesPath, { recursive: true })
    writeReleaseManifest(resourcesPath)
    const packagedSmokePath = path.join(root, "packaged-smoke.json")
    writePackagedSmokeEvidence(packagedSmokePath, { cleanShutdown: false })

    const bundle = createDesktopBetaEvidenceBundle({
      resourcesPath,
      packagedSmokePath,
      requirePackagedSmoke: true,
    })

    expect(bundle.ready).toBe(false)
    expect(bundle.checks["packaged-smoke"]).toMatchObject({
      status: "failed",
      reason: "packaged smoke checks failed: cleanShutdownLifecycle",
    })
  })

  test("fails packaged smoke evidence when preload bridge boundary evidence is missing", () => {
    const root = path.join(tmpdir(), `ax-code-beta-evidence-preload-${Date.now()}`)
    const resourcesPath = path.join(root, "Resources")
    mkdirSync(resourcesPath, { recursive: true })
    writeReleaseManifest(resourcesPath)
    const packagedSmokePath = path.join(root, "packaged-smoke.json")
    writePackagedSmokeEvidence(packagedSmokePath, { preloadBridge: false })

    const bundle = createDesktopBetaEvidenceBundle({
      resourcesPath,
      packagedSmokePath,
      requirePackagedSmoke: true,
    })

    expect(bundle.ready).toBe(false)
    expect(bundle.checks["packaged-smoke"]).toMatchObject({
      status: "failed",
      reason:
        "packaged smoke checks failed: preloadBridgeAllowlist, preloadNoRawIpcExposure, preloadMenuCommandFilter",
    })
  })

  test("fails representative live QA when requested evidence was not collected with thresholds", () => {
    const root = path.join(tmpdir(), `ax-code-beta-evidence-representative-${Date.now()}`)
    const resourcesPath = path.join(root, "Resources")
    mkdirSync(resourcesPath, { recursive: true })
    writeReleaseManifest(resourcesPath)
    const sidecarPath = path.join(root, "qa-live-sidecar.json")
    const attachPath = path.join(root, "qa-live-attach.json")
    writeLiveQaEvidence(sidecarPath, { mode: "start", startedSidecar: true })
    writeLiveQaEvidence(attachPath, { mode: "attach", startedSidecar: false, representativePassed: false })

    const bundle = createDesktopBetaEvidenceBundle({
      resourcesPath,
      qaLiveSidecarPath: sidecarPath,
      qaLiveAttachPath: attachPath,
      requireLiveQa: true,
      requireRepresentativeLiveQa: true,
    })

    expect(bundle.ready).toBe(false)
    expect(bundle.betaReadiness.checks.liveSidecarQa.reason).toContain("representative coverage requirements")
    expect(bundle.betaReadiness.checks.liveAttachQa.reason).toContain("representative coverage failed")
  })

  test("passes public release evidence with signed locator plus external update feed and archive", () => {
    const root = path.join(tmpdir(), `ax-code-beta-evidence-public-release-${Date.now()}`)
    const resourcesPath = path.join(root, "Resources")
    mkdirSync(resourcesPath, { recursive: true })
    const releaseEvidence = writeUpdateFeedEvidence(root)
    writeReleaseManifest(resourcesPath, {
      signed: true,
      notarized: true,
      updaterConfigured: true,
      updateFeed: {
        url: releaseEvidence.url,
        manifestName: releaseEvidence.manifestName,
      },
    })

    const bundle = createDesktopBetaEvidenceBundle({
      resourcesPath,
      requireReleasePipeline: true,
      updateManifestPath: releaseEvidence.manifestPath,
      releaseArchivePath: releaseEvidence.artifactPath,
    })

    expect(bundle.ready).toBe(true)
    expect(bundle.checks["release-readiness"].status).toBe("passed")
    expect(bundle.betaReadiness.checks.releasePipeline.status).toBe("passed")
  })

  test("fails public release evidence when external archive evidence is missing", () => {
    const root = path.join(tmpdir(), `ax-code-beta-evidence-public-release-missing-${Date.now()}`)
    const resourcesPath = path.join(root, "Resources")
    mkdirSync(resourcesPath, { recursive: true })
    const releaseEvidence = writeUpdateFeedEvidence(root)
    writeReleaseManifest(resourcesPath, {
      signed: true,
      notarized: true,
      updaterConfigured: true,
      updateFeed: {
        url: releaseEvidence.url,
        manifestName: releaseEvidence.manifestName,
      },
    })

    const bundle = createDesktopBetaEvidenceBundle({
      resourcesPath,
      requireReleasePipeline: true,
      updateManifestPath: releaseEvidence.manifestPath,
    })

    expect(bundle.ready).toBe(false)
    expect(bundle.checks["release-readiness"].status).toBe("failed")
    expect(bundle.checks["release-readiness"].reason ?? "").toContain("release archive path evidence is missing")
  })
})

function writeReleaseManifest(
  resourcesPath: string,
  input: {
    signed?: boolean
    notarized?: boolean
    updaterConfigured?: boolean
    updateFeed?: Record<string, unknown>
  } = {},
) {
  const signed = input.signed ?? false
  const notarized = input.notarized ?? false
  const updaterConfigured = input.updaterConfigured ?? false
  writeFileSync(
    path.join(resourcesPath, MAC_RELEASE_MANIFEST_NAME),
    JSON.stringify({
      productName: "AX Code",
      version: "9.8.7",
      packageTarget: "mac",
      appPath: path.join(resourcesPath, "../AX Code.app"),
      resourcesAppPath: path.join(resourcesPath, "app"),
      mainPath: path.join(resourcesPath, "app/main.js"),
      preloadPath: path.join(resourcesPath, "app/preload.cjs"),
      rendererIndexPath: path.join(resourcesPath, "app/app/index.html"),
      electronVersion: "40.0.0",
      signed,
      notarized,
      updaterConfigured,
      updateFeed: input.updateFeed,
      gates: {
        signing: { configured: signed, status: signed ? "passed" : "blocked" },
        notarization: { configured: notarized, status: notarized ? "passed" : "blocked" },
        updater: { configured: updaterConfigured, status: updaterConfigured ? "passed" : "blocked" },
      },
    }),
  )
}

function writeUpdateFeedEvidence(root: string) {
  const manifestName = "ax-code-update.json"
  const artifactName = "AX Code.app.zip"
  const manifestPath = path.join(root, manifestName)
  const artifactPath = path.join(root, artifactName)
  const artifactUrl = "https://updates.example.test/ax-code/AX%20Code.app.zip"
  writeFileSync(artifactPath, "signed notarized archive")
  const sha256 = createHash("sha256").update(readFileSync(artifactPath)).digest("hex")
  const sizeBytes = readFileSync(artifactPath).byteLength
  writeFileSync(
    manifestPath,
    JSON.stringify({
      productName: "AX Code",
      version: "9.8.7",
      platform: "darwin",
      manifestName,
      artifactName,
      artifactUrl,
      sha256,
      sizeBytes,
    }),
  )
  return {
    url: "https://updates.example.test/ax-code/",
    manifestName,
    manifestPath,
    artifactPath,
    artifactName,
    artifactUrl,
    sha256,
    sizeBytes,
  }
}

function writeQaBetaEvidence(file: string) {
  writeFileSync(
    file,
    JSON.stringify({
      longSession: { withinBudget: true },
      reconnect: {
        withinBudget: true,
        reconnectedSessionPresent: true,
        reconnectedQueuePresent: true,
      },
      withinBudget: true,
    }),
  )
}

function writeLiveQaEvidence(
  file: string,
  input: { mode: "start" | "attach"; startedSidecar: boolean; representativePassed?: boolean },
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
      representative:
        input.representativePassed === undefined
          ? undefined
          : {
              required: true,
              passed: input.representativePassed,
              checks: {
                visibleMessages: {
                  actual: input.representativePassed ? 60 : 4,
                  minimum: 50,
                  passed: input.representativePassed,
                },
              },
            },
    }),
  )
}

function writeRendererSmokeEvidence(file: string) {
  writeFileSync(
    file,
    JSON.stringify({
      checks: {
        electronBrowser: true,
        nonblank: true,
        commandCenter: true,
        actions: true,
        accessibility: true,
        desktopViewports: true,
      },
      viewports: [
        {
          checks: {
            accessibilityIssues: [],
            reconnectBanner: true,
            keyboardFlow: {
              requiredLabels: {
                "Skip to work surface": true,
                "ax-code": true,
                Run: true,
                Queue: true,
              },
            },
          },
        },
      ],
    }),
  )
}

function writePackagedSmokeEvidence(
  file: string,
  options: { macBundle?: boolean; cleanShutdown?: boolean; preloadBridge?: boolean } = {},
) {
  writeFileSync(
    file,
    JSON.stringify({
      checks: {
        electronDependency: true,
        main: true,
        runtimeDependencyClosure: true,
        backendLifecycleBridge: true,
        diagnosticsLogExport: true,
        startupFailureDiagnostics: true,
        rendererCrashDiagnostics: true,
        loopbackProxyBypass: true,
        cleanShutdownLifecycle: options.cleanShutdown ?? true,
        rendererIndex: true,
        preload: true,
        preloadBridgeAllowlist: options.preloadBridge ?? true,
        preloadNoRawIpcExposure: options.preloadBridge ?? true,
        preloadMenuCommandFilter: options.preloadBridge ?? true,
        customProtocol: true,
        sandboxedRenderer: true,
        macBundle: options.macBundle ?? true,
        releaseManifest: options.macBundle ?? true,
      },
    }),
  )
}

function writeCommandEvidence(
  file: string,
  options: {
    failedName?: string
    omitName?: string
    omitNames?: string[]
    outputPathOverrides?: Record<string, string>
  } = {},
) {
  const required = [
    "app:typecheck",
    "app:test",
    "app:test:e2e",
    "app:build",
    "app:perf:smoke",
    "app:qa:beta",
    "app:qa:live:sidecar",
    "app:qa:live:attach",
    "desktop:typecheck",
    "desktop:test",
    "desktop:build",
    "desktop:smoke:packaged",
    "desktop:smoke:renderer",
    "desktop:package:mac",
    "repo:check:structure",
  ]
  const root = path.dirname(file)
  const outputPaths: Record<string, string> = {
    "app:qa:beta": path.join(root, "qa-beta.json"),
    "app:qa:live:sidecar": path.join(root, "qa-live-sidecar.json"),
    "app:qa:live:attach": path.join(root, "qa-live-attach.json"),
    "desktop:smoke:packaged": path.join(root, "packaged-smoke.json"),
    "desktop:smoke:renderer": path.join(root, "renderer-smoke.json"),
    ...options.outputPathOverrides,
  }
  writeFileSync(
    file,
    JSON.stringify({
      commands: required
        .filter((name) => name !== options.omitName && !options.omitNames?.includes(name))
        .map((name) => ({
          name,
          command: name,
          status: name === options.failedName ? "failed" : "passed",
          outputPath: outputPaths[name],
          durationMs: 1,
        })),
    }),
  )
}
