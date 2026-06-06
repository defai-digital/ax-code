import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs"

const repoRoot = path.resolve(import.meta.dir, "../../../..")
const homebrewDefaultScript = path.join(repoRoot, ".github/scripts/update-homebrew.sh")
const releaseWorkflow = path.join(repoRoot, ".github/workflows/release.yml")
const installMatrixWorkflow = path.join(repoRoot, ".github/workflows/install-matrix-smoke.yml")
const isolatedHomeScript = path.join(repoRoot, ".github/scripts/set-isolated-home-env.sh")
const filterDispatchChannelScript = path.join(repoRoot, ".github/scripts/filter-dispatch-channel.sh")
const validateInstallMatrixInputsScript = path.join(repoRoot, ".github/scripts/validate-install-matrix-inputs.sh")
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

  test("default formula points at compiled GitHub release assets", async () => {
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
    expect(text).toContain('bin.install "ax-code"')
    expect(text).not.toContain('depends_on "bun"')
    expect(text).not.toContain("bundle/index.js")
  })

  test("default homebrew update separates release-read and tap-write tokens", async () => {
    const text = await Bun.file(homebrewDefaultScript).text()
    expect(text).toContain('RELEASE_READ_TOKEN="${GH_TOKEN:-}"')
    expect(text).toContain('TAP_AUTH_TOKEN="${TAP_TOKEN:-${GH_TOKEN:-}}"')
    expect(text).toContain('export GH_TOKEN="${RELEASE_READ_TOKEN}"')
    expect(text).toContain('export GH_TOKEN="${TAP_AUTH_TOKEN}"')
    expect(text.indexOf('export GH_TOKEN="${RELEASE_READ_TOKEN}"')).toBeLessThan(
      text.indexOf('DARWIN_ARM64_SHA="$(download_asset "${DARWIN_ARM64_ASSET}")"'),
    )
    expect(text.indexOf('export GH_TOKEN="${TAP_AUTH_TOKEN}"')).toBeGreaterThan(
      text.indexOf('DARWIN_ARM64_SHA="$(download_asset "${DARWIN_ARM64_ASSET}")"'),
    )
  })

  test("release workflow publishes GitHub release assets without package-channel gates", async () => {
    const text = await Bun.file(releaseWorkflow).text()
    const publishJob = text.match(/\n  publish:[\s\S]*$/)
    expect(publishJob).not.toBeNull()
    expect(publishJob![0]).toContain("gh release create")
    expect(publishJob![0]).toContain("gh release upload")
    expect(publishJob![0]).not.toMatch(/\n\s+--draft(?:\s|\\|$)/)
    expect(text).not.toMatch(/\n  finalize:/)
    expect(text).not.toContain("gh workflow run install-matrix-smoke.yml")
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
    expect(text).toContain("TAP_TOKEN")
    expect(text).toContain("!contains(github.ref_name, '-')")
  })

  test("install matrix is dispatch-only so release.published cannot race package publication", async () => {
    const text = await Bun.file(installMatrixWorkflow).text()
    expect(text).toContain("permissions:")
    expect(text).toContain("contents: read")
    expect(text).toContain("uses: actions/checkout@v6")
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
    expect(text).toContain('"runtimeMode":"compiled"')
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

  test("release build matrix smokes compiled backend stdio handshake", async () => {
    const text = await Bun.file(releaseWorkflow).text()
    const buildJob = text.match(/build:[\s\S]*?(?=\n  publish:|$)/)
    expect(buildJob).not.toBeNull()
    expect(buildJob![0]).toContain("AX_CODE_TEST_HOME")
    expect(buildJob![0]).toContain("XDG_CONFIG_HOME")
    expect(buildJob![0]).toContain("XDG_DATA_HOME")
    expect(buildJob![0]).toContain("AX_CODE_DISABLE_PROJECT_CONFIG")
    expect(buildJob![0]).toContain("AX_CODE_DISABLE_MODELS_FETCH")
    expect(buildJob![0]).toContain("Smoke — compiled backend stdio handshake")
    expect(buildJob![0]).toContain("smoke-bin:")
    expect(buildJob![0]).toContain('BIN="${{ matrix.smoke-bin }}"')
    expect(buildJob![0]).not.toContain("find dist -path")
    expect(buildJob![0]).toContain("tui-backend --stdio")
    expect(buildJob![0]).toContain('"runtimeMode":"compiled"')
  })
})
