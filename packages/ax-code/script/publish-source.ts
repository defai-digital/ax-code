#!/usr/bin/env bun
/**
 * Build and publish the source distribution npm package.
 *
 * The source distribution is the dual-publish counterpart to
 * `script/publish.ts` (compiled binaries). It produces a single npm
 * tarball that ships:
 *
 *   - `bundle/`        Bun.build output (no --compile), self-contained JS
 *   - `bin/ax-code`    sh shim that execs bun against bundle/index.js
 *   - `bin/ax-code.cmd` Windows variant
 *   - `bin/postinstall.mjs`  detects bun on PATH or in node_modules
 *   - `package.json`   declares `bun` as a regular dependency
 *
 * The primary package (`@defai.digital/ax-code`) is the default user
 * distribution. `@defai.digital/ax-code-source` is kept as a compatibility
 * alias for users who installed the earlier source-channel package name.
 *
 * See: automatosx/adr/ADR-002-distribution-source-plus-bun.md
 */
import { $ } from "bun"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import pkg from "../package.json"
import { META_PACKAGE_NAME, SOURCE_PACKAGE_NAME } from "./package-names"

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
process.chdir(dir)

const BUN_DEPENDENCY_RANGE = process.env.AX_CODE_BUN_RANGE ?? "^1.3.12"
const OPENTUI_CORE_VERSION = pkg.dependencies["@opentui/core"]
const OPENTUI_NATIVE_PACKAGES = [
  "@opentui/core-darwin-arm64",
  "@opentui/core-darwin-x64",
  "@opentui/core-linux-arm64",
  "@opentui/core-linux-x64",
  "@opentui/core-win32-arm64",
  "@opentui/core-win32-x64",
] as const

function buildChannelForVersion(version: string) {
  const prerelease = version.split("-", 2)[1]
  if (!prerelease) return "latest"
  return prerelease.split(".", 1)[0] || "beta"
}

const buildVersion = (process.env.AX_CODE_VERSION ?? pkg.version).replace(/^v/, "")
const SOURCE_DIST_TAG = process.env.AX_CODE_SOURCE_TAG ?? buildChannelForVersion(buildVersion)
const SOURCE_PACKAGE_NAMES = (process.env.AX_CODE_SOURCE_PACKAGE_NAMES ?? `${META_PACKAGE_NAME},${SOURCE_PACKAGE_NAME}`)
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean)
if (SOURCE_PACKAGE_NAMES.length === 0) {
  throw new Error("AX_CODE_SOURCE_PACKAGE_NAMES resolved to an empty package list")
}

console.log(`publish-source: version=${buildVersion} tag=${SOURCE_DIST_TAG} packages=${SOURCE_PACKAGE_NAMES.join(",")}`)

// Step 1: build the bundle. Reuse build-source.ts so anyone running
// publish-source.ts gets the same bundle layout the smoke tests assert.
{
  const result = await $`bun run script/build-source.ts`.nothrow()
  if (result.exitCode !== 0) {
    console.error("build-source.ts failed; aborting publish")
    process.exit(result.exitCode)
  }
}

const bundleDir = path.join(dir, "dist-source/bundle")
if (!fs.existsSync(path.join(bundleDir, "index.js"))) {
  console.error(`Expected bundle at ${bundleDir}/index.js after build-source.ts`)
  process.exit(1)
}

// Step 2: stage the npm tarball layout under dist-source/package/.
const stageDir = path.join(dir, "dist-source/package")
await $`rm -rf ${stageDir}`
await fs.promises.mkdir(stageDir, { recursive: true })
await fs.promises.mkdir(path.join(stageDir, "bin"), { recursive: true })

// Step 3: copy the bundle into stage/bundle.
await $`cp -R ${bundleDir} ${stageDir}/bundle`

