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
