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
})
