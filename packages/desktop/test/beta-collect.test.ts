import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import {
  evidenceCommandString,
  resolveBetaCollectCliPath,
  runDesktopBetaCollect,
  type DesktopBetaCollectCommandSpec,
  type DesktopBetaCollectRunner,
} from "../src/packaging/beta-collect"
import { DESKTOP_BETA_REQUIRED_COMMANDS } from "../src/packaging/beta-evidence"
import { MAC_RELEASE_MANIFEST_NAME } from "../src/packaging/release-diagnostics"

describe("desktop beta evidence collection", () => {
  test("runs required beta checks and writes a strict evidence bundle", async () => {
    const root = createRoot("ax-code-beta-collect")
    const appPath = path.join(root, "AX Code.app")
    writeReleaseManifest(path.join(appPath, "Contents/Resources"))
    const seen: string[] = []

    const result = await runDesktopBetaCollect({
      outputDir: path.join(root, "evidence"),
      macBundlePath: appPath,
      qaLiveDirectory: root,
      qaLiveAttachUrl: "http://127.0.0.1:4096",
      strict: true,
      runner: fakeRunner({ seen }),
    })

    expect(result.bundle.ready).toBe(true)
    expect(result.bundle.checks["qa-beta"].status).toBe("passed")
    expect(result.bundle.checks["qa-live-sidecar"].status).toBe("passed")
    expect(result.bundle.checks["qa-live-attach"].status).toBe("passed")
    expect(result.bundle.checks["renderer-smoke"].status).toBe("passed")
    expect(result.bundle.checks["command-evidence"].status).toBe("passed")
    expect(existsSync(result.paths.commandEvidence)).toBe(true)
    expect(existsSync(result.paths.evidenceBundle)).toBe(true)
    for (const name of DESKTOP_BETA_REQUIRED_COMMANDS) expect(seen).toContain(name)
    expect(seen).toContain("app:qa:live:sidecar")
    expect(seen).toContain("app:qa:live:attach")
    expect(seen.indexOf("app:build")).toBeLessThan(seen.indexOf("desktop:build"))
    expect(seen.indexOf("desktop:build")).toBeLessThan(seen.indexOf("desktop:package:mac"))
    expect(seen.indexOf("desktop:package:mac")).toBeLessThan(seen.indexOf("desktop:smoke:packaged"))
    const packagedSmoke = result.commands.find((command) => command.name === "desktop:smoke:packaged")
    expect(packagedSmoke?.command).toContain("--mac-bundle-path")
    expect(packagedSmoke?.command).toContain(appPath)
  })

  test("keeps collecting evidence and fails the bundle when a required command fails", async () => {
    const root = createRoot("ax-code-beta-collect-fail")
    const appPath = path.join(root, "AX Code.app")
    writeReleaseManifest(path.join(appPath, "Contents/Resources"))

    const result = await runDesktopBetaCollect({
      outputDir: path.join(root, "evidence"),
      macBundlePath: appPath,
      runner: fakeRunner({ fail: "desktop:test" }),
    })

    const commandsFile = JSON.parse(readFileSync(result.paths.commandEvidence, "utf8")) as {
      commands: Array<{ name: string; status: string }>
    }
    expect(result.bundle.ready).toBe(false)
    expect(result.bundle.checks["command-evidence"].status).toBe("failed")
    expect(result.bundle.checks["command-evidence"].reason).toContain("failed desktop:test")
    expect(
      commandsFile.commands.some((command) => command.name === "desktop:test" && command.status === "failed"),
    ).toBe(true)
  })

  test("can collect attach QA from a harness-started sidecar without exposing an auth header", async () => {
    const root = createRoot("ax-code-beta-collect-attach-harness")
    const appPath = path.join(root, "AX Code.app")
    writeReleaseManifest(path.join(appPath, "Contents/Resources"))

    const result = await runDesktopBetaCollect({
      outputDir: path.join(root, "evidence"),
      macBundlePath: appPath,
      qaLiveDirectory: root,
      strict: true,
      runner: fakeRunner(),
    })
    const attach = result.commands.find((command) => command.name === "app:qa:live:attach")

    expect(result.bundle.ready).toBe(true)
    expect(attach?.status).toBe("passed")
    expect(attach?.command).toContain("--attach-from-directory")
    expect(attach?.command).not.toContain("--auth-header")
  })

  test("redacts explicit live attach auth headers from persisted command evidence", async () => {
    const root = createRoot("ax-code-beta-collect-auth-redaction")
    const appPath = path.join(root, "AX Code.app")
    writeReleaseManifest(path.join(appPath, "Contents/Resources"))

    const result = await runDesktopBetaCollect({
      outputDir: path.join(root, "evidence"),
      macBundlePath: appPath,
      qaLiveDirectory: root,
      qaLiveAttachUrl: "http://127.0.0.1:4096",
      qaLiveAuthHeader: "Basic very-secret",
      strict: true,
      runner: fakeRunner(),
    })
    const attach = result.commands.find((command) => command.name === "app:qa:live:attach")

    expect(result.bundle.ready).toBe(true)
    expect(attach?.command).toContain("--auth-header <redacted>")
    expect(attach?.command).not.toContain("very-secret")
    expect(readFileSync(result.paths.commandEvidence, "utf8")).not.toContain("very-secret")
    expect(evidenceCommandString(["cmd", "--auth-header", "Bearer token", "--output", "out.json"])).toBe(
      "cmd --auth-header <redacted> --output out.json",
    )
  })

  test("passes representative live QA thresholds through sidecar and attach evidence commands", async () => {
    const root = createRoot("ax-code-beta-collect-representative")
    const appPath = path.join(root, "AX Code.app")
    writeReleaseManifest(path.join(appPath, "Contents/Resources"))

    const result = await runDesktopBetaCollect({
      outputDir: path.join(root, "evidence"),
      macBundlePath: appPath,
      qaLiveDirectory: root,
      representativeLiveQa: true,
      qaLiveMinVisibleMessages: 50,
      qaLiveMinQueueItems: 2,
      strict: true,
      runner: fakeRunner(),
    })
    const sidecar = result.commands.find((command) => command.name === "app:qa:live:sidecar")
    const attach = result.commands.find((command) => command.name === "app:qa:live:attach")

    expect(result.bundle.ready).toBe(true)
    expect(sidecar?.command).toContain("--representative")
    expect(sidecar?.command).toContain("--min-visible-messages 50")
    expect(sidecar?.command).toContain("--min-queue-items 2")
    expect(attach?.command).toContain("--representative")
    expect(result.bundle.betaReadiness.checks.liveSidecarQa.status).toBe("passed")
    expect(result.bundle.betaReadiness.checks.liveAttachQa.status).toBe("passed")
  })

  test("resolves repo-relative bundle paths before the bundle exists", () => {
    const root = createRoot("ax-code-beta-collect-path")
    const requested = "packages/desktop/dist/mac/AX Code.app"

    expect(resolveBetaCollectCliPath(requested, root)).toBe(path.join(root, requested))
  })

  test("passes public release artifact evidence through the collected bundle", async () => {
    const root = createRoot("ax-code-beta-collect-public-release")
    const appPath = path.join(root, "AX Code.app")
    const releaseEvidence = writeUpdateFeedEvidence(root)
    writeReleaseManifest(path.join(appPath, "Contents/Resources"), {
      signed: true,
      notarized: true,
      updaterConfigured: true,
      updateFeed: {
        url: releaseEvidence.url,
        manifestName: releaseEvidence.manifestName,
      },
    })

    const result = await runDesktopBetaCollect({
      outputDir: path.join(root, "evidence"),
      macBundlePath: appPath,
      requireReleasePipeline: true,
      updateManifestPath: releaseEvidence.manifestPath,
      releaseArchivePath: releaseEvidence.artifactPath,
      runner: fakeRunner(),
    })

    expect(result.bundle.ready).toBe(true)
    expect(result.bundle.betaReadiness.checks.releasePipeline.status).toBe("passed")
  })

  test("fails public release collection when external archive evidence is missing", async () => {
    const root = createRoot("ax-code-beta-collect-public-release-missing-archive")
    const appPath = path.join(root, "AX Code.app")
    const releaseEvidence = writeUpdateFeedEvidence(root)
    writeReleaseManifest(path.join(appPath, "Contents/Resources"), {
      signed: true,
      notarized: true,
      updaterConfigured: true,
      updateFeed: {
        url: releaseEvidence.url,
        manifestName: releaseEvidence.manifestName,
      },
    })

    const result = await runDesktopBetaCollect({
      outputDir: path.join(root, "evidence"),
      macBundlePath: appPath,
      requireReleasePipeline: true,
      updateManifestPath: releaseEvidence.manifestPath,
      runner: fakeRunner(),
    })

    expect(result.bundle.ready).toBe(false)
    expect(result.bundle.betaReadiness.checks.releasePipeline.status).toBe("failed")
    expect(result.bundle.betaReadiness.checks.releasePipeline.reason).toContain("release archive path evidence is missing")
  })
})

