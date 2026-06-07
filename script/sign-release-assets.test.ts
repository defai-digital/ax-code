import { describe, expect, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import {
  defaultKeyPaths,
  expandHome,
  findReleaseAssets,
  minisignPassword,
  parseSignReleaseArgs,
  prepareSignaturePath,
  requirePinnedPublicKey,
  releaseAssetsForOptions,
  secretKeyPermissionIssue,
  sha256File,
  signaturePath,
  trustedComment,
} from "./sign-release-assets"

describe("sign-release-assets helpers", () => {
  test("expands home-relative key paths", () => {
    expect(expandHome("~/signkey", "/home/ax")).toBe(path.join("/home/ax", "signkey"))
    expect(expandHome("relative", "/home/ax")).toBe("relative")
    expect(defaultKeyPaths({}, "/home/ax")).toEqual({
      secretKey: path.join("/home/ax", "signkey", "ax-code.sec"),
      publicKey: path.join("/home/ax", "signkey", "ax-code.pub"),
    })
  })

  test("finds release archives only", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ax-code-sign-assets-"))
    try {
      fs.writeFileSync(path.join(dir, "ax-code-darwin-arm64.zip"), "")
      fs.writeFileSync(path.join(dir, "ax-code-linux-x64.tar.gz"), "")
      fs.writeFileSync(path.join(dir, "ax-code-linux-x64.tar.gz.minisig"), "")
      fs.writeFileSync(path.join(dir, "notes.txt"), "")

      expect(findReleaseAssets(dir).map((file) => path.basename(file))).toEqual([
        "ax-code-darwin-arm64.zip",
        "ax-code-linux-x64.tar.gz",
      ])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test("parses explicit keys, files, and verify mode", () => {
    const options = parseSignReleaseArgs(
      [
        "--key-dir",
        "~/keys",
        "--public-key",
        "~/keys/release.pub",
        "--verify-only",
        "--force",
        "packages/ax-code/dist/ax-code.zip",
      ],
      {},
      "/repo",
      "/home/ax",
    )

    expect(options.secretKey).toBe(path.join("/home/ax", "keys", "ax-code.sec"))
    expect(options.publicKey).toBe(path.join("/home/ax", "keys", "release.pub"))
    expect(options.verifyOnly).toBe(true)
    expect(options.force).toBe(true)
    expect(options.files).toEqual([path.join("/repo", "packages/ax-code/dist/ax-code.zip")])
  })

  test("requires the pinned AX Code minisign public key", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ax-code-sign-public-key-"))
    try {
      const matching = path.join(dir, "ax-code.pub")
      fs.writeFileSync(
        matching,
        [
          "untrusted comment: minisign public key 8138FAD32CAD95BA",
          "RWS6la0s0/o4gdFUZ0Bk/BkrnN8qC2CFOfLXVP5OtQTrvm1BQeOvXgao",
          "",
        ].join("\n"),
      )
      expect(() => requirePinnedPublicKey(matching)).not.toThrow()

      const mismatched = path.join(dir, "other.pub")
      fs.writeFileSync(
        mismatched,
        [
          "untrusted comment: minisign public key 0000000000000000",
          "RWS000000000000000000000000000000000000000000000000000000000",
          "",
        ].join("\n"),
      )
      expect(() => requirePinnedPublicKey(mismatched)).toThrow("does not match the pinned AX Code release key")
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test("uses explicit minisign password before keychain lookup", () => {
    expect(minisignPassword({ AX_CODE_MINISIGN_PASSWORD: "secret" } as NodeJS.ProcessEnv, "darwin")).toBe("secret")
    expect(minisignPassword({} as NodeJS.ProcessEnv, "linux")).toBeUndefined()
  })

  test("uses explicit files before scanning the dist directory", () => {
    const options = parseSignReleaseArgs(["/tmp/asset.tar.gz"], {}, "/repo", "/home/ax")
    expect(releaseAssetsForOptions(options)).toEqual(["/tmp/asset.tar.gz"])
    expect(signaturePath("/tmp/asset.tar.gz")).toBe("/tmp/asset.tar.gz.minisig")
  })

  test("builds trusted comments with the artifact sha256", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ax-code-sign-comment-"))
    try {
      const asset = path.join(dir, "asset.zip")
      fs.writeFileSync(asset, "hello")

      const digest = await sha256File(asset)
      expect(digest).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824")
      expect(trustedComment(asset, digest)).toBe(
        "AX Code release artifact: asset.zip; sha256=2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
      )
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test("does not replace existing signatures unless forced", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ax-code-sign-force-"))
    try {
      const sig = path.join(dir, "asset.zip.minisig")
      fs.writeFileSync(sig, "old")

      expect(() => prepareSignaturePath(sig, { force: false, verifyOnly: false, dryRun: false })).toThrow(
        "Signature already exists",
      )
      prepareSignaturePath(sig, { force: true, verifyOnly: false, dryRun: false })
      expect(fs.existsSync(sig)).toBe(false)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test("requires existing signatures in verify-only mode", () => {
    const missing = path.join(os.tmpdir(), "missing-asset.zip.minisig")
    expect(() => prepareSignaturePath(missing, { force: false, verifyOnly: true, dryRun: false })).toThrow(
      "Signature not found",
    )
  })

  test("flags group or world-readable secret keys on POSIX", () => {
    if (process.platform === "win32") return
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ax-code-sign-secret-"))
    try {
      const secret = path.join(dir, "ax-code.sec")
      fs.writeFileSync(secret, "secret")
      fs.chmodSync(secret, 0o644)

      expect(secretKeyPermissionIssue(secret, "darwin")).toContain("permissions are too open")
      fs.chmodSync(secret, 0o600)
      expect(secretKeyPermissionIssue(secret, "darwin")).toBeUndefined()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
