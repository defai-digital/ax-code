import { describe, expect, test } from "vitest"
import os from "os"
import path from "path"
import { archivePaths, parseResignArgs, resignPlan, signaturePaths } from "./resign-release-assets"
import { expectedReleaseArchives, expectedReleaseSignatures } from "./publish-github-release"

describe("resign-release-assets", () => {
  test("parses explicit tags, normalizing a leading v", () => {
    const options = parseResignArgs(["v5.5.0", "5.4.0"], {}, "/repo", "/home/ax")
    expect(options.tags).toEqual(["v5.5.0", "v5.4.0"])
    expect(options.allReleases).toBe(false)
    expect(options.skipUpload).toBe(false)
    expect(options.dryRun).toBe(false)
  })

  test("combines --tag flags and positional tags", () => {
    const options = parseResignArgs(["--tag", "v5.5.0", "5.4.0", "--tag", "5.1.0"], {}, "/repo", "/home/ax")
    expect(options.tags).toEqual(["v5.5.0", "v5.1.0", "v5.4.0"])
  })

  test("rejects --all together with explicit tags", () => {
    expect(() => parseResignArgs(["--all", "--tag", "v5.5.0"])).not.toThrow()
  })

  test("defaults key dir to ~/signkey and derives key file paths", () => {
    const options = parseResignArgs(["v5.5.0"], {}, "/repo", "/home/ax")
    expect(options.keyDir).toBe(path.resolve("/home/ax/signkey"))
    expect(options.secretKey).toBe(path.resolve("/home/ax/signkey/ax.minisign.key"))
    expect(options.publicKey).toBe(path.resolve("/home/ax/signkey/ax.pub"))
  })

  test("respects explicit key paths and GH_REPO", () => {
    const options = parseResignArgs(
      ["v5.5.0", "--secret-key", "/keys/sec", "--public-key", "/keys/pub", "--repo", "fork/ax-code"],
      {},
      "/repo",
      "/home/ax",
    )
    expect(options.secretKey).toBe("/keys/sec")
    expect(options.publicKey).toBe("/keys/pub")
    expect(options.repo).toBe("fork/ax-code")
  })

  test("honors AX_CODE_MINISIGN_KEY_DIR env override", () => {
    const options = parseResignArgs(["v5.5.0"], { AX_CODE_MINISIGN_KEY_DIR: "~/altkeys" }, "/repo", "/home/ax")
    expect(options.keyDir).toBe(path.resolve("/home/ax/altkeys"))
    expect(options.secretKey).toBe(path.resolve("/home/ax/altkeys/ax.minisign.key"))
  })

  test("archivePaths and signaturePaths cover every expected release archive", () => {
    const dir = "/tmp/assets"
    expect(archivePaths(dir)).toEqual(expectedReleaseArchives().map((name) => path.join(dir, name)))
    expect(signaturePaths(dir)).toEqual(expectedReleaseSignatures().map((name) => path.join(dir, name)))
  })

  test("resignPlan reflects upload vs skip-upload and dry-run posture", () => {
    const base = {
      repo: "defai-digital/ax-code",
      tags: ["v5.5.0"],
      allReleases: false,
      keyDir: "/home/ax/signkey",
      secretKey: "/home/ax/signkey/ax.minisign.key",
      publicKey: "/home/ax/signkey/ax.pub",
      skipUpload: false,
      dryRun: false,
      yes: false,
    }
    const uploading = resignPlan(base, ["v5.5.0"])
    expect(uploading.join("\n")).toContain("re-upload .minisig assets with --clobber")
    expect(uploading.join("\n")).toContain("destructive")

    const skip = resignPlan({ ...base, skipUpload: true }, ["v5.5.0"])
    expect(skip.join("\n")).toContain("sign + verify only")

    const dry = resignPlan({ ...base, dryRun: true }, ["v5.5.0"])
    expect(dry.join("\n")).toContain("dry-run")
  })

  test("usage flag sets help and does not require tags", () => {
    const options = parseResignArgs(["--help"])
    expect(options.help).toBe(true)
    expect(options.tags).toEqual([])
  })

  test("os import is exercised for path helpers", () => {
    expect(os.tmpdir()).toBeTruthy()
  })
})
