export const DEFAULT_BUN_DEPENDENCY_RANGE = "^1.3.12"

export const OPENTUI_NATIVE_PACKAGES = [
  "@opentui/core-darwin-arm64",
  "@opentui/core-darwin-x64",
  "@opentui/core-linux-arm64",
  "@opentui/core-linux-x64",
  "@opentui/core-win32-arm64",
  "@opentui/core-win32-x64",
] as const

export function buildChannelForVersion(version: string) {
  const prerelease = version.split("-", 2)[1]
  if (!prerelease) return "latest"
  return prerelease.split(".", 1)[0] || "beta"
}

export function sourceDistributionUnixShim() {
  return `#!/bin/sh
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
fi
if [ -z "$BUN_BIN" ] || [ ! -x "$BUN_BIN" ]; then
  BUN_BIN="$(command -v bun || true)"
fi
if [ -z "$BUN_BIN" ] || [ ! -x "$BUN_BIN" ]; then
  echo "ax-code: bun runtime not found. Install bun: https://bun.sh/install" >&2
  exit 127
fi
export AX_CODE_ORIGINAL_CWD="$(pwd)"
exec "$BUN_BIN" "$PKG_DIR/bundle/index.js" "$@"
`
}

export function sourceDistributionCmdShim() {
  return `@echo off
rem ax-code source-distribution launcher (Windows)
setlocal
set "SCRIPT_DIR=%~dp0"
set "PKG_DIR=%SCRIPT_DIR%.."
set "BUN_PATH_FILE=%SCRIPT_DIR%.ax-code-bun-path"
set "BUN_BIN="
if exist "%BUN_PATH_FILE%" (
  set /p BUN_BIN=<"%BUN_PATH_FILE%"
)
if not "%BUN_BIN%"=="" if exist "%BUN_BIN%" goto ax_code_have_bun
set "BUN_BIN="
for /f "delims=" %%i in ('where bun 2^>nul') do if "%BUN_BIN%"=="" set "BUN_BIN=%%i"
:ax_code_have_bun
if "%BUN_BIN%"=="" (
  echo ax-code: bun runtime not found. Install bun: https://bun.sh/install 1>&2
  exit /b 127
)
set "AX_CODE_ORIGINAL_CWD=%CD%"
"%BUN_BIN%" "%PKG_DIR%\\bundle\\index.js" %*
`
}

export function sourceDistributionPostinstall() {
  return `#!/usr/bin/env node
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
  // 1. System bun on PATH wins - respects user's preferred install/version.
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

  // 3. Hoisted layout - pnpm/npm may have hoisted the bun bin to the parent.
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

// Ensure the unix shim stays executable after npm pack/unpack - npm has
// historically dropped the +x bit on bin scripts during install.
if (process.platform !== "win32") {
  try {
    chmodSync(path.join(BIN_DIR, "ax-code"), 0o755)
  } catch {}
}
`
}

export type SourcePackageManifestInput = {
  packageName: string
  version: string
  bunDependencyRange: string
  opentuiCoreVersion: string
  license: string
  sourceDistTag: string
}

export function sourcePackageManifest(input: SourcePackageManifestInput) {
  return {
    name: input.packageName,
    version: input.version,
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
      bun: input.bunDependencyRange,
    },
    dependencies: {
      bun: input.bunDependencyRange,
    },
    optionalDependencies: Object.fromEntries(
      OPENTUI_NATIVE_PACKAGES.map((name) => [name, input.opentuiCoreVersion]),
    ),
    license: input.license,
    homepage: "https://github.com/defai-digital/ax-code",
    repository: {
      type: "git",
      url: "https://github.com/defai-digital/ax-code",
    },
    publishConfig: {
      access: "public",
      tag: input.sourceDistTag,
    },
  }
}
