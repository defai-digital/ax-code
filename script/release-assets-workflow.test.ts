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
