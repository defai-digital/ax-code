import { describe, expect, test } from "vitest"
import path from "path"
import {
  defaultInstallChannel,
  defaultTag,
  expectedReleaseArchives,
  expectedReleaseSignatures,
  isPrerelease,
  missingReleaseAssets,
  normalizeVersion,
  parsePublishGithubReleaseArgs,
  publishPlan,
  trackedInternalPrivacyIssue,
} from "./publish-github-release"

describe("publish-github-release helpers", () => {
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
  })

  test("reports missing release assets", () => {
    expect(
      missingReleaseAssets([
        "ax-code-darwin-arm64.zip",
        "ax-code-windows-x64.zip",
        "ax-code-windows-arm64.zip",
        "ax-code-darwin-arm64.zip.minisig",
      ]),
    ).toEqual(["ax-code-windows-x64.zip.minisig", "ax-code-windows-arm64.zip.minisig"])
  })

  test("reports tracked internal files as a release privacy issue", () => {
    expect(trackedInternalPrivacyIssue([])).toBeUndefined()
    expect(
      trackedInternalPrivacyIssue([
        "ax-internal/prd/private.md",
        "ax-internal/adr/private.md",
        "ax-internal/bugs/private.md",
        "ax-internal/release/private.md",
        "ax-internal/reports/private.md",
        "ax-internal/archive/private.md",
      ]),
    ).toBe(
      "ax-internal files are tracked: ax-internal/prd/private.md, ax-internal/adr/private.md, ax-internal/bugs/private.md, ax-internal/release/private.md, ax-internal/reports/private.md, and 1 more. Remove them from git index before publishing.",
    )
  })

  test("parses publish options with safe defaults", () => {
    const options = parsePublishGithubReleaseArgs(
      [
        "--version",
        "v5.10.1",
        "--repo",
        "owner/repo",
        "--key-dir",
        "~/release-keys",
        "--asset-dir",
        "/tmp/assets",
        "--existing-tag",
        "--skip-watch",
      ],
      {},
      "/repo",
      "/home/ax",
    )

    expect(options.version).toBe("5.10.1")
    expect(options.tag).toBe("v5.10.1")
    expect(options.repo).toBe("owner/repo")
    expect(options.keyDir).toBe(path.join("/home/ax", "release-keys"))
    expect(options.assetDir).toBe("/tmp/assets")
    expect(options.existingTag).toBe(true)
    expect(options.skipWatch).toBe(true)
    expect(options.skipSign).toBe(false)
  })

  test("describes the publish plan", () => {
    const options = parsePublishGithubReleaseArgs(["--version", "5.10.1-beta.1"], {}, "/repo", "/home/ax")
    expect(publishPlan(options)).toEqual([
      "publish v5.10.1-beta.1 to defai-digital/ax-code",
      "create and push annotated release tag",
      "watch release.yml",
      "sign release archives with /home/ax/.minisign/minisign.key",
      "dispatch install-matrix-smoke.yml channel=windows",
    ])
  })
})
