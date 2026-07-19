import { describe, expect, test } from "vitest"
import fs from "fs"
import path from "path"
import {
  defaultInstallChannel,
  defaultTag,
  expectedReleaseArchives,
  expectedReleaseInstallerAssets,
  expectedReleaseInstallerSignatures,
  expectedReleaseMetadataAssets,
  expectedReleaseSignatures,
  isPrerelease,
  missingReleaseAssets,
  normalizeVersion,
  parsePublishGithubReleaseArgs,
  publishPlan,
  trackedInternalPrivacyIssue,
} from "./publish-github-release"

describe("publish-github-release helpers", () => {
  test("keeps the workflow as sole signer and independently verifies its assets", () => {
    const source = fs.readFileSync(path.join(import.meta.dirname, "publish-github-release.ts"), "utf8")

    expect(source).toContain('run("minisign", ["-V"')
    expect(source).toContain("Downloaded ax-minisign.pub does not match")
    expect(source).not.toContain('["release", "upload"')
    expect(source).not.toContain("signReleaseAssetsCommand")
  })

  test("normalizes versions and tags", () => {
    expect(normalizeVersion("v5.10.1")).toBe("5.10.1")
    expect(normalizeVersion("5.10.1-beta.1")).toBe("5.10.1-beta.1")
    expect(defaultTag("5.10.1")).toBe("v5.10.1")
    expect(defaultTag("v5.10.1")).toBe("v5.10.1")
  })

  test("uses the install smoke channel that matches release type", () => {
    expect(isPrerelease("5.10.1")).toBe(false)
    expect(isPrerelease("5.10.1-beta.1")).toBe(true)
    expect(defaultInstallChannel("5.10.1")).toBe("all")
    expect(defaultInstallChannel("5.10.1-beta.1")).toBe("windows")
  })

  test("tracks required GitHub release archives and signatures", () => {
    expect(expectedReleaseArchives()).toEqual([
      "ax-code-darwin-arm64.zip",
      "ax-code-windows-x64.zip",
      "ax-code-windows-arm64.zip",
    ])
    expect(expectedReleaseSignatures()).toEqual([
      "ax-code-darwin-arm64.zip.minisig",
      "ax-code-windows-x64.zip.minisig",
      "ax-code-windows-arm64.zip.minisig",
    ])
    expect(expectedReleaseInstallerAssets()).toEqual(["install.ps1"])
    expect(expectedReleaseInstallerSignatures()).toEqual(["install.ps1.minisig"])
    expect(expectedReleaseMetadataAssets()).toEqual(["ax-minisign.pub"])
  })

  test("reports missing release assets", () => {
    expect(
      missingReleaseAssets([
        "ax-code-darwin-arm64.zip",
        "ax-code-windows-x64.zip",
        "ax-code-windows-arm64.zip",
        "ax-code-darwin-arm64.zip.minisig",
        "install.ps1",
      ]),
    ).toEqual([
      "ax-code-windows-x64.zip.minisig",
      "ax-code-windows-arm64.zip.minisig",
      "install.ps1.minisig",
      "ax-minisign.pub",
    ])
  })

  test("reports tracked internal files as a release privacy issue", () => {
    expect(trackedInternalPrivacyIssue([])).toBeUndefined()
    expect(
      trackedInternalPrivacyIssue([
        ".internal/prd/private.md",
        ".internal/adr/private.md",
        ".internal/bugs/private.md",
        ".internal/release/private.md",
        ".internal/reports/private.md",
        ".internal/archive/private.md",
      ]),
    ).toBe(
      ".internal files are tracked: .internal/prd/private.md, .internal/adr/private.md, .internal/bugs/private.md, .internal/release/private.md, .internal/reports/private.md, and 1 more. Remove them from git index before publishing.",
    )
  })

  test("parses publish options with safe defaults", () => {
    const options = parsePublishGithubReleaseArgs(
      ["--version", "v5.10.1", "--repo", "owner/repo", "--asset-dir", "/tmp/assets", "--existing-tag", "--skip-watch"],
      {},
      "/repo",
      "/home/ax",
    )

    expect(options.version).toBe("5.10.1")
    expect(options.tag).toBe("v5.10.1")
    expect(options.repo).toBe("owner/repo")
    expect(options.assetDir).toBe("/tmp/assets")
    expect(options.existingTag).toBe(true)
    expect(options.skipWatch).toBe(true)
  })

  test("describes the publish plan", () => {
    const options = parsePublishGithubReleaseArgs(["--version", "5.10.1-beta.1"], {}, "/repo", "/home/ax")
    expect(publishPlan(options)).toEqual([
      "publish v5.10.1-beta.1 to defai-digital/ax-code",
      "create and push annotated release tag",
      "watch release.yml",
      "independently verify release signatures with docs/release/ax-minisign.pub",
      "dispatch install-matrix-smoke.yml channel=windows",
    ])
  })
})