// Step 4: write bin/ax-code (sh) and bin/ax-code.cmd (Windows).
const shimUnix = `#!/bin/sh
# ax-code source-distribution launcher.
# Resolves bun via the postinstall-recorded path (.ax-code-bun-path next
# to this script), then falls back to PATH lookup if the file is missing.
set -e

# Resolve $0 through symlinks so npm's node_modules/.bin/ax-code symlink
# does not break path resolution. Without this, the shim looks for
# bundle/ relative to .bin/ instead of the real package directory.
script="$0"
while [ -L "$script" ]; do
  target="$(readlink "$script")"
  case "$target" in
    /*) script="$target" ;;
    *) script="$(dirname "$script")/$target" ;;
  esac
done
SCRIPT_DIR="$(cd "$(dirname "$script")" && pwd)"
PKG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BUN_PATH_FILE="$SCRIPT_DIR/.ax-code-bun-path"
if [ -f "$BUN_PATH_FILE" ]; then
  BUN_BIN="$(cat "$BUN_PATH_FILE")"
else
  BUN_BIN="$(command -v bun || true)"
fi
if [ -z "$BUN_BIN" ] || [ ! -x "$BUN_BIN" ]; then
  echo "ax-code: bun runtime not found. Install bun: https://bun.sh/install" >&2
  exit 127
fi
export AX_CODE_ORIGINAL_CWD="$(pwd)"
exec "$BUN_BIN" "$PKG_DIR/bundle/index.js" "$@"
`

const shimCmd = `@echo off
rem ax-code source-distribution launcher (Windows)
setlocal
set "SCRIPT_DIR=%~dp0"
set "PKG_DIR=%SCRIPT_DIR%.."
set "BUN_PATH_FILE=%SCRIPT_DIR%.ax-code-bun-path"
set "BUN_BIN="
if exist "%BUN_PATH_FILE%" (
  set /p BUN_BIN=<"%BUN_PATH_FILE%"
)
if "%BUN_BIN%"=="" (
  for /f "delims=" %%i in ('where bun 2^>nul') do if "%BUN_BIN%"=="" set "BUN_BIN=%%i"
)
if "%BUN_BIN%"=="" (
  echo ax-code: bun runtime not found. Install bun: https://bun.sh/install 1>&2
  exit /b 127
)
set "AX_CODE_ORIGINAL_CWD=%CD%"
"%BUN_BIN%" "%PKG_DIR%\\bundle\\index.js" %*
`

await fs.promises.writeFile(path.join(stageDir, "bin/ax-code"), shimUnix, { mode: 0o755 })
await fs.promises.writeFile(path.join(stageDir, "bin/ax-code.cmd"), shimCmd)

// Step 5: write postinstall.mjs.
// At install time we resolve bun once and cache the path, so the shim is
// fast (no PATH lookup or filesystem walk on each invocation).
const postinstall = `#!/usr/bin/env node
import { existsSync, writeFileSync, chmodSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PKG_DIR = path.resolve(__dirname, "..")
const BIN_DIR = path.join(PKG_DIR, "bin")
const BUN_PATH_FILE = path.join(BIN_DIR, ".ax-code-bun-path")

if (process.env.AX_CODE_SKIP_POSTINSTALL === "1") {
  console.log("ax-code postinstall: skipped (AX_CODE_SKIP_POSTINSTALL=1)")
  process.exit(0)
}

function resolveBun() {
  // 1. System bun on PATH wins — respects user's preferred install/version.
  try {
    const cmd = process.platform === "win32" ? "where" : "command"
    const args = process.platform === "win32" ? ["bun"] : ["-v", "bun"]
    const out = execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
    const candidate = out.split(/\\r?\\n/).map((line) => line.trim()).find(Boolean)
    if (candidate && existsSync(candidate)) return candidate
  } catch {}

  // 2. The bundled @oven/bun-* dep that npm pulled into our node_modules.
  const localBun = path.join(
    PKG_DIR,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "bun.exe" : "bun",
  )
  if (existsSync(localBun)) return localBun

  // 3. Hoisted layout — pnpm/npm may have hoisted the bun bin to the parent.
  const hoisted = path.resolve(
    PKG_DIR,
    "..",
    ".bin",
    process.platform === "win32" ? "bun.exe" : "bun",
  )
  if (existsSync(hoisted)) return hoisted

  return undefined
}

const bun = resolveBun()
if (!bun) {
  console.error("ax-code postinstall: could not locate bun runtime.")
  console.error("Install bun: https://bun.sh/install  (set AX_CODE_SKIP_POSTINSTALL=1 to defer)")
  process.exit(1)
}

writeFileSync(BUN_PATH_FILE, bun + "\\n", "utf8")
console.log(\`ax-code postinstall: bun runtime resolved -> \${bun}\`)

// Ensure the unix shim stays executable after npm pack/unpack — npm has
// historically dropped the +x bit on bin scripts during install.
if (process.platform !== "win32") {
  try {
    chmodSync(path.join(BIN_DIR, "ax-code"), 0o755)
  } catch {}
}
`

