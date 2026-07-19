import { describe, expect, test } from "vitest"
import path from "path"
import { readFile } from "node:fs/promises"
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
const axCodeNodeTuiBuildScript = path.join(repoRoot, "packages/ax-code/script/build-node-tui.ts")
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

    const pkg = JSON.parse(await readFile(axCodePackageJson, "utf-8"))
    expect(pkg.bin).toBeUndefined()
    expect(pkg.scripts["bundle:source"]).toBeUndefined()
    expect(pkg.scripts["bundle:source:smoke"]).toBeUndefined()
    expect(pkg.scripts["bundle:source:pack"]).toBeUndefined()
    expect(pkg.scripts["bundle:source:install-smoke"]).toBeUndefined()
    expect(pkg.scripts["bundle:source:tui-smoke"]).toBeUndefined()

    const ci = await readFile(axCodeCiWorkflow, "utf-8")
    expect(ci).not.toContain("bundle-source:")
    expect(ci).not.toContain("dist-source")
    expect(ci).not.toContain("publish-source")
    expect(ci).not.toContain("source-install-smoke")
  })

  test("default formula installs the node-bundled distribution", async () => {
    const text = await readFile(homebrewDefaultScript, "utf-8")
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
    // The vendored OpenTUI dylib has zero Mach-O header padding, so Homebrew's
    // fix_dynamic_linkage cannot relocate its @rpath install id and `brew install`
    // exits non-zero. There is no formula DSL to skip relocation, so the install
    // gzips the dylib (hiding it from the Mach-O linkage scan) and post_install —
    // which runs after fix_dynamic_linkage — restores it. `preserve_rpath` is not a
    // real Homebrew DSL method and would raise NoMethodError on formula load.
    expect(text).not.toContain("preserve_rpath")
    expect(text).toContain("node_modules/@opentui/core-darwin-arm64/libopentui.dylib")
    expect(text).toContain('system "gzip"')
    expect(text).toContain("def post_install")
    expect(text).toContain('system "gunzip"')
    expect(text).toContain('depends_on "node"')
    expect(text).toContain("--experimental-ffi")
    expect(text).toContain("--disable-warning=ExperimentalWarning")
    expect(text).not.toContain('bin.install "ax-code"')
    expect(text).not.toContain('depends_on "bun"')
    expect(text).not.toContain("bundle/index.js")
    // Homebrew skips linking the formula while a cask named "ax-code" (the
    // deprecated Desktop cask token) is installed, which can leave the CLI
    // missing from PATH after upgrades (issue #342). The formula must warn
    // those installs with the exact recovery commands.
    expect(text).toContain("def caveats")
    expect(text).toContain('Caskroom/ax-code"')
    expect(text).toContain("brew link ax-code")
    expect(text).toContain("hash -r")
  })

  test("default homebrew update separates release-read and tap-write tokens", async () => {
    const text = await readFile(homebrewDefaultScript, "utf-8")
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

  test("release workflow verifies draft assets before publishing without package-channel gates", async () => {
    const text = await readFile(releaseWorkflow, "utf-8")
    const publishJob = text.match(/\n  publish:[\s\S]*$/)
    expect(publishJob).not.toBeNull()
    expect(publishJob![0]).toContain("gh release create")
    expect(publishJob![0]).toContain("gh release upload")
    expect(publishJob![0]).toContain("cp install.ps1 packages/ax-code/dist/install.ps1")
    expect(publishJob![0]).toContain("packages/ax-code/dist/install.ps1")
    expect(publishJob![0]).toContain("*.tar.gz.minisig")
    expect(publishJob![0]).toContain("*.zip.minisig")
    expect(publishJob![0]).toMatch(/\n\s+--draft(?:\s|\\|$)/)
    expect(publishJob![0]).toContain("Publish verified release")
    expect(text).not.toMatch(/\n  finalize:/)
    expect(text).not.toContain("gh workflow run install-matrix-smoke.yml")
  })

  test("release workflow signs archives with minisign before uploading assets", async () => {
    const text = await readFile(releaseWorkflow, "utf-8")
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
    expect(job).toContain("RWSlDu++afxCz01OqhYWhfo8+L8pVbSYXJBEb2zoWBuK0WACIzbGVZRO")
    // The passphrase is stored in the macOS Keychain from the secret, then the
    // signing script reads it back via minisignPasswordFromKeychain().
    expect(job).toContain("secrets.AX_CODE_MINISIGN_PASSWORD")
    expect(job).toContain("security add-generic-password")
    expect(job).toContain("ax-minisign")
    expect(job).toContain("ax-release")
    expect(job).toContain("Clean up Keychain passphrase")
    expect(job).toContain("security delete-generic-password")
    expect(job).toContain("Sign release assets")
    expect(job).toContain("minisignPasswordFromKeychain")
    expect(job).toContain("pnpm exec tsx script/sign-release-assets.ts --dist-dir packages/ax-code/dist")
    expect(job).toContain("missing minisign signature for ${asset}")
    expect(job).toContain("shopt -s nullglob")
    expect(job).toContain("no release assets found to upload")
    expect(job).not.toContain('gh release upload "$TAG" "$f" --clobber || true')
    expect(job.indexOf("Sign release assets")).toBeLessThan(job.indexOf("Create GitHub release"))
    expect(job.indexOf("Sign release assets")).toBeLessThan(job.indexOf("Upload release assets"))
    expect(job).toContain("--draft")
    expect(job).toContain("docs/release/ax-minisign.pub")
    expect(job).toContain("Verify uploaded release signatures")
    expect(job).toContain("minisign -V -p docs/release/ax-minisign.pub")
    expect(job).toContain("Publish verified release")
    expect(job).toContain("release $TAG is no longer a draft; refusing to publish or mutate it")
    expect(job.indexOf("Verify uploaded release signatures")).toBeLessThan(job.indexOf("Publish verified release"))
  })

  test("release workflow requires Developer ID signing and notarizes the macOS CLI archive", async () => {
    const text = await readFile(releaseWorkflow, "utf-8")
    const buildJob = text.match(/\n  build:[\s\S]*?(?=\n  publish:|$)/)
    expect(buildJob).not.toBeNull()
    const job = buildJob![0]

    expect(job).toContain("fail-fast: false")
    expect(job).toContain("HAS_APPLE_CERT")
    expect(job).toContain("secrets.APPLE_CERTIFICATE")
    expect(job).toContain("Require Apple signing and notarization credentials")
    expect(job).toContain("is required for signed macOS releases")
    expect(job).toContain("Install Apple certificate")
    expect(job).toContain("Developer ID Application")
    expect(job).toContain("AX_CODE_APPLE_CODESIGN_IDENTITY")
    expect(job).toContain("Configure Apple API key for notarization")
    expect(job).toContain("APPLE_API_KEY_B64")
    expect(job).not.toContain("Note unsigned macOS CLI notarization state")
    expect(job).toContain("Notarize macOS CLI archive")
    expect(job).toContain('ARCHIVE="packages/ax-code/dist/ax-code-${{ matrix.targets }}.zip"')
    expect(job).toContain("xcrun notarytool submit")
    expect(job).toContain("ZIP archives cannot be stapled")
    expect(job.indexOf("Notarize macOS CLI archive")).toBeGreaterThan(job.indexOf("Smoke — release runtime"))
    expect(job.indexOf("Notarize macOS CLI archive")).toBeLessThan(job.indexOf("Upload build artifacts"))
  })

  test("release build jobs do not let optional native postinstall scripts block artifacts", async () => {
    const text = await readFile(releaseWorkflow, "utf-8")
    const validateJob = text.match(/\n  validate:[\s\S]*?(?=\n  build:|$)/)
    const buildJob = text.match(/\n  build:[\s\S]*?(?=\n  publish:|$)/)
    expect(validateJob).not.toBeNull()
    expect(buildJob).not.toBeNull()

    expect(validateJob![0]).toContain("pnpm install --frozen-lockfile")
    expect(validateJob![0]).not.toContain("pnpm install --frozen-lockfile --ignore-scripts")
    expect(buildJob![0]).toContain("pnpm install --frozen-lockfile --ignore-scripts")
    expect(buildJob![0]).toContain("node-pty rebuild as optional")
    expect(buildJob![0].indexOf("pnpm install --frozen-lockfile --ignore-scripts")).toBeLessThan(
      buildJob![0].indexOf("Build SDK"),
    )
  })

  test("node-bundled macOS build supports Developer ID signing without requiring Apple secrets locally", async () => {
    const text = await readFile(axCodeNodeTuiBuildScript, "utf-8")

    expect(text).toContain("AX_CODE_APPLE_CODESIGN_IDENTITY")
    expect(text).toContain('"--timestamp"')
    expect(text).toContain('"--options", "runtime"')
    expect(text).toContain('"--sign", appleCodesignIdentity')
    expect(text).toContain('"--sign", "-"')
    expect(text).toContain('"--verify", "--strict"')
    expect(text).toContain("Developer ID signed")
    expect(text).toContain("Ad-hoc signed")
  })

  test("release workflow auto-publishes the Homebrew tap but never npm", async () => {
    const text = await readFile(releaseWorkflow, "utf-8")
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

  test("Homebrew verifies the detached release signature before hashing", async () => {
    const script = await readFile(path.join(repoRoot, ".github/scripts/update-homebrew.sh"), "utf-8")

    expect(script).toContain('MINISIGN_PUBLIC_KEY="${AX_CODE_MINISIGN_PUBLIC_KEY:-docs/release/ax-minisign.pub}"')
    expect(script).toContain('download_asset "${DARWIN_ARM64_ASSET}.minisig"')
    expect(script).toContain("minisign -V")
    expect(script.indexOf("minisign -V")).toBeLessThan(script.indexOf("cat > /tmp/ax-code.rb"))
  })

  test("install matrix is dispatch-only so release.published cannot race package publication", async () => {
    const text = await readFile(installMatrixWorkflow, "utf-8")
    expect(text).toContain("permissions:")
    expect(text).toContain("contents: read")
    expect(text).toContain("uses: actions/checkout@v7")
    expect(text).toContain("workflow_dispatch:")
    expect(text).not.toContain("types: [published]")
    expect(text).not.toMatch(/\n  release:\n/)
    expect(text).not.toContain("release workflow dispatches")
  })

  test("install matrix supports Homebrew and Windows without npm package installs", async () => {
    const text = await readFile(installMatrixWorkflow, "utf-8")
    const filterDispatchChannel = await readFile(filterDispatchChannelScript, "utf-8")
    const validateInputs = await readFile(validateInstallMatrixInputsScript, "utf-8")
    // Linux support was dropped: no curl/linux smoke legs remain.
    expect(text).not.toContain("- curl")
    expect(text).not.toContain("ubuntu")
    expect(text).toContain("- homebrew")
    expect(text).toContain("- windows")
    expect(text).toContain("brew install defai-digital/ax-code/ax-code")
    // Regression guard for issue #342: installing the Desktop cask next to
    // the CLI formula must not unlink the ax-code command. The cask installs
    // under its own token; a cask named plain "ax-code" is a failure.
    expect(text).toContain("brew install --cask defai-digital/ax-code-desktop/ax-code-desktop")
    expect(text).toContain('brew list --cask | grep -Fx "ax-code"')
    expect(text).not.toContain("brew list --cask ax-code >/dev/null")
    expect(text).toContain("command -v ax-code")
    expect(text).toContain("Install minisign for release verification")
    expect(text).toContain('minisign-$MinisignVersion-win64.zip')
    expect(text).toContain('$MinisignVersion = "0.12"')
    expect(text).toContain("install.ps1.minisig")
    expect(text).toContain("docs/release/ax-minisign.pub")
    expect(text).toContain("& minisign -V -p $PublicKeyFile -m $Installer -x $InstallerSig")
    expect(text).toContain("Invoke-WebRequest -Uri")
    expect(text).toContain("& $Installer -Version $Version")
    expect(text).not.toContain("& $Installer -Version $Version -NoModifyPath")
    expect(text).toContain("Get-Command ax-code -ErrorAction Stop")
    expect(text).toContain("expected installer-linked ax-code")
    expect(text).toContain('"$Base/install.ps1"')
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
    const assertRuntimeMode = await readFile(assertRuntimeModeScript, "utf-8")
    expect(assertRuntimeMode).toContain("RUNTIME_RE='node-bundled'")
    expect(assertRuntimeMode).toContain('PATTERN="\\"runtimeMode\\":\\"${RUNTIME_RE}\\""')
    expect(text).not.toContain("npm install -g")
    expect(text).not.toContain("npm view")
    expect(text).not.toContain("@defai.digital/ax-code")
    expect(text).not.toContain("ax-code-source")
  })

  test("install matrix smokes supported installers with isolated runtime homes", async () => {
    const text = await readFile(installMatrixWorkflow, "utf-8")
    const isolatedHome = await readFile(isolatedHomeScript, "utf-8")
    const homebrewJob = text.match(/homebrew:[\s\S]*?(?=\n  windows:|$)/)
    expect(homebrewJob).not.toBeNull()
    expect(homebrewJob![0]).toContain("set-isolated-home-env.sh")

    const windowsJob = text.match(/windows:[\s\S]*$/)
    expect(windowsJob).not.toBeNull()
    expect(windowsJob![0]).toContain("set-isolated-home-env.sh")
    expect(windowsJob![0]).toContain("actions/setup-node@v7")
    expect(windowsJob![0]).toContain('node-version: "26"')

    expect(isolatedHome).toContain("AX_CODE_TEST_HOME")
    expect(isolatedHome).toContain("XDG_CONFIG_HOME")
    expect(isolatedHome).toContain("XDG_DATA_HOME")
    expect(text).toContain("AX_CODE_DISABLE_PROJECT_CONFIG")
    expect(text).toContain("AX_CODE_DISABLE_MODELS_FETCH")
  })

  test("install matrix refreshes the Homebrew tap while waiting for formula propagation", async () => {
    const text = await readFile(installMatrixWorkflow, "utf-8")
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
    const text = await readFile(releaseWorkflow, "utf-8")
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
    expect(buildJob![0]).toContain("build-script: script/build-node-tui.ts")
    expect(buildJob![0]).not.toContain("build-script: script/build-node.ts")
    expect(buildJob![0]).toContain("build-args: --release --arch arm64")
    expect(buildJob![0]).toContain("build-args: --release --arch x64")
    expect(buildJob![0]).toContain("smoke-bin:")
    expect(buildJob![0]).toContain('BIN="${{ matrix.smoke-bin }}"')
    expect(buildJob![0]).toContain("smoke-runtime: node-bundled")
    expect(buildJob![0]).not.toContain("smoke-runtime: compiled")
    expect(buildJob![0]).not.toContain("find dist -path")
    expect(buildJob![0]).toContain('grep -E "Runtime: .* \\(${{ matrix.smoke-runtime }}\\)"')
  })

  test("release Unix launcher can use bundled node.exe from Windows zips", async () => {
    const text = await readFile(axCodeNodeTuiBuildScript, "utf-8")
    expect(text).toContain('"$dir/../node/bin/node"')
    expect(text).toContain('"$dir/../node/bin/node.exe"')
  })
})