function fakeRunner(options: { seen?: string[]; fail?: string } = {}): DesktopBetaCollectRunner {
  return async (spec) => {
    options.seen?.push(spec.name)
    if (spec.outputPath) writeEvidenceForCommand(spec, spec.outputPath)
    return {
      exitCode: spec.name === options.fail ? 1 : 0,
      stdout: `${spec.name} stdout\n`,
      stderr: spec.name === options.fail ? `${spec.name} failed\n` : "",
    }
  }
}

function writeEvidenceForCommand(spec: DesktopBetaCollectCommandSpec, file: string) {
  if (spec.name === "app:qa:beta") return writeJson(file, qaBetaEvidence())
  if (spec.name === "app:qa:live:sidecar")
    return writeJson(file, liveQaEvidence("start", true, spec.command.includes("--representative")))
  if (spec.name === "app:qa:live:attach")
    return writeJson(file, liveQaEvidence("attach", false, spec.command.includes("--representative")))
  if (spec.name === "desktop:smoke:renderer") return writeJson(file, rendererSmokeEvidence())
  if (spec.name === "desktop:smoke:packaged") return writeJson(file, packagedSmokeEvidence())
}

function createRoot(prefix: string) {
  const root = path.join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(root, { recursive: true })
  return root
}

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
  writeJson(path.join(resourcesPath, MAC_RELEASE_MANIFEST_NAME), {
    productName: "AX Code",
    version: "9.8.7",
    packageTarget: "mac",
    appPath: path.join(resourcesPath, "../.."),
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
  })
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
  writeJson(manifestPath, {
    productName: "AX Code",
    version: "9.8.7",
    platform: "darwin",
    manifestName,
    artifactName,
    artifactUrl,
    sha256,
    sizeBytes,
  })
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

