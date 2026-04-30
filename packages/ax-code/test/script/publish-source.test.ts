import { describe, expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "path"
import {
  OPENTUI_NATIVE_PACKAGES,
  buildChannelForVersion,
  sourceDistributionCmdShim,
  sourceDistributionPostinstall,
  sourceDistributionUnixShim,
  sourcePackageManifest,
} from "../../script/source-package"

const publishSourcePath = path.resolve(import.meta.dir, "../../script/publish-source.ts")
const buildSourcePath = path.resolve(import.meta.dir, "../../script/build-source.ts")

const manifest = () =>
  sourcePackageManifest({
    packageName: "@defai.digital/ax-code-source",
    version: "4.5.5",
    bunDependencyRange: "^1.3.12",
    opentuiCoreVersion: "0.1.105",
    license: "MIT",
    sourceDistTag: "latest",
  })

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
    expect(text).toContain("--tag ${SOURCE_DIST_TAG}")
    expect(buildChannelForVersion("4.5.5")).toBe("latest")
    expect(buildChannelForVersion("4.6.0-beta.2")).toBe("beta")
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
    const pkg = manifest()
    expect(pkg.dependencies).toEqual({ bun: "^1.3.12" })
    expect(pkg.optionalDependencies).not.toHaveProperty("bun")
  })

  test("declares OpenTUI native packages as optional runtime dependencies", async () => {
    const pkg = manifest()
    for (const pkgName of OPENTUI_NATIVE_PACKAGES) {
      expect(pkg.optionalDependencies[pkgName]).toBe("0.1.105")
    }
  })

  test("unix shim resolves $0 through symlinks", () => {
    // npm puts a symlink at node_modules/.bin/ax-code -> the real script.
    // Without symlink resolution the shim looks for bundle/ in .bin/'s
    // parent dir (node_modules/) instead of the package root.
    const text = sourceDistributionUnixShim()
    expect(text).toContain('while [ -L "$script" ]')
    expect(text).toContain("readlink")
  })

  test("unix shim refuses to launch without a usable bun", () => {
    const text = sourceDistributionUnixShim()
    expect(text).toContain("ax-code: bun runtime not found")
    expect(text).toContain("exit 127")
  })

  test("postinstall honors AX_CODE_SKIP_POSTINSTALL", () => {
    // CI environments without bun should be able to skip the bun probe
    // and still install the package (the shim will fail at runtime if
    // bun never gets resolved, which is the user's choice).
    const text = sourceDistributionPostinstall()
    expect(text).toContain('AX_CODE_SKIP_POSTINSTALL === "1"')
  })

  test("postinstall writes the resolved bun path to .ax-code-bun-path", () => {
    // The shim reads this file rather than doing a PATH lookup on every
    // invocation — keeps cold-start latency at one syscall.
    const text = sourceDistributionPostinstall()
    expect(text).toContain("BUN_PATH_FILE")
    expect(text).toContain(".ax-code-bun-path")
  })

  test("postinstall resolves system bun from PATH without shell builtins", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ax-code-source-postinstall-"))
    try {
      const packageDir = path.join(tempRoot, "package")
      const binDir = path.join(packageDir, "bin")
      const pathDir = path.join(tempRoot, "path-bin")
      await mkdir(binDir, { recursive: true })
      await mkdir(pathDir, { recursive: true })

      const fakeBunName = process.platform === "win32" ? "bun.cmd" : "bun"
      const fakeBun = path.join(pathDir, fakeBunName)
      await writeFile(fakeBun, process.platform === "win32" ? "@echo off\r\nexit /b 0\r\n" : "#!/bin/sh\nexit 0\n")
      if (process.platform !== "win32") await chmod(fakeBun, 0o755)

      const postinstallPath = path.join(binDir, "postinstall.mjs")
      await writeFile(postinstallPath, sourceDistributionPostinstall())

      const node = Bun.which("node") ?? process.execPath
      const result = Bun.spawnSync({
        cmd: [node, postinstallPath],
        cwd: packageDir,
        env: {
          PATH: pathDir,
          PATHEXT: ".EXE;.CMD;.BAT;.COM",
        },
        stdout: "pipe",
        stderr: "pipe",
      })

      expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0)
      const cached = (await readFile(path.join(binDir, ".ax-code-bun-path"), "utf8")).trim()
      expect(cached).toBe(fakeBun)
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })

  test("source shims fall back to PATH when the cached bun path is stale", () => {
    const unix = sourceDistributionUnixShim()
    const windows = sourceDistributionCmdShim()
    expect(unix).toContain('if [ -z "$BUN_BIN" ] || [ ! -x "$BUN_BIN" ]; then')
    expect(unix).toContain('BUN_BIN="$(command -v bun || true)"')
    expect(windows).toContain('if not "%BUN_BIN%"=="" if exist "%BUN_BIN%" goto ax_code_have_bun')
    expect(windows).toContain("where bun")
    expect(windows).toContain(":ax_code_have_bun")
  })

  test("source manifest shape pins required fields", () => {
    const pkg = manifest()
    // type: module — required so postinstall can be ESM
    expect(pkg.type).toBe("module")
    // bin entry maps the package to the shim
    expect(pkg.bin).toEqual({ "ax-code": "./bin/ax-code" })
    // engines.bun pins the runtime range
    expect(pkg.engines).toEqual({ bun: "^1.3.12" })
    expect(pkg.publishConfig.tag).toBe("latest")
  })

  test("publish script delegates source runtime artifacts to source-package helpers", async () => {
    const text = await Bun.file(publishSourcePath).text()
    expect(text).toContain("sourceDistributionUnixShim()")
    expect(text).toContain("sourceDistributionCmdShim()")
    expect(text).toContain("sourceDistributionPostinstall()")
    expect(text).toContain("sourcePackageManifest({")
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
