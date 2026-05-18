import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs"

const repoRoot = path.resolve(import.meta.dir, "../../../..")
const homebrewSourceScript = path.join(repoRoot, ".github/scripts/update-homebrew-source.sh")
const homebrewDefaultScript = path.join(repoRoot, ".github/scripts/update-homebrew.sh")
const releaseWorkflow = path.join(repoRoot, ".github/workflows/release.yml")
const installMatrixWorkflow = path.join(repoRoot, ".github/workflows/install-matrix-smoke.yml")
const isolatedHomeScript = path.join(repoRoot, ".github/scripts/set-isolated-home-env.sh")
const filterDispatchChannelScript = path.join(repoRoot, ".github/scripts/filter-dispatch-channel.sh")

describe("homebrew source formula generator", () => {
  test("script exists and is executable", () => {
    expect(fs.existsSync(homebrewSourceScript)).toBe(true)
    const stat = fs.statSync(homebrewSourceScript)
    // Owner exec bit
    expect(stat.mode & 0o100).toBe(0o100)
  })

  test("generates a formula named AxCodeSource with depends_on bun", async () => {
    const text = await Bun.file(homebrewSourceScript).text()
    expect(text).toContain("class AxCodeSource < Formula")
    expect(text).toContain('depends_on "bun"')
    expect(text).toContain('depends_on "ripgrep"')
  })

  test("source formula points at npm registry tarball, not GitHub release asset", async () => {
    // The compiled formula downloads platform tarballs from GitHub
    // releases. The source formula must pull from the npm registry where
    // publish-source.ts uploads, otherwise the formula references a
    // tarball that does not exist.
    const text = await Bun.file(homebrewSourceScript).text()
    expect(text).toContain('SOURCE_PACKAGE_PATH="@defai.digital/ax-code-source"')
    expect(text).toContain('SOURCE_TARBALL_NAME="ax-code-source"')
    expect(text).toContain("registry.npmjs.org/${SOURCE_PACKAGE_PATH}/-/${SOURCE_TARBALL_NAME}-${VERSION}.tgz")
    expect(text).not.toContain("github.com/defai-digital/ax-code/releases/download")
  })

  test("retries npm registry fetch to handle CDN propagation lag", async () => {
    // Right after manual source-package publish, the npm CDN can take a few
    // seconds to serve the tarball. Without retry the manual Homebrew source
    // update would fail intermittently.
    const text = await Bun.file(homebrewSourceScript).text()
    expect(text).toContain("max_attempts")
    expect(text).toMatch(/sleep\s+\d+/)
  })

  test("computes sha256 cross-platform (sha256sum or shasum -a 256)", async () => {
    // Linux runners have sha256sum, macOS runners have shasum.
    const text = await Bun.file(homebrewSourceScript).text()
    expect(text).toContain("sha256sum")
    expect(text).toContain("shasum -a 256")
  })

  test("brew shim execs bun against bundle/index.js with AX_CODE_ORIGINAL_CWD set", async () => {
    // The shim must match the npm-distribution shim's behavior so the
    // CLI's --project resolution sees the user's actual cwd, not the
    // brew libexec install location.
    const text = await Bun.file(homebrewSourceScript).text()
    expect(text).toContain("AX_CODE_ORIGINAL_CWD")
    expect(text).toContain("bundle/index.js")
    expect(text).toContain('Formula["bun"].opt_bin')
  })

  test("formula filename and class name are ax-code-source / AxCodeSource (compatibility alias)", async () => {
    const text = await Bun.file(homebrewSourceScript).text()
    expect(text).toContain("ax-code-source.rb")
    expect(text).toContain("tracks compiled release assets")
    expect(text).not.toContain("The default \\`ax-code\\` formula now uses the same source+bun runtime.")
    expect(text).not.toContain("> /tmp/ax-code.rb")
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
    expect(text).toContain('LINUX_ARM64_ASSET="ax-code-linux-arm64.tar.gz"')
    expect(text).toContain('LINUX_X64_ASSET="ax-code-linux-x64-baseline.tar.gz"')
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
      text.indexOf('LINUX_X64_SHA="$(download_asset "${LINUX_X64_ASSET}")"'),
    )
  })

  test("manual homebrew scripts keep tap credential handling outside release workflow", async () => {
    const text = await Bun.file(releaseWorkflow).text()
    const sourceScript = await Bun.file(homebrewSourceScript).text()
    expect(sourceScript).toContain("gh repo clone defai-digital/homebrew-ax-code")
    expect(sourceScript).toContain("gh auth setup-git")
    expect(sourceScript).toContain("mktemp -d")
    expect(sourceScript).not.toContain("x-access-token:${TAP_AUTH_TOKEN}")
    expect(text).not.toContain("TAP_TOKEN")
    expect(text).not.toContain("update-homebrew.sh")
    expect(text).not.toContain("update-homebrew-source.sh")
  })

  test("release workflow does not automatically publish Homebrew formulae", async () => {
    const text = await Bun.file(releaseWorkflow).text()
    expect(text).not.toMatch(/\n  homebrew:/)
    expect(text).not.toMatch(/\n  homebrew-source:/)
    expect(text).not.toContain("defai-digital/homebrew-ax-code")
    expect(text).toContain("npm and Homebrew publishing")
    expect(text).toContain("manual")
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

  test("release workflow does not automatically publish npm packages", async () => {
    const text = await Bun.file(releaseWorkflow).text()
    expect(text).not.toMatch(/\n  publish-npm:/)
    expect(text).not.toMatch(/\n  publish-source:/)
    expect(text).not.toContain("NPM_TOKEN")
    expect(text).not.toContain("NPM_CONFIG_PROVENANCE")
    expect(text).not.toContain("bun run script/publish.ts")
    expect(text).not.toContain("bun run script/publish-source.ts")
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

  test("install matrix installs exact package versions, not stale dist-tags", async () => {
    const text = await Bun.file(installMatrixWorkflow).text()
    const filterDispatchChannel = await Bun.file(filterDispatchChannelScript).text()
    expect(text).toContain('PACKAGE="@defai.digital/ax-code-source"')
    expect(text).toContain('PACKAGE="@defai.digital/ax-code"')
    expect(text).toContain('npm install -g "${PACKAGE}@${VERSION}"')
    expect(text).toContain('bash .github/scripts/assert-ax-code-version.sh "$VERSION"')
    expect(text).toContain("Smoke — installed backend stdio handshake")
    expect(text).toContain("tui-backend --stdio")
    expect(text).toContain("id: channel")
    expect(filterDispatchChannel).toContain("enabled=false")
    expect(text).toContain("steps.channel.outputs.enabled == 'true'")
    expect(text).toContain('bash .github/scripts/assert-runtime-mode.sh "${{ matrix.channel }}" doctor')
    expect(text).toContain('bash .github/scripts/assert-runtime-mode.sh "${{ matrix.channel }}" backend')
    expect(text).toContain('bash .github/scripts/assert-runtime-mode.sh "latest" doctor homebrew')
    expect(text).toContain('bash .github/scripts/assert-runtime-mode.sh "latest" backend homebrew')
    expect(text).not.toContain("@defai.digital/ax-code@$CHANNEL")
  })

  test("install matrix smokes installed packages with isolated runtime homes", async () => {
    const text = await Bun.file(installMatrixWorkflow).text()
    const isolatedHome = await Bun.file(isolatedHomeScript).text()
    const smokeJob = text.match(/smoke:[\s\S]*?(?=\n  homebrew:|$)/)
    expect(smokeJob).not.toBeNull()
    expect(smokeJob![0]).toContain("set-isolated-home-env.sh")

    const homebrewJob = text.match(/homebrew:[\s\S]*$/)
    expect(homebrewJob).not.toBeNull()
    expect(homebrewJob![0]).toContain("set-isolated-home-env.sh")

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

  test("manual npm publish scripts remain available outside release workflow", async () => {
    const text = await Bun.file(releaseWorkflow).text()
    expect(fs.existsSync(path.join(repoRoot, "packages/ax-code/script/publish.ts"))).toBe(true)
    expect(fs.existsSync(path.join(repoRoot, "packages/ax-code/script/publish-source.ts"))).toBe(true)
    expect(text).not.toContain("script/publish.ts")
    expect(text).not.toContain("script/publish-source.ts")
  })
})
