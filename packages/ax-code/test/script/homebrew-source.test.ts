import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs"

const repoRoot = path.resolve(import.meta.dir, "../../../..")
const homebrewSourceScript = path.join(repoRoot, ".github/scripts/update-homebrew-source.sh")
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

  test("formula filename and class name are ax-code-source / AxCodeSource (not ax-code)", async () => {
    // Phase 2 is additive — the existing ax-code formula stays compiled.
    // The new formula MUST be a separate file so brew users opt in
    // via `brew install defai-digital/ax-code/ax-code-source`.
    const text = await Bun.file(homebrewSourceScript).text()
    expect(text).toContain("ax-code-source.rb")
    expect(text).not.toContain("> /tmp/ax-code.rb")
  })

  test("homebrew-source job exists in release.yml gated on publish-source", async () => {
    // The job must run AFTER publish-source uploads to npm, otherwise
    // the formula's npm tarball URL 404s.
    const text = await Bun.file(releaseWorkflow).text()
    expect(text).toContain("homebrew-source:")
    // Find the job block and verify its `needs:` references publish-source
    const jobMatch = text.match(/homebrew-source:[\s\S]*?(?=\n  \w+:|\n\Z|$)/)
    expect(jobMatch).not.toBeNull()
    expect(jobMatch![0]).toContain("needs: publish-source")
  })

  test("homebrew-source job skipped on prerelease tags (matches existing homebrew job)", async () => {
    const text = await Bun.file(releaseWorkflow).text()
    const jobMatch = text.match(/homebrew-source:[\s\S]*?(?=\n  \w+:|\n\Z|$)/)
    expect(jobMatch).not.toBeNull()
    expect(jobMatch![0]).toContain("!contains(github.ref_name, '-')")
  })

  test("install matrix installs exact package versions, not stale dist-tags", async () => {
    const text = await Bun.file(installMatrixWorkflow).text()
    expect(text).toContain('PACKAGE="@defai.digital/ax-code-source"')
    expect(text).toContain('PACKAGE="@defai.digital/ax-code"')
    expect(text).toContain('npm install -g "${PACKAGE}@${VERSION}"')
    expect(text).toContain('OUTPUT="$(ax-code --version)"')
    expect(text).toContain("expected ax-code --version to be ${VERSION}")
    expect(text).not.toContain("@defai.digital/ax-code@$CHANNEL")
  })

  test("existing ax-code (compiled) homebrew formula generator is untouched", async () => {
    // ADR-002 Phase 2 must not change the compiled formula. Phase 3
    // will flip the default later; this commit is additive only.
    const compiledScript = path.join(repoRoot, ".github/scripts/update-homebrew.sh")
    const text = await Bun.file(compiledScript).text()
    expect(text).toContain("class AxCode < Formula")
    expect(text).not.toContain('depends_on "bun"')
  })
})
