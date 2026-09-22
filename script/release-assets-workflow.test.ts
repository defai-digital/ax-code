import { readFileSync } from "node:fs"
import { describe, expect, test } from "vitest"
import {
  expectedReleaseArchives,
  expectedReleaseInstallerAssets,
  expectedReleaseInstallerSignatures,
  expectedReleaseMetadataAssets,
  expectedReleaseSignatures,
} from "./publish-github-release"

const workflow = readFileSync(".github/workflows/release.yml", "utf8")

describe("release asset workflow", () => {
  test("fetches and smoke-tests the same engine archive as managed installation", () => {
    const constants = readFileSync("packages/ax-code/src/provider/ax-engine/constants.ts", "utf8")
    const release = constants.slice(constants.indexOf("export const AX_ENGINE_BINARY_RELEASE:"))
    const version = release.match(/version: "([^"]+)"/)?.[1]
    const sha256 = release.match(/sha256: "([a-f0-9]{64})"/)?.[1]
    expect(version).toBeDefined()
    expect(sha256).toBeDefined()
    expect(workflow).toContain(`VERSION="${version}"`)
    expect(workflow).toContain(`EXPECTED="${sha256}"`)
    expect(workflow).toContain(`ENGINE_BIN="$SMOKE_ROOT/engine/${version}/ax-engine"`)
    expect(workflow).toContain(`data.install?.version !== "${version}"`)
  })

  test("signs Windows payloads before archival and keeps vault credentials out of compilation", () => {
    const build = workflow.indexOf("- name: Build\n")
    const signing = workflow.indexOf("- name: Sign and repackage Windows runtime")
    const smoke = workflow.indexOf("- name: Smoke — release runtime")
    const upload = workflow.indexOf("- name: Upload build artifacts")
    expect(build).toBeGreaterThan(-1)
    expect(signing).toBeGreaterThan(build)
    expect(smoke).toBeGreaterThan(signing)
    expect(upload).toBeGreaterThan(smoke)
    expect(workflow.slice(build, signing)).not.toContain("AZURE_CLIENT_SECRET")
    const gate = workflow.slice(signing, smoke)
    expect(gate).toContain("sign-windows-runtime.ps1")
    expect(gate.indexOf("Compress-Archive")).toBeGreaterThan(gate.indexOf("writeDistributionManifest"))
    expect(gate).not.toContain("continue-on-error")
  })

  test("builds default evidence support and verifies the packaged storage capability", () => {
    const action = readFileSync(".github/actions/build-evidence-cache/action.yml", "utf8")
    const build = readFileSync("packages/ax-code/script/build-node-tui.ts", "utf8")
    const ci = readFileSync(".github/workflows/ax-code-ci.yml", "utf8")
    expect(workflow).toContain("uses: ./.github/actions/build-evidence-cache")
    expect(action).toContain("pnpm build:native fs")
    expect(action).toContain("node script/verify-evidence-cache.cjs packages/ax-code-fs-native")
    expect(workflow).toContain("pnpm build:native index-core diff parser")
    expect(build).toContain("inspectNativeAddonPayload")
    expect(build).toContain('path.join(axScope, "fs")')
    expect(build).toContain("Release requires")
    expect(build).toContain("Bundled evidence cache verification failed")
    expect(ci).toContain("uses: ./.github/actions/build-evidence-cache")
    for (const runner of ["macos-latest", "ubuntu-24.04", "ubuntu-24.04-arm", "windows-2022", "windows-11-arm"])
      expect(ci.slice(ci.indexOf("  evidence-native:"), ci.indexOf("  windows-snapshot:"))).toContain(runner)
  })

  test("blocks release builds on dependency vulnerabilities even when main CI runs separately", () => {
    const validation = workflow.slice(workflow.indexOf("\n  validate:"), workflow.indexOf("\n  build:"))
    const install = validation.indexOf("pnpm install --frozen-lockfile")
    const scan = validation.indexOf("- name: Security scan")
    const buildSDK = validation.indexOf("- name: Build SDK")
    expect(install).toBeGreaterThan(-1)
    expect(scan).toBeGreaterThan(install)
    expect(buildSDK).toBeGreaterThan(scan)
    const security = validation.slice(scan, buildSDK)
    expect(security).toContain("google/osv-scanner-action/osv-scanner-action@")
    expect(security).toContain("--lockfile=pnpm-lock.yaml")
    expect(security).not.toMatch(/continue-on-error:|if:|--experimental-offline|--no-fail/)
    expect(workflow).toMatch(/\n  build:\n    needs: \[guard, validate\]/)
  })

  test("blocks SDK publication on dependency vulnerabilities", () => {
    const sdk = readFileSync(".github/workflows/sdk-jsr.yml", "utf8")
    const install = sdk.indexOf("pnpm install --frozen-lockfile")
    const scan = sdk.indexOf("- name: Security scan")
    const next = sdk.indexOf("- name:", scan + 1)
    const publish = sdk.indexOf("pnpm --dir packages/sdk/js run publish:jsr")
    expect(install).toBeGreaterThan(-1)
    expect(scan).toBeGreaterThan(install)
    expect(next).toBeGreaterThan(scan)
    expect(publish).toBeGreaterThan(next)
    const security = sdk.slice(scan, next)
    expect(security).toContain("google/osv-scanner-action/osv-scanner-action@")
    expect(security).toContain("--lockfile=pnpm-lock.yaml")
    expect(security).not.toMatch(/continue-on-error:|if:|--experimental-offline|--no-fail/)
  })

  test("requires registry verification after a possibly partial SDK publication", () => {
    const sdk = readFileSync(".github/workflows/sdk-jsr.yml", "utf8")
    const publish = sdk.indexOf("- name: Publish JSR package with provenance")
    const verify = sdk.indexOf("- name: Verify published SDK and provenance")
    expect(publish).toBeGreaterThan(-1)
    expect(verify).toBeGreaterThan(publish)
    expect(sdk.slice(publish, verify)).toContain("continue-on-error: true")
    expect(sdk.slice(verify)).toContain("uses: ./.github/actions/sdk-publication")
    expect(sdk.slice(verify)).not.toMatch(/continue-on-error:|if:/)
  })

  test("requires every supported archive and detached signature before publication", () => {
    const uploadStart = workflow.indexOf("- name: Upload release assets")
    const verifyStart = workflow.indexOf("- name: Verify uploaded release signatures")
    const publishStart = workflow.indexOf("- name: Publish verified release")
    expect(uploadStart).toBeGreaterThan(-1)
    expect(verifyStart).toBeGreaterThan(uploadStart)
    expect(publishStart).toBeGreaterThan(verifyStart)

    const upload = workflow.slice(uploadStart, verifyStart)
    const verify = workflow.slice(verifyStart, publishStart)
    for (const asset of [
      ...expectedReleaseArchives(),
      ...expectedReleaseSignatures(),
      ...expectedReleaseInstallerAssets(),
      ...expectedReleaseInstallerSignatures(),
      ...expectedReleaseMetadataAssets(),
    ]) {
      expect(upload).toContain(asset)
    }
    for (const asset of [...expectedReleaseArchives(), ...expectedReleaseInstallerAssets()]) {
      expect(verify).toContain(asset)
    }

    expect(upload).toContain('if [ ! -f "$file" ]')
    expect(upload).not.toMatch(/dist\/\*\.(?:zip|tar\.gz)/)
    expect(verify).not.toMatch(/VERIFY_DIR"\/\*\.(?:zip|tar\.gz)/)
  })
})
