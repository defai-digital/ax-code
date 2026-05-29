import { mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import { MAC_RELEASE_MANIFEST_NAME, readDesktopReleaseDiagnostics } from "../src/packaging/release-diagnostics"

describe("desktop release diagnostics", () => {
  test("reports missing release manifest as an explicit disabled update policy", () => {
    const diagnostics = readDesktopReleaseDiagnostics({ resourcesPath: path.join(tmpdir(), "ax-code-missing-release") })

    expect(diagnostics).toMatchObject({
      status: "manifest-missing",
      updatePolicy: "disabled-until-release-pipeline",
      signed: false,
      notarized: false,
      updaterConfigured: false,
    })
  })

  test("reads closed mac release gates without enabling updates", () => {
    const resourcesPath = path.join(tmpdir(), `ax-code-release-${Date.now()}`)
    mkdirSync(resourcesPath, { recursive: true })
    writeFileSync(
      path.join(resourcesPath, MAC_RELEASE_MANIFEST_NAME),
      JSON.stringify({
        productName: "AX Code",
        version: "9.8.7",
        packageTarget: "mac",
        signed: false,
        notarized: false,
        updaterConfigured: false,
        gates: {
          signing: { configured: false, status: "blocked", reason: "missing identity" },
          notarization: { configured: false, status: "blocked", reason: "missing credentials" },
          updater: { configured: false, status: "blocked", reason: "missing feed" },
        },
      }),
    )

    const diagnostics = readDesktopReleaseDiagnostics({ resourcesPath })

    expect(diagnostics).toMatchObject({
      status: "manifest-found",
      productName: "AX Code",
      version: "9.8.7",
      packageTarget: "mac",
      signed: false,
      notarized: false,
      updaterConfigured: false,
      gates: {
        signing: { configured: false, status: "blocked", reason: "missing identity" },
        notarization: { configured: false, status: "blocked", reason: "missing credentials" },
        updater: { configured: false, status: "blocked", reason: "missing feed" },
      },
    })
  })

  test("does not enable updates when release gate status contradicts enabled flags", () => {
    const resourcesPath = path.join(tmpdir(), `ax-code-release-inconsistent-${Date.now()}`)
    mkdirSync(resourcesPath, { recursive: true })
    writeFileSync(
      path.join(resourcesPath, MAC_RELEASE_MANIFEST_NAME),
      JSON.stringify({
        productName: "AX Code",
        version: "9.8.7",
        packageTarget: "mac",
        signed: true,
        notarized: true,
        updaterConfigured: true,
        updateFeed: {
          url: "https://updates.example.test/ax-code/",
          manifestName: "ax-code-update.json",
          manifestPath: path.join(resourcesPath, "ax-code-update.json"),
          artifactPath: path.join(resourcesPath, "AX Code.app.zip"),
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
      }),
    )

    const diagnostics = readDesktopReleaseDiagnostics({ resourcesPath })

    expect(diagnostics).toMatchObject({
      status: "manifest-found",
      updatePolicy: "disabled-until-release-pipeline",
      signed: true,
      notarized: true,
      updaterConfigured: true,
      gates: {
        notarization: { configured: true, status: "blocked", reason: "notary failed" },
      },
    })
  })

  test("does not enable updates when passed gates lack an update feed manifest locator", () => {
    const resourcesPath = path.join(tmpdir(), `ax-code-release-incomplete-feed-${Date.now()}`)
    mkdirSync(resourcesPath, { recursive: true })
    writeFileSync(
      path.join(resourcesPath, MAC_RELEASE_MANIFEST_NAME),
      JSON.stringify({
        productName: "AX Code",
        version: "9.8.7",
        packageTarget: "mac",
        signed: true,
        notarized: true,
        updaterConfigured: true,
        updateFeed: {
          url: "https://updates.example.test/ax-code/",
          artifactName: "AX Code.app.zip",
          sha256: "a".repeat(64),
          sizeBytes: 123,
        },
        gates: {
          signing: { configured: true, status: "passed" },
          notarization: { configured: true, status: "passed" },
          updater: { configured: true, status: "passed" },
        },
      }),
    )

    const diagnostics = readDesktopReleaseDiagnostics({ resourcesPath })

    expect(diagnostics).toMatchObject({
      status: "manifest-found",
      updatePolicy: "disabled-until-release-pipeline",
      signed: true,
      notarized: true,
      updaterConfigured: true,
    })
  })

  test("enables updates when passed gates include an update feed manifest locator", () => {
    const resourcesPath = path.join(tmpdir(), `ax-code-release-complete-feed-${Date.now()}`)
    mkdirSync(resourcesPath, { recursive: true })
    writeFileSync(
      path.join(resourcesPath, MAC_RELEASE_MANIFEST_NAME),
      JSON.stringify({
        productName: "AX Code",
        version: "9.8.7",
        packageTarget: "mac",
        signed: true,
        notarized: true,
        updaterConfigured: true,
        updateFeed: {
          url: "https://updates.example.test/ax-code/",
          manifestName: "ax-code-update.json",
        },
        gates: {
          signing: { configured: true, status: "passed" },
          notarization: { configured: true, status: "passed" },
          updater: { configured: true, status: "passed" },
        },
      }),
    )

    const diagnostics = readDesktopReleaseDiagnostics({ resourcesPath })

    expect(diagnostics).toMatchObject({
      status: "manifest-found",
      updatePolicy: "feed-configured",
      signed: true,
      notarized: true,
      updaterConfigured: true,
    })
  })

  test("does not treat external artifact metadata as part of installed update policy", () => {
    const resourcesPath = path.join(tmpdir(), `ax-code-release-bad-feed-url-${Date.now()}`)
    mkdirSync(resourcesPath, { recursive: true })
    writeFileSync(
      path.join(resourcesPath, MAC_RELEASE_MANIFEST_NAME),
      JSON.stringify({
        productName: "AX Code",
        version: "9.8.7",
        packageTarget: "mac",
        signed: true,
        notarized: true,
        updaterConfigured: true,
        updateFeed: {
          url: "https://updates.example.test/ax-code/",
          manifestName: "ax-code-update.json",
          manifestPath: path.join(resourcesPath, "ax-code-update.json"),
          artifactPath: path.join(resourcesPath, "AX Code.app.zip"),
          artifactName: "AX Code.app.zip",
          artifactUrl: "https://updates.example.test/other/AX%20Code.app.zip",
          sha256: "a".repeat(64),
          sizeBytes: 123,
        },
        gates: {
          signing: { configured: true, status: "passed" },
          notarization: { configured: true, status: "passed" },
          updater: { configured: true, status: "passed" },
        },
      }),
    )

    const diagnostics = readDesktopReleaseDiagnostics({ resourcesPath })

    expect(diagnostics).toMatchObject({
      status: "manifest-found",
      updatePolicy: "feed-configured",
      signed: true,
      notarized: true,
      updaterConfigured: true,
    })
  })
})
