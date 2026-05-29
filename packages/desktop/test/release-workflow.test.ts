import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "bun:test"

describe("release workflow desktop job", () => {
  test("desktop release scripts rebuild renderer assets before packaging", () => {
    const packageJson = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../package.json"), "utf8")) as {
      scripts?: Record<string, string>
    }

    expect(packageJson.scripts?.["build"]).toStartWith("pnpm --dir ../app run build &&")
    expect(packageJson.scripts?.["package:mac"]).toStartWith("pnpm --dir ../app run build &&")
    expect(packageJson.scripts?.["release:mac"]).toStartWith("pnpm --dir ../app run build &&")
  })

  test("wires macOS desktop release through signing, notarization, update feed, and upload gates", () => {
    const workflow = readFileSync(path.resolve(import.meta.dirname, "../../../.github/workflows/release.yml"), "utf8")

    expect(workflow).toContain("desktop-mac-release:")
    expect(workflow).toContain("runs-on: macos-latest")
    expect(workflow).toContain("APPLE_CERTIFICATE_BASE64")
    expect(workflow).toContain("APPLE_SIGNING_IDENTITY")
    expect(workflow).not.toContain("APPLE_NOTARY_PROFILE")
    expect(workflow).toContain("xcrun notarytool store-credentials")
    expect(workflow).toContain("security default-keychain -s")
    expect(workflow).toContain("AX_CODE_DESKTOP_NOTARY_PROFILE")
    expect(workflow).toContain("APPLE_APP_SPECIFIC_PASSWORD")
    expect(workflow).toContain('NOTARY_ARGS=(--notary-profile "$AX_CODE_DESKTOP_NOTARY_PROFILE")')
    expect(workflow).not.toContain('NOTARY_ARGS=(--apple-id "$APPLE_ID"')
    expect(workflow).not.toContain('--apple-password "$APPLE_APP_SPECIFIC_PASSWORD"')
    expect(workflow).toContain(
      'DESKTOP_UPDATE_FEED_URL="https://github.com/${GITHUB_REPOSITORY}/releases/download/${GITHUB_REF_NAME}/"',
    )
    expect(workflow).toContain("pnpm --dir packages/desktop run release:mac:preflight")
    expect(workflow).toContain("ax-code-release-preflight.json")
    expect(workflow).toContain("pnpm --dir packages/desktop run release:mac")
    expect(workflow).toContain("pnpm --dir packages/desktop run smoke:packaged\n")
    expect(workflow).toContain("pnpm --dir packages/desktop run smoke:renderer\n")
    expect(workflow).toContain("pnpm --dir packages/desktop run smoke:packaged -- --output")
    expect(workflow).toContain("ax-code-desktop-packaged-smoke.json")
    expect(workflow).toContain("pnpm --dir packages/desktop run smoke:renderer")
    expect(workflow).toContain("ax-code-desktop-renderer-smoke.json")
    expect(workflow).toContain("--require-release-pipeline")
    expect(workflow).toContain('--update-manifest-path "$UPDATE_MANIFEST_PATH"')
    expect(workflow).toContain('--release-archive-path "$ARCHIVE_PATH"')
    expect(workflow).toContain("ax-code-release-readiness.json")
    expect(workflow).toContain("gh release upload")
    expect(workflow).toContain("ax-code-update-darwin.json")
    expect(workflow).toContain('"packages/desktop/dist/mac/ax-code-desktop-packaged-smoke.json"')
    expect(workflow).toContain('"packages/desktop/dist/mac/ax-code-desktop-renderer-smoke.json"')
    expect(workflow).toContain("Desktop macOS release skipped")
    expect(workflow.indexOf("pnpm --dir packages/desktop run release:mac --")).toBeLessThan(
      workflow.lastIndexOf("pnpm --dir packages/desktop run smoke:packaged -- --output"),
    )
    expect(workflow.indexOf("pnpm --dir packages/desktop run release:mac --")).toBeLessThan(
      workflow.lastIndexOf("pnpm --dir packages/desktop run smoke:renderer -- --output"),
    )
  })

  test("preserves deterministic test evidence before desktop publication", () => {
    const workflow = readFileSync(path.resolve(import.meta.dirname, "../../../.github/workflows/release.yml"), "utf8")
    const deterministicTestIndex = workflow.indexOf("pnpm --dir packages/ax-code run test:ci -- deterministic")
    const uploadIndex = workflow.indexOf("name: Upload deterministic test report")
    const buildIndex = workflow.indexOf("build:")

    expect(deterministicTestIndex).toBeGreaterThan(-1)
    expect(uploadIndex).toBeGreaterThan(deterministicTestIndex)
    expect(uploadIndex).toBeLessThan(buildIndex)
    expect(workflow).toContain("if: always()")
    expect(workflow).toContain("name: ax-code-deterministic-test-report")
    expect(workflow).toContain("path: packages/ax-code/.tmp/test-report/")
    expect(workflow).toContain("if-no-files-found: warn")
  })
})
