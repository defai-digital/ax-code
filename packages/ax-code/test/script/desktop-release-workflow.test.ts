import { describe, expect, test } from "vitest"
import path from "path"
import { readFile } from "node:fs/promises"

const repoRoot = path.resolve(import.meta.dirname, "../../../..")
const desktopReleaseWorkflow = path.join(repoRoot, ".github/workflows/desktop-release.yml")
const sdkBuildScript = path.join(repoRoot, "packages/sdk/js/script/build.ts")

describe("desktop release workflow", () => {
  test("attaches the shared changelog section as GitHub release notes", async () => {
    const text = await readFile(desktopReleaseWorkflow, "utf-8")
    const job = text.match(/  create-release:[\s\S]*?(?=\n  package-web:|$)/)

    expect(job, "create-release job should exist").not.toBeNull()
    expect(job![0]).toContain("node script/extract-changelog-notes.mjs")
    expect(job![0]).toContain("--channel desktop")
    expect(job![0]).toContain("--out artifacts/desktop-release-notes.md")
    expect(job![0]).toContain("name: AX Code Desktop v${{ steps.version.outputs.version }}")
    expect(job![0]).toContain("body_path: artifacts/desktop-release-notes.md")
    expect(job![0]).toContain("generate_release_notes: false")
    expect(job![0]).not.toContain("changelog.split(/^## /m)")
  })

  test("build jobs generate the SDK before packaging Desktop artifacts", async () => {
    const text = await readFile(desktopReleaseWorkflow, "utf-8")

    for (const jobName of ["package-web", "build-macos", "build-windows"]) {
      const nextJob =
        jobName === "package-web" ? "build-macos" : jobName === "build-macos" ? "build-windows" : "sign-release-assets"
      const job = text.match(new RegExp(`  ${jobName}:[\\s\\S]*?(?=\\n  ${nextJob}:|$)`))
      expect(job, `${jobName} job should exist`).not.toBeNull()
      expect(job![0]).toContain("pnpm --dir packages/sdk/js run build")
      expect(job![0].indexOf("pnpm --dir packages/sdk/js run build")).toBeLessThan(
        job![0].indexOf(
          jobName === "package-web" ? "pnpm run desktop:build" : "pnpm --filter @ax-code/electron run build",
        ),
      )
    }
  })

  test("SDK build script avoids platform-specific .bin shims", async () => {
    const text = await readFile(sdkBuildScript, "utf-8")

    expect(text).toContain('packageBin("typescript", "tsc")')
    expect(text).toContain("process.execPath")
    expect(text).not.toContain("node_modules/.bin")
    expect(text).not.toContain('node_modules", ".bin"')
  })

  test("SDK build script serializes shared generated outputs", async () => {
    const text = await readFile(sdkBuildScript, "utf-8")
    const lock = text.indexOf("const releaseBuildLock = await acquireBuildLock()")
    const tmp = text.indexOf('await fs.mkdir(path.join(tmp, "data")')
    const openapi = text.indexOf('toFile: path.join(dir, "openapi.json")')
    const client = text.indexOf('await generateClient("./src/gen")')
    const cleanup = text.indexOf("await releaseBuildLock()")

    expect(lock).toBeGreaterThan(-1)
    expect(tmp).toBeGreaterThan(lock)
    expect(openapi).toBeGreaterThan(lock)
    expect(client).toBeGreaterThan(lock)
    expect(cleanup).toBeGreaterThan(client)
  })

  test("Desktop cask token does not collide with the ax-code CLI formula", async () => {
    const text = await readFile(desktopReleaseWorkflow, "utf-8")

    // Homebrew refuses to link a formula while an installed cask shares its
    // token, so a cask published as "ax-code" removes the ax-code CLI from
    // PATH on every formula upgrade (issue #342). The Desktop cask must ship
    // as "ax-code-desktop" and merge a cask_renames.json entry so existing
    // installs migrate without overwriting shared-tap metadata.
    expect(text).toContain(`'cask "ax-code-desktop" do'`)
    expect(text).not.toContain(`'cask "ax-code" do'`)
    expect(text).not.toContain("replacement_cask")
    expect(text).toContain('"defai-digital/homebrew-tap" "homebrew-tap"')
    expect(text).toContain('"defai-digital/homebrew-ax-code-desktop" "legacy-homebrew-tap"')
    expect(text).toContain("renames['ax-code'] = 'ax-code-desktop'")
    expect(text).toContain("Object.keys(renames).sort()")
    expect(text).toContain("cask_renames.json")
    expect(text).toContain("'  depends_on arch: :arm64'")
    expect(text).toContain("'  depends_on macos: :monterey'")
    expect(text).toContain("'    regex(/^desktop-v?(\\\\d+(?:\\\\.\\\\d+)+)$/i)'")
    expect(text).toContain("git pull --rebase origin main")
    expect(text).toContain("git push origin HEAD:main")
    expect(text).toContain("secrets.HOMEBREW_TAP_TOKEN != '' || secrets.TAP_TOKEN != ''")
    expect(text).toContain("secrets.HOMEBREW_TAP_TOKEN || secrets.TAP_TOKEN")
    expect(text).toContain("refusing to publish Desktop without updating Homebrew")
    expect(text).not.toContain("skipping Desktop Homebrew cask update")
  })

  test("signing job prefers the shared minisign release secrets", async () => {
    const text = await readFile(desktopReleaseWorkflow, "utf-8")
    const job = text.match(/  sign-release-assets:[\s\S]*?(?=\n  verify-release-assets:|$)/)

    expect(job, "sign-release-assets job should exist").not.toBeNull()
    expect(job![0]).toContain(
      "secrets.AX_CODE_MINISIGN_SECRET_KEY_B64 || secrets.AX_CODE_DESKTOP_MINISIGN_SECRET_KEY_B64",
    )
    expect(job![0]).toContain("secrets.AX_CODE_MINISIGN_PASSWORD || secrets.AX_CODE_DESKTOP_MINISIGN_PASSWORD")
    expect(job![0]).toContain("Install minisign")
    expect(job![0]).toContain("cp install.ps1 release-assets/install.ps1")
    expect(job![0]).toContain("Sign release assets")
    expect(job![0]).toContain("node script/github-release-assets.mjs upload")
    expect(job![0]).toContain("release-assets/install.ps1")
    expect(job![0]).toContain("docs/release/ax-minisign.pub")
  })

  test("publishes only after independent Apple and Minisign verification", async () => {
    const text = await readFile(desktopReleaseWorkflow, "utf-8")
    const releaseActionUses = text.match(/uses: softprops\/action-gh-release@/g) ?? []
    const draftReleaseFlags = text.match(/^\s+draft: true$/gm) ?? []

    expect(text).toContain("codesign --verify --deep --strict")
    expect(text).toContain("TeamIdentifier=${APPLE_TEAM_ID}")
    expect(text).toContain('codesign --force --timestamp --sign "$AX_CODE_APPLE_CODESIGN_IDENTITY" "$DMG"')
    expect(text).toContain("spctl --assess --type open --context context:primary-signature")
    expect(text).not.toContain("spctl --assess --type install")
    expect(text).toContain("spctl --assess --type execute")
    // softprops creates exactly one draft. Artifact producers use the
    // resumable helper so an interrupted release can safely replace draft
    // assets without creating competing releases.
    expect(releaseActionUses).toHaveLength(1)
    expect(draftReleaseFlags).toHaveLength(releaseActionUses.length)
    expect(text.match(/node script\/github-release-assets\.mjs upload/g) ?? []).toHaveLength(8)

    const verifyJob = text.match(/  verify-release-assets:[\s\S]*?(?=\n  finalize-release:|$)/)
    expect(verifyJob, "verify-release-assets job should exist").not.toBeNull()
    expect(verifyJob![0]).toContain("cmp docs/release/ax-minisign.pub release-assets/ax-minisign.pub")
    expect(verifyJob![0]).toContain("minisign -V -p docs/release/ax-minisign.pub")
    expect(verifyJob![0]).toContain('test -f "$signature"')

    const finalizeJob = text.match(/  finalize-release:[\s\S]*?(?=\n  update-homebrew-tap:|$)/)
    expect(finalizeJob, "finalize-release job should exist").not.toBeNull()
    expect(finalizeJob![0]).toContain("verify-release-assets")
    expect(finalizeJob![0]).toContain("actions/checkout@v7")
    expect(text).toContain("release $TAG is already published; refusing to replace verified assets")
    expect(finalizeJob![0]).toContain("node script/github-release-assets.mjs publish")
    expect(finalizeJob![0]).not.toContain('gh release edit "$TAG"')
  })

  test("signs the Desktop disk image before notarizing and stapling it", async () => {
    const text = await readFile(desktopReleaseWorkflow, "utf-8")
    const job = text.match(/  build-macos:[\s\S]*?(?=\n  build-windows:|$)/)

    expect(job, "build-macos job should exist").not.toBeNull()
    const macosJob = job![0]
    const sign = macosJob.indexOf('codesign --force --timestamp --sign "$AX_CODE_APPLE_CODESIGN_IDENTITY" "$DMG"')
    const notarize = macosJob.indexOf('xcrun notarytool submit "$DMG"')
    const staple = macosJob.indexOf('xcrun stapler staple "$DMG"')
    const assess = macosJob.indexOf("spctl --assess --type open --context context:primary-signature")
    const refresh = macosJob.indexOf("refresh-macos-update-metadata.mjs")

    expect(macosJob).toContain("No Developer ID Application identity found in imported Apple certificate.")
    expect(macosJob).toContain("Developer ID identity does not match APPLE_TEAM_ID.")
    expect(sign).toBeGreaterThan(-1)
    expect(notarize).toBeGreaterThan(sign)
    expect(staple).toBeGreaterThan(notarize)
    expect(assess).toBeGreaterThan(staple)
    expect(refresh).toBeGreaterThan(assess)
  })

  test("verifies the Minisign signature before trusting the Homebrew DMG", async () => {
    const text = await readFile(desktopReleaseWorkflow, "utf-8")
    const job = text.match(/  update-homebrew-tap:[\s\S]*$/)

    expect(job, "update-homebrew-tap job should exist").not.toBeNull()
    expect(job![0]).toContain("release.dmg.minisig")
    expect(job![0]).toContain("minisign -V -p docs/release/ax-minisign.pub")
    expect(job![0].indexOf("minisign -V")).toBeLessThan(job![0].indexOf("DMG_SHA256"))
    expect(job![0]).not.toContain("/usr/bin/xattr")
  })
})
