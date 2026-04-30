import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs"

const repoRoot = path.resolve(import.meta.dir, "../../../..")
const homebrewSourceScript = path.join(repoRoot, ".github/scripts/update-homebrew-source.sh")
const homebrewDefaultScript = path.join(repoRoot, ".github/scripts/update-homebrew.sh")
const releaseWorkflow = path.join(repoRoot, ".github/workflows/release.yml")
const installMatrixWorkflow = path.join(repoRoot, ".github/workflows/install-matrix-smoke.yml")

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
    // Right after publish-source, the npm CDN can take a few seconds to
    // serve the tarball. Without retry the homebrew-source job would
    // fail intermittently on every release.
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
    expect(text).toContain('DARWIN_ARM64_ASSET="ax-code-darwin-arm64.zip"')
    expect(text).toContain('LINUX_ARM64_ASSET="ax-code-linux-arm64.tar.gz"')
    expect(text).toContain('LINUX_X64_ASSET="ax-code-linux-x64-baseline.tar.gz"')
    expect(text).toContain("depends_on arch: :arm64")
    expect(text).toContain('bin.install "ax-code"')
    expect(text).not.toContain('depends_on "bun"')
    expect(text).not.toContain("bundle/index.js")
  })

  test("homebrew-source job exists in release.yml gated after default homebrew", async () => {
    // The compatibility alias should run after the default formula update so
    // tap pushes are serialized.
    const text = await Bun.file(releaseWorkflow).text()
    expect(text).toContain("homebrew-source:")
    const jobMatch = text.match(/homebrew-source:[\s\S]*?(?=\n  \w+:|\n\Z|$)/)
    expect(jobMatch).not.toBeNull()
    expect(jobMatch![0]).toContain("- homebrew")
    expect(jobMatch![0]).toContain("- publish-source")
  })

  test("homebrew-source job skipped on prerelease tags (matches existing homebrew job)", async () => {
    const text = await Bun.file(releaseWorkflow).text()
    const jobMatch = text.match(/homebrew-source:[\s\S]*?(?=\n  \w+:|\n\Z|$)/)
    expect(jobMatch).not.toBeNull()
    expect(jobMatch![0]).toContain("!contains(github.ref_name, '-')")
  })

  test("release workflow publishes GitHub release only after package channels are ready", async () => {
    const text = await Bun.file(releaseWorkflow).text()
    const publishJob = text.match(/publish:[\s\S]*?(?=\n  publish-npm:|$)/)
    expect(publishJob).not.toBeNull()
    expect(publishJob![0]).toContain("gh release create")
    expect(publishJob![0]).toContain("--draft")

    const finalizeJob = text.match(/finalize:[\s\S]*?(?=\n  \w+:|\n\Z|$)/)
    expect(finalizeJob).not.toBeNull()
    expect(finalizeJob![0]).toContain("- publish-npm")
    expect(finalizeJob![0]).toContain("- publish-source")
    expect(finalizeJob![0]).toContain("- homebrew")
    expect(finalizeJob![0]).toContain("- homebrew-source")
    expect(finalizeJob![0]).toContain("always() && !cancelled()")
    expect(finalizeJob![0]).toContain('gh release edit "${{ github.ref_name }}" --draft=false')
  })

  test("install matrix installs exact package versions, not stale dist-tags", async () => {
    const text = await Bun.file(installMatrixWorkflow).text()
    expect(text).toContain('PACKAGE="@defai.digital/ax-code-source"')
    expect(text).toContain('PACKAGE="@defai.digital/ax-code"')
    expect(text).toContain('npm install -g "${PACKAGE}@${VERSION}"')
    expect(text).toContain('OUTPUT="$(ax-code --version)"')
    expect(text).toContain("expected ax-code --version to be ${VERSION}")
    expect(text).toContain("Smoke — installed backend stdio handshake")
    expect(text).toContain("tui-backend --stdio")
    expect(text).toContain("id: channel")
    expect(text).toContain("enabled=false")
    expect(text).toContain("steps.channel.outputs.enabled == 'true'")
    expect(text).toContain("RUNTIME_RE='(bun-bundled|source)'")
    expect(text).toContain('\\"runtimeMode\\":\\"${RUNTIME_RE}\\"')
    expect(text).toContain("RUNTIME_RE='compiled'")
    expect(text).not.toContain("@defai.digital/ax-code@$CHANNEL")
  })

  test("install matrix refreshes the Homebrew tap while waiting for formula propagation", async () => {
    const text = await Bun.file(installMatrixWorkflow).text()
    const homebrewStep = text.match(/Install ax-code from Homebrew tap[\s\S]*?(?=\n      - name: ax-code --version|$)/)
    expect(homebrewStep).not.toBeNull()
    expect(homebrewStep![0]).toContain("brew update 2>&1 || true")
    expect(homebrewStep![0]).toContain("brew tap defai-digital/ax-code 2>&1 || true")
    expect(homebrewStep![0]).toContain("brew info defai-digital/ax-code/ax-code 2>/dev/null")
    expect(homebrewStep![0]).not.toContain("brew update\n")
  })

  test("release build matrix smokes compiled backend stdio handshake", async () => {
    const text = await Bun.file(releaseWorkflow).text()
    const buildJob = text.match(/build:[\s\S]*?(?=\n  publish:|\n  publish-source:|$)/)
    expect(buildJob).not.toBeNull()
    expect(buildJob![0]).toContain("Smoke — compiled backend stdio handshake")
    expect(buildJob![0]).toContain("smoke-bin:")
    expect(buildJob![0]).toContain('BIN="${{ matrix.smoke-bin }}"')
    expect(buildJob![0]).not.toContain("find dist -path")
    expect(buildJob![0]).toContain("tui-backend --stdio")
    expect(buildJob![0]).toContain('"runtimeMode":"compiled"')
  })

  test("release workflow publishes compiled npm package as default and source as alias only", async () => {
    const text = await Bun.file(releaseWorkflow).text()
    expect(text).toContain("publish-npm:")
    expect(text).toContain("bun run script/publish.ts")
    expect(text).toContain("AX_CODE_COMPILED_TAG: ${{ env.AX_CODE_RELEASE_CHANNEL }}")
    expect(text).toContain('AX_CODE_SOURCE_PACKAGE_NAMES: "@defai.digital/ax-code-source"')
    expect(text).not.toContain('AX_CODE_SOURCE_PACKAGE_NAMES: "@defai.digital/ax-code,@defai.digital/ax-code-source"')
  })
})
