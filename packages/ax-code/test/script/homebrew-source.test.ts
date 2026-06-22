import { describe, expect, test } from "vitest"
import path from "path"
import fs from "fs"

const repoRoot = path.resolve(import.meta.dirname, "../../../..")
const homebrewDefaultScript = path.join(repoRoot, ".github/scripts/update-homebrew.sh")
const releaseWorkflow = path.join(repoRoot, ".github/workflows/release.yml")
const installMatrixWorkflow = path.join(repoRoot, ".github/workflows/install-matrix-smoke.yml")
const isolatedHomeScript = path.join(repoRoot, ".github/scripts/set-isolated-home-env.sh")
const filterDispatchChannelScript = path.join(repoRoot, ".github/scripts/filter-dispatch-channel.sh")
const validateInstallMatrixInputsScript = path.join(repoRoot, ".github/scripts/validate-install-matrix-inputs.sh")
const assertRuntimeModeScript = path.join(repoRoot, ".github/scripts/assert-runtime-mode.sh")
const axCodePackageJson = path.join(repoRoot, "packages/ax-code/package.json")
const axCodeCiWorkflow = path.join(repoRoot, ".github/workflows/ax-code-ci.yml")

const retiredNpmDistributionFiles = [
  ".github/scripts/update-homebrew-source.sh",
  ".github/workflows/ax-code-tui-renderer.yml",
  "script/publish.ts",
  "packages/ax-code/bin/ax-code",
  "packages/ax-code/bin/binary-selection.cjs",
  "packages/ax-code/script/build-source.ts",
  "packages/ax-code/script/package-names.ts",
  "packages/ax-code/script/postinstall.mjs",
  "packages/ax-code/script/publish.ts",
  "packages/ax-code/script/publish-plan.ts",
  "packages/ax-code/script/publish-source.ts",
  "packages/ax-code/script/source-install-smoke.ts",
  "packages/ax-code/script/source-package.ts",
]