await fs.promises.writeFile(path.join(stageDir, "bin/postinstall.mjs"), postinstall)

// Step 6: write the source-distribution package.json.
//
// Notes on the manifest:
//   - `bun` is a regular dependency so npm always installs the runtime.
//   - OpenTUI's native packages stay optional so npm installs exactly the
//     matching os/cpu package. The bundled JS still resolves that native
//     package dynamically at TUI startup.
//   - No other runtime deps are listed: the bundle inlines them.
//   - `type: module` is required for the postinstall ESM file.
//   - `os` and `cpu` are not constrained: bun handles per-platform
//     selection via its own optionalDependencies tree.
function sourcePackageManifest(packageName: string) {
  return {
    name: packageName,
    version: buildVersion,
    type: "module",
    description: "AI coding runtime (source distribution; runs via bun)",
    bin: {
      "ax-code": "./bin/ax-code",
    },
    files: ["bin/", "bundle/", "LICENSE"],
    scripts: {
      postinstall: "node ./bin/postinstall.mjs",
    },
    engines: {
      bun: BUN_DEPENDENCY_RANGE,
    },
    dependencies: {
      bun: BUN_DEPENDENCY_RANGE,
    },
    optionalDependencies: Object.fromEntries(OPENTUI_NATIVE_PACKAGES.map((name) => [name, OPENTUI_CORE_VERSION])),
    license: pkg.license,
    homepage: "https://github.com/defai-digital/ax-code",
    repository: {
      type: "git",
      url: "https://github.com/defai-digital/ax-code",
    },
    publishConfig: {
      access: "public",
      tag: SOURCE_DIST_TAG,
    },
  }
}

async function removePackedTarballs() {
  for await (const file of new Bun.Glob("*.tgz").scan({ cwd: stageDir })) {
    await fs.promises.rm(path.join(stageDir, file), { force: true })
  }
}

// Step 7: copy LICENSE.
await fs.promises.copyFile(path.resolve(dir, "../../LICENSE"), path.join(stageDir, "LICENSE"))

// Step 8: pack and publish (or just pack when AX_CODE_DRY_RUN=1).
const dryRun = process.env.AX_CODE_DRY_RUN === "1"
if (dryRun) console.log("AX_CODE_DRY_RUN=1 — packing only, not publishing")

for (const packageName of SOURCE_PACKAGE_NAMES) {
  await fs.promises.writeFile(
    path.join(stageDir, "package.json"),
    JSON.stringify(sourcePackageManifest(packageName), null, 2) + "\n",
  )
  await removePackedTarballs()
  await $`npm pack --workspaces=false`.cwd(stageDir)
  if (dryRun) {
    console.log(`Pack complete: ${packageName}@${buildVersion} in ${stageDir}`)
    continue
  }

  const publishResult = await $`npm publish *.tgz --workspaces=false --access public --tag ${SOURCE_DIST_TAG}`
    .cwd(stageDir)
    .nothrow()
  if (publishResult.exitCode !== 0) {
    const stderr = String(publishResult.stderr ?? "")
    if (stderr.includes("previously published") || stderr.includes("cannot publish over")) {
      console.warn(`${packageName}@${buildVersion} (${SOURCE_DIST_TAG}) already published, skipping`)
    } else {
      console.error(stderr)
      process.exit(publishResult.exitCode)
    }
  }

  console.log(`Published ${packageName}@${buildVersion} under tag '${SOURCE_DIST_TAG}'`)
}

if (dryRun) process.exit(0)