function qaBetaEvidence() {
  return {
    longSession: { withinBudget: true },
    reconnect: {
      withinBudget: true,
      reconnectedSessionPresent: true,
      reconnectedQueuePresent: true,
    },
    withinBudget: true,
  }
}

function liveQaEvidence(mode: "start" | "attach", startedSidecar: boolean, representative = false) {
  return {
    mode,
    startedSidecar,
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
    representative: representative
      ? {
          required: true,
          passed: true,
          checks: {
            sessions: { actual: 1, minimum: 1, passed: true },
            queueItems: { actual: 2, minimum: 2, passed: true },
            visibleMessages: { actual: 60, minimum: 50, passed: true },
            hiddenMessages: { actual: 0, minimum: 0, passed: true },
            appliedEvents: { actual: 60, minimum: 1, passed: true },
            scheduledTasks: { actual: 0, minimum: 0, passed: true },
          },
        }
      : undefined,
  }
}

function rendererSmokeEvidence() {
  return {
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
  }
}

function packagedSmokeEvidence() {
  return {
    checks: {
      electronDependency: true,
      main: true,
      runtimeDependencyClosure: true,
      backendLifecycleBridge: true,
      diagnosticsLogExport: true,
      startupFailureDiagnostics: true,
      rendererCrashDiagnostics: true,
      loopbackProxyBypass: true,
      cleanShutdownLifecycle: true,
      rendererIndex: true,
      preload: true,
      preloadBridgeAllowlist: true,
      preloadNoRawIpcExposure: true,
      preloadMenuCommandFilter: true,
      customProtocol: true,
      sandboxedRenderer: true,
      macBundle: true,
      releaseManifest: true,
    },
  }
}

function writeJson(file: string, value: unknown) {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}