describe("distribution support guardrails", () => {
  test("npm distribution scripts and source-package workflows have been retired", async () => {
    for (const rel of retiredNpmDistributionFiles) {
      expect(fs.existsSync(path.join(repoRoot, rel)), `${rel} should be removed`).toBe(false)
    }

    const pkg = JSON.parse(await Bun.file(axCodePackageJson).text())
    expect(pkg.bin).toBeUndefined()
    expect(pkg.scripts["bundle:source"]).toBeUndefined()
    expect(pkg.scripts["bundle:source:smoke"]).toBeUndefined()
    expect(pkg.scripts["bundle:source:pack"]).toBeUndefined()
    expect(pkg.scripts["bundle:source:install-smoke"]).toBeUndefined()
    expect(pkg.scripts["bundle:source:tui-smoke"]).toBeUndefined()

    const ci = await Bun.file(axCodeCiWorkflow).text()
    expect(ci).not.toContain("bundle-source:")
    expect(ci).not.toContain("dist-source")
    expect(ci).not.toContain("publish-source")
    expect(ci).not.toContain("source-install-smoke")
  })

  test("default formula installs the node-bundled distribution", async () => {
    const text = await Bun.file(homebrewDefaultScript).text()
    expect(text).toContain("github.com/defai-digital/ax-code/releases/download")
    expect(text).toContain('gh release download "${TAG}"')
    expect(text).toContain('--repo "${SOURCE_REPO}"')
    expect(text).toContain("gh repo clone defai-digital/homebrew-ax-code")
    expect(text).toContain("gh auth setup-git")
    expect(text).toContain("mktemp -d")
    expect(text).not.toContain("x-access-token:${TAP_AUTH_TOKEN}")
    expect(text).toContain('DARWIN_ARM64_ASSET="ax-code-darwin-arm64.zip"')
    // Linux support was dropped: the formula is macOS-arm64 only.
    expect(text).not.toContain("LINUX_")
    expect(text).not.toContain("on_linux")
    expect(text).toContain("depends_on arch: :arm64")
    // node-bundled: install the whole tree into libexec and depend on node, not
    // a single compiled binary. Bun is gone entirely.
    expect(text).toContain('libexec.install Dir["*"]')
    expect(text).toContain('depends_on "node"')
    expect(text).toContain("--experimental-ffi")
    expect(text).not.toContain('bin.install "ax-code"')
    expect(text).not.toContain('depends_on "bun"')
    expect(text).not.toContain("bundle/index.js")
  })

  test("default homebrew update separates release-read and tap-write tokens", async () => {
    const text = await Bun.file(homebrewDefaultScript).text()
    expect(text).toContain('RELEASE_READ_TOKEN="${GH_TOKEN:-}"')
    expect(text).toContain('LEGACY_TAP_AUTH_TOKEN="${TAP_TOKEN:-}"')
    expect(text).toContain('NAMED_TAP_AUTH_TOKEN="${HOMEBREW_TAP_TOKEN:-}"')
    expect(text).toContain('add_tap_token "TAP_TOKEN" "${LEGACY_TAP_AUTH_TOKEN}"')
    expect(text).toContain('add_tap_token "HOMEBREW_TAP_TOKEN" "${NAMED_TAP_AUTH_TOKEN}"')
    expect(text).toContain("HOMEBREW_TAP_TOKEN is not configured; stable releases must update the Homebrew tap")
    expect(text).toContain('add_tap_token "GH_TOKEN" "${GH_TOKEN:-}"')
    expect(text).toContain('export GH_TOKEN="${RELEASE_READ_TOKEN}"')
    expect(text).toContain('export GH_TOKEN="${token}"')
    expect(text).toContain("trying next configured token")
    expect(text).toContain("All configured Homebrew tap tokens failed")
    expect(text.indexOf('export GH_TOKEN="${RELEASE_READ_TOKEN}"')).toBeLessThan(
      text.indexOf('DARWIN_ARM64_SHA="$(download_asset "${DARWIN_ARM64_ASSET}")"'),
    )
    expect(text.indexOf('export GH_TOKEN="${token}"')).toBeGreaterThan(
      text.indexOf('DARWIN_ARM64_SHA="$(download_asset "${DARWIN_ARM64_ASSET}")"'),
    )
  })

  test("release workflow publishes GitHub release assets without package-channel gates", async () => {
    const text = await Bun.file(releaseWorkflow).text()
    const publishJob = text.match(/\n  publish:[\s\S]*$/)
    expect(publishJob).not.toBeNull()
    expect(publishJob![0]).toContain("gh release create")
    expect(publishJob![0]).toContain("gh release upload")
    expect(publishJob![0]).toContain("*.tar.gz.minisig")
    expect(publishJob![0]).toContain("*.zip.minisig")
    expect(publishJob![0]).not.toMatch(/\n\s+--draft(?:\s|\\|$)/)
    expect(text).not.toMatch(/\n  finalize:/)
    expect(text).not.toContain("gh workflow run install-matrix-smoke.yml")
  })

  test("release workflow signs archives with minisign before uploading assets", async () => {
    const text = await Bun.file(releaseWorkflow).text()
    const publishJob = text.match(/\n  publish:[\s\S]*?(?=\n  homebrew:|$)/)
    expect(publishJob).not.toBeNull()
    const job = publishJob![0]
    expect(job).toContain("Setup Ax-code JS toolchain")
    expect(job).toContain("Install minisign")
    expect(job).toContain("brew install minisign")
    expect(job).toContain("Prepare minisign release key")
    expect(job).toContain("AX_CODE_MINISIGN_SECRET_KEY_B64")
    expect(job).toContain("secrets.AX_CODE_MINISIGN_SECRET_KEY_B64")
    expect(job).toContain("chmod 600")
    expect(job).toContain("RWS+dNbWPLZ6W9TH486c9zdH84NiiuFnm4VpVTRlXoMHClyQx/fY7W2A")
    // The passphrase is stored in the macOS Keychain from the secret, then the
    // signing script reads it back via minisignPasswordFromKeychain().
    expect(job).toContain("secrets.AX_CODE_MINISIGN_PASSWORD")
    expect(job).toContain("security add-generic-password")
    expect(job).toContain("ax-code-minisign")
    expect(job).toContain("ax-code-release")
    expect(job).toContain("Clean up Keychain passphrase")
    expect(job).toContain("security delete-generic-password")
    expect(job).toContain("Sign release assets")
    expect(job).toContain("minisignPasswordFromKeychain")
    expect(job).toContain("pnpm exec tsx script/sign-release-assets.ts --dist-dir packages/ax-code/dist")
    expect(job).toContain("missing minisign signature for ${archive}")
    expect(job).toContain("shopt -s nullglob")
    expect(job).toContain("no release assets found to upload")
    expect(job).not.toContain('gh release upload "$TAG" "$f" --clobber || true')
    expect(job.indexOf("Sign release assets")).toBeLessThan(job.indexOf("Create GitHub release"))
    expect(job.indexOf("Sign release assets")).toBeLessThan(job.indexOf("Upload release assets"))
  })

  test("release workflow auto-publishes the Homebrew tap but never npm", async () => {
    const text = await Bun.file(releaseWorkflow).text()
    // npm/source distribution stays retired.
    expect(text).not.toMatch(/\n  publish-npm:/)
    expect(text).not.toMatch(/\n  publish-source:/)
    expect(text).not.toMatch(/\n  homebrew-source:/)
    expect(text).not.toContain("NPM_TOKEN")
    expect(text).not.toContain("NPM_CONFIG_PROVENANCE")
    expect(text).not.toContain("bun run script/publish.ts")
    expect(text).not.toContain("bun run script/publish-source.ts")
    expect(text).not.toContain("update-homebrew-source.sh")
    expect(text).toContain("npm distribution")
    expect(text).toContain("no longer supported")
    // Homebrew is published automatically (stable releases only) via the tap PAT.
    expect(text).toMatch(/\n  homebrew:/)
    expect(text).toContain("bash .github/scripts/update-homebrew.sh")
    expect(text).toContain("secrets.HOMEBREW_TAP_TOKEN")
    expect(text).toContain("secrets.TAP_TOKEN")
    expect(text).not.toContain("secrets.HOMEBREW_TAP_TOKEN || secrets.TAP_TOKEN")
    expect(text).toContain("TAP_TOKEN")
    expect(text).toContain("HOMEBREW_TAP_TOKEN")
    expect(text).toContain("!contains(github.ref_name, '-')")
  })

  test("install matrix is dispatch-only so release.published cannot race package publication", async () => {
    const text = await Bun.file(installMatrixWorkflow).text()
    expect(text).toContain("permissions:")
    expect(text).toContain("contents: read")
    expect(text).toContain("uses: actions/checkout@v7")
    expect(text).toContain("workflow_dispatch:")
    expect(text).not.toContain("types: [published]")
    expect(text).not.toMatch(/\n  release:\n/)
    expect(text).not.toContain("release workflow dispatches")
  })

  test("install matrix supports Homebrew and Windows without npm package installs", async () => {
    const text = await Bun.file(installMatrixWorkflow).text()
    const filterDispatchChannel = await Bun.file(filterDispatchChannelScript).text()
    const validateInputs = await Bun.file(validateInstallMatrixInputsScript).text()
    // Linux support was dropped: no curl/linux smoke legs remain.
    expect(text).not.toContain("- curl")
    expect(text).not.toContain("ubuntu")
    expect(text).toContain("- homebrew")
    expect(text).toContain("- windows")
    expect(text).toContain("brew install defai-digital/ax-code/ax-code")
    expect(text).toContain("./install.ps1 -Version $Version -NoModifyPath")
    expect(text).toContain("windows-2022")
    expect(text).toContain("windows-11-arm")
    expect(text).toContain('bash .github/scripts/assert-ax-code-version.sh "$VERSION"')
    expect(text).toContain("Smoke - installed backend stdio handshake")
    expect(text).toContain("tui-backend --stdio")
    expect(text).toContain("id: channel")
    expect(filterDispatchChannel).toContain("enabled=false")
    expect(filterDispatchChannel).toContain('"all"')
    expect(validateInputs).toContain("all|homebrew|windows")
    expect(text).toContain("steps.channel.outputs.enabled == 'true'")
    expect(text).toContain('bash .github/scripts/assert-runtime-mode.sh "homebrew" doctor')
    expect(text).toContain('bash .github/scripts/assert-runtime-mode.sh "homebrew" backend')
    // The literal runtimeMode assertion now lives in the shared assert script
    // (invoked above), which maps every non-source channel — Homebrew included —
    // to the node-bundled runtime. With Bun fully removed, macOS arm64 now ships
    // the same node-bundled distribution as the Windows legs.
    const assertRuntimeMode = await Bun.file(assertRuntimeModeScript).text()
    expect(assertRuntimeMode).toContain("RUNTIME_RE='node-bundled'")
    expect(assertRuntimeMode).toContain('PATTERN="\\"runtimeMode\\":\\"${RUNTIME_RE}\\""')
    expect(text).not.toContain("npm install -g")
    expect(text).not.toContain("npm view")
    expect(text).not.toContain("@defai.digital/ax-code")
    expect(text).not.toContain("ax-code-source")
  })

  test("install matrix smokes supported installers with isolated runtime homes", async () => {
    const text = await Bun.file(installMatrixWorkflow).text()
    const isolatedHome = await Bun.file(isolatedHomeScript).text()
    const homebrewJob = text.match(/homebrew:[\s\S]*?(?=\n  windows:|$)/)
    expect(homebrewJob).not.toBeNull()
    expect(homebrewJob![0]).toContain("set-isolated-home-env.sh")

    const windowsJob = text.match(/windows:[\s\S]*$/)
    expect(windowsJob).not.toBeNull()
    expect(windowsJob![0]).toContain("set-isolated-home-env.sh")

    expect(isolatedHome).toContain("AX_CODE_TEST_HOME")
    expect(isolatedHome).toContain("XDG_CONFIG_HOME")
    expect(isolatedHome).toContain("XDG_DATA_HOME")
    expect(text).toContain("AX_CODE_DISABLE_PROJECT_CONFIG")
    expect(text).toContain("AX_CODE_DISABLE_MODELS_FETCH")
  })

  test("install matrix refreshes the Homebrew tap while waiting for formula propagation", async () => {
    const text = await Bun.file(installMatrixWorkflow).text()
    const homebrewStep = text.match(/Install ax-code from Homebrew tap[\s\S]*?(?=\n      - name: ax-code --version|$)/)
    expect(homebrewStep).not.toBeNull()
    expect(homebrewStep![0]).toContain("brew update 2>&1 || true")
    expect(homebrewStep![0]).toContain("brew tap defai-digital/ax-code 2>&1 || true")
    expect(homebrewStep![0]).toContain('BREW_INFO="$(brew info defai-digital/ax-code/ax-code 2>&1 || true)"')
    expect(homebrewStep![0]).toContain('[[ "$BREW_INFO" == *"stable ${VERSION}"* ]]')
    expect(homebrewStep![0]).not.toContain("brew info defai-digital/ax-code/ax-code 2>&1 | grep -q")
    expect(homebrewStep![0]).not.toContain("brew update\n")
  })

  test("release build matrix smokes each runtime via doctor", async () => {
    const text = await Bun.file(releaseWorkflow).text()
    const buildJob = text.match(/build:[\s\S]*?(?=\n  publish:|$)/)
    expect(buildJob).not.toBeNull()
    expect(buildJob![0]).toContain("AX_CODE_TEST_HOME")
    expect(buildJob![0]).toContain("XDG_CONFIG_HOME")
    expect(buildJob![0]).toContain("XDG_DATA_HOME")
    expect(buildJob![0]).toContain("AX_CODE_DISABLE_PROJECT_CONFIG")
    expect(buildJob![0]).toContain("AX_CODE_DISABLE_MODELS_FETCH")
    // The smoke leg no longer drives a tui-backend stdio handshake; it runs
    // `doctor` and greps the reported runtime against the per-leg matrix value.
    // With Bun removed, every leg (macOS + Windows) ships node-bundled — verified
    // by the same generic step.
    expect(buildJob![0]).toContain("Smoke — release runtime")
    expect(buildJob![0]).toContain("smoke-bin:")
    expect(buildJob![0]).toContain('BIN="${{ matrix.smoke-bin }}"')
    expect(buildJob![0]).toContain("smoke-runtime: node-bundled")
    expect(buildJob![0]).not.toContain("smoke-runtime: compiled")
    expect(buildJob![0]).not.toContain("find dist -path")
    expect(buildJob![0]).toContain('grep -E "Runtime: .* \\(${{ matrix.smoke-runtime }}\\)"')
  })
})
