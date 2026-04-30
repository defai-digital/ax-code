import { describe, expect, test } from "bun:test"
import path from "path"

const publishSourcePath = path.resolve(import.meta.dir, "../../script/publish-source.ts")
const buildSourcePath = path.resolve(import.meta.dir, "../../script/build-source.ts")

describe("script.publish-source", () => {
  test("uses --workspaces=false for npm pack and publish (matches other publish scripts)", async () => {
    const text = await Bun.file(publishSourcePath).text()
    expect(text).toContain("npm pack --workspaces=false")
    expect(text).toContain("npm publish *.tgz --workspaces=false")
  })

  test("publishes under a per-version dist-tag, overridable via env", async () => {
    const text = await Bun.file(publishSourcePath).text()
    // The default dist-tag is now derived from the version string
    // (`buildChannelForVersion(buildVersion)` → "latest" for stable,
    // "beta" / "alpha" / etc. for prereleases) instead of the old
    // hardcoded "source". The env override `AX_CODE_SOURCE_TAG` still
    // wins, and `npm publish` consumes the resolved tag verbatim.
    expect(text).toContain("AX_CODE_SOURCE_TAG ?? buildChannelForVersion(buildVersion)")
    expect(text).toContain("function buildChannelForVersion(version: string)")
    expect(text).toContain("--tag ${SOURCE_DIST_TAG}")
  })

  test("publishes a distinct source package to avoid npm name/version collisions", async () => {
    const text = await Bun.file(publishSourcePath).text()
    expect(text).toContain("SOURCE_PACKAGE_NAME")
    expect(text).not.toContain("name: META_PACKAGE_NAME")
  })

  test("declares bun as a regular dependency, not optional", async () => {
    // Optional deps can be skipped with --no-optional, which would break
    // the source distribution at runtime. ADR-002 explicitly requires bun
    // to be a hard dep.
    const text = await Bun.file(publishSourcePath).text()
    const depsBlockMatch = text.match(/dependencies:\s*\{[\s\S]*?\}/)
    expect(depsBlockMatch).not.toBeNull()
    expect(depsBlockMatch![0]).toContain("bun:")
    const optionalDepsBlockMatch = text.match(/optionalDependencies:\s*Object\.fromEntries/)
    expect(optionalDepsBlockMatch).not.toBeNull()
    expect(text).not.toMatch(/optionalDependencies:\s*\{[\s\S]*?bun:/)
  })

  test("declares OpenTUI native packages as optional runtime dependencies", async () => {
    const text = await Bun.file(publishSourcePath).text()
    expect(text).toContain('const OPENTUI_CORE_VERSION = pkg.dependencies["@opentui/core"]')
    expect(text).toContain("OPENTUI_NATIVE_PACKAGES")
    for (const pkgName of [
      "@opentui/core-darwin-arm64",
      "@opentui/core-darwin-x64",
      "@opentui/core-linux-arm64",
      "@opentui/core-linux-x64",
      "@opentui/core-win32-arm64",
      "@opentui/core-win32-x64",
    ]) {
      expect(text).toContain(pkgName)
    }
    expect(text).toContain("optionalDependencies: Object.fromEntries")
  })

  test("unix shim resolves $0 through symlinks", async () => {
    // npm puts a symlink at node_modules/.bin/ax-code -> the real script.
    // Without symlink resolution the shim looks for bundle/ in .bin/'s
    // parent dir (node_modules/) instead of the package root.
    const text = await Bun.file(publishSourcePath).text()
    expect(text).toContain('while [ -L "$script" ]')
    expect(text).toContain("readlink")
  })

  test("unix shim refuses to launch without a usable bun", async () => {
    const text = await Bun.file(publishSourcePath).text()
    expect(text).toContain("ax-code: bun runtime not found")
    expect(text).toContain("exit 127")
  })

  test("postinstall honors AX_CODE_SKIP_POSTINSTALL", async () => {
    // CI environments without bun should be able to skip the bun probe
    // and still install the package (the shim will fail at runtime if
    // bun never gets resolved, which is the user's choice).
    const text = await Bun.file(publishSourcePath).text()
    expect(text).toContain('AX_CODE_SKIP_POSTINSTALL === "1"')
  })

  test("postinstall writes the resolved bun path to .ax-code-bun-path", async () => {
    // The shim reads this file rather than doing a PATH lookup on every
    // invocation — keeps cold-start latency at one syscall.
    const text = await Bun.file(publishSourcePath).text()
    expect(text).toContain("BUN_PATH_FILE")
    expect(text).toContain(".ax-code-bun-path")
  })

  test("source shims fall back to PATH when the cached bun path is stale", async () => {
    const text = await Bun.file(publishSourcePath).text()
    expect(text).toContain('if [ -z "$BUN_BIN" ] || [ ! -x "$BUN_BIN" ]; then')
    expect(text).toContain('BUN_BIN="$(command -v bun || true)"')
    expect(text).toContain('if not "%BUN_BIN%"=="" if exist "%BUN_BIN%" goto ax_code_have_bun')
    expect(text).toContain("where bun")
    expect(text).toContain(":ax_code_have_bun")
  })

  test("source manifest shape pins required fields", async () => {
    const text = await Bun.file(publishSourcePath).text()
    // type: module — required so postinstall can be ESM
    expect(text).toMatch(/type:\s*"module"/)
    // bin entry maps the package to the shim
    expect(text).toMatch(/"ax-code":\s*"\.\/bin\/ax-code"/)
    // engines.bun pins the runtime range
    expect(text).toContain("BUN_DEPENDENCY_RANGE")
  })
})

describe("script.build-source", () => {
  test("does not use Bun.build's compile option (the source bundle must be plain JS)", async () => {
    // The whole point of the source distribution is that it does NOT go
    // through `bun build --compile`. Any reintroduction of compile here
    // would put us back on the bug class ADR-002 retires.
    const text = await Bun.file(buildSourcePath).text()
    const buildCallMatch = text.match(/Bun\.build\(\{[\s\S]*?\n\}\)/)
    expect(buildCallMatch).not.toBeNull()
    expect(buildCallMatch![0]).not.toContain("compile:")
  })

  test("flat output naming so bundle/index.js etc are at the bundle root", async () => {
    // Without flat naming, entrypoints from src/ get nested as src/index.js
    // and the parser worker (which lives in node_modules) escapes outdir.
    const text = await Bun.file(buildSourcePath).text()
    expect(text).toContain('entry: "[name].[ext]"')
  })

  test("stages the opentui parser worker into a local path before passing to Bun.build", async () => {
    const text = await Bun.file(buildSourcePath).text()
    expect(text).toContain("parserWorkerStaged")
    expect(text).toContain("copyFile")
  })

  test("does not emit AX_CODE_WORKER_PATH define (relies on import.meta.url fallback)", async () => {
    // AX_CODE_WORKER_PATH is the bunfs-specific worker path used by
    // compiled binaries. The source bundle must NOT set it; thread.ts
    // falls through to the relative-URL resolution path which Bun.build
    // rewrites correctly at bundle time.
    const text = await Bun.file(buildSourcePath).text()
    const defineBlockMatch = text.match(/define:\s*\{[\s\S]*?\}/)
    expect(defineBlockMatch).not.toBeNull()
    expect(defineBlockMatch![0]).not.toContain("AX_CODE_WORKER_PATH")
  })

  test("embeds migrations and version exactly like the compiled build does", async () => {
    const text = await Bun.file(buildSourcePath).text()
    expect(text).toContain("AX_CODE_MIGRATIONS:")
    expect(text).toContain("AX_CODE_VERSION:")
    expect(text).toContain("AX_CODE_CHANNEL:")
  })
})
