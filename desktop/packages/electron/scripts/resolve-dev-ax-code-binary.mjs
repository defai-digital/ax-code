/**
 * Resolve the ax-code CLI binary for monorepo Desktop `dev` runs.
 *
 * Desktop's managed server spawns `ax-code serve`. Preference order:
 *   1. Explicit AX_CODE_BINARY (when executable)
 *   2. Generated monorepo source launcher under electron/.dev-bin/
 *      (so local catalog/provider edits are visible without setup:cli)
 *   3. PATH lookup (Homebrew / installed CLI) as a last resort
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const defaultElectronDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

export const isExecutable = (filePath, accessSync = fs.accessSync, statSync = fs.statSync) => {
  try {
    accessSync(filePath, fs.constants.X_OK)
    return statSync(filePath).isFile()
  } catch {
    return false
  }
}

export const searchPathFor = (
  command,
  env = process.env,
  platform = process.platform,
  deps = {},
) => {
  const pathValue = env.PATH || ""
  const delimiter = deps.delimiter ?? path.delimiter
  const join = deps.join ?? path.join
  const executable = deps.isExecutable ?? isExecutable
  for (const dir of pathValue.split(delimiter).filter(Boolean)) {
    const candidate = join(dir, command)
    if (executable(candidate)) return candidate
  }
  // Windows shims may be registered without extension; try bare name too.
  if (platform === "win32" && !path.extname(command)) {
    return null
  }
  return null
}

export function monorepoRootFromElectronDir(electronDir) {
  // desktop/packages/electron → ../../../ monorepo root
  return path.resolve(electronDir, "..", "..", "..")
}

/**
 * @param {object} [options]
 * @param {string} [options.electronDir]
 * @param {string} [options.monorepoRoot]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {NodeJS.Platform} [options.platform]
 * @param {typeof fs} [options.fs]
 * @param {(msg: string) => void} [options.warn]
 * @returns {string | null} Absolute path to an executable CLI entry, or null.
 */
export function resolveDevAxCodeBinary(options = {}) {
  const electronDir = options.electronDir ?? defaultElectronDir
  const monorepoRoot = options.monorepoRoot ?? monorepoRootFromElectronDir(electronDir)
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const fsp = options.fs ?? fs
  const warn = options.warn ?? ((msg) => console.warn(msg))
  const executable = options.isExecutable ?? ((p) => isExecutable(p, fsp.accessSync.bind(fsp), fsp.statSync.bind(fsp)))

  const explicit = typeof env.AX_CODE_BINARY === "string" ? env.AX_CODE_BINARY.trim() : ""
  if (explicit) {
    if (executable(explicit)) return explicit
    warn(`[electron-dev] AX_CODE_BINARY="${explicit}" is not executable; falling back to monorepo source / PATH`)
  }

  const entry = path.join(monorepoRoot, "packages", "ax-code", "src", "index-node-tui.ts")
  const loader = path.join(monorepoRoot, "script", "solid-loader.mjs")
  const nodeFfiRunner = path.join(monorepoRoot, "script", "node-ffi-runner.mjs")
  const packageCwd = path.join(monorepoRoot, "packages", "ax-code")
  if (fsp.existsSync(entry) && fsp.existsSync(nodeFfiRunner)) {
    const binDir = path.join(electronDir, ".dev-bin")
    fsp.mkdirSync(binDir, { recursive: true })
    if (platform === "win32") {
      const launcher = path.join(binDir, "ax-code.cmd")
      fsp.writeFileSync(
        launcher,
        [
          "@echo off",
          `set "AX_CODE_SOURCE_CWD=${packageCwd}"`,
          `set "AX_CODE_SOURCE_ENTRY=${entry}"`,
          `set "AX_CODE_SOURCE_LOADER=${loader}"`,
          `set "AX_CODE_SOURCE_NODE_FFI_RUNNER=${nodeFfiRunner}"`,
          "set AX_CODE_ORIGINAL_CWD=%CD%",
          'cd /d "%AX_CODE_SOURCE_CWD%"',
          'node "%AX_CODE_SOURCE_NODE_FFI_RUNNER%" --import tsx --import "%AX_CODE_SOURCE_LOADER%" --conditions=node "%AX_CODE_SOURCE_ENTRY%" %*',
          "",
        ].join(os.EOL),
        "utf8",
      )
      return launcher
    }

    const launcher = path.join(binDir, "ax-code")
    fsp.writeFileSync(
      launcher,
      [
        "#!/bin/sh",
        `AX_CODE_SOURCE_CWD=${JSON.stringify(packageCwd)}`,
        `AX_CODE_SOURCE_ENTRY=${JSON.stringify(entry)}`,
        `AX_CODE_SOURCE_LOADER=${JSON.stringify(loader)}`,
        `AX_CODE_SOURCE_NODE_FFI_RUNNER=${JSON.stringify(nodeFfiRunner)}`,
        'export AX_CODE_ORIGINAL_CWD="$(pwd)"',
        'cd "$AX_CODE_SOURCE_CWD" || exit 1',
        'exec node "$AX_CODE_SOURCE_NODE_FFI_RUNNER" --import tsx --import "$AX_CODE_SOURCE_LOADER" --conditions=node "$AX_CODE_SOURCE_ENTRY" "$@"',
        "",
      ].join("\n"),
      { encoding: "utf8", mode: 0o755 },
    )
    fsp.chmodSync(launcher, 0o755)
    return launcher
  }

  const pathLookup =
    searchPathFor(platform === "win32" ? "ax-code.cmd" : "ax-code", env, platform, {
      isExecutable: executable,
    }) || searchPathFor("ax-code", env, platform, { isExecutable: executable })
  if (pathLookup) return pathLookup

  warn(
    "[electron-dev] monorepo source CLI not found; Desktop will start without AX Code integration unless AX_CODE_BINARY is set",
  )
  return null
}
