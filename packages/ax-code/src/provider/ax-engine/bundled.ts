import fs from "fs/promises"
import { accessSync, constants as fsConstants } from "fs"
import path from "path"
import { Process } from "@/util/process"
import { Filesystem } from "@/util/filesystem"
import { AX_ENGINE_BINARY_RELEASE, AX_ENGINE_MANAGED_BINARY_NAME } from "./constants"
import { AX_ENGINE_BUNDLED_DIR_NAME, missingAxEngineRuntimeFiles } from "./payload"

async function isExecutable(file: string) {
  return fs
    .access(file, fsConstants.X_OK)
    .then(() => true)
    .catch(() => false)
}

function existsSyncPath(file: string) {
  try {
    accessSync(file)
    return true
  } catch {
    return false
  }
}

function runtimeRootFromEntry(entryPath: string | undefined): string | undefined {
  if (!entryPath?.trim()) return undefined
  const resolved = path.resolve(entryPath)
  const dir = path.dirname(resolved)
  const base = path.basename(resolved)
  if (path.basename(dir) !== "lib") return undefined
  if (!base.startsWith("index-node-tui.")) return undefined
  return path.dirname(dir)
}

function bundledPath(runtimeRoot: string, ...segments: string[]) {
  const root = path.resolve(runtimeRoot)
  const candidate = path.resolve(root, ...segments)
  if (!Filesystem.contains(Filesystem.resolve(root), Filesystem.resolve(candidate))) {
    throw new Error("Bundled AX Engine path escapes the runtime root")
  }
  return candidate
}

export function bundledEngineDir(runtimeRoot: string, version: string) {
  return bundledPath(runtimeRoot, AX_ENGINE_BUNDLED_DIR_NAME, version)
}

export async function getBundledBinary(
  input: { entryPath?: string } = {},
): Promise<{ path: string; version: string } | undefined> {
  const release = AX_ENGINE_BINARY_RELEASE
  if (!release) return undefined
  const entry = input.entryPath ?? process.env.AX_CODE_CLI_ENTRY ?? process.argv[1]
  const root = runtimeRootFromEntry(entry)
  if (!root) return undefined
  const dir = bundledEngineDir(root, release.version)
  const binary = bundledPath(dir, AX_ENGINE_MANAGED_BINARY_NAME)
  if (!(await isExecutable(binary))) return undefined
  const missing = missingAxEngineRuntimeFiles(dir, existsSyncPath)
  if (missing.length) return undefined
  // Browser-unzipped or AirDropped runtimes can carry com.apple.quarantine.
  // Overlay installs already strip it; the bundled floor must too or the first
  // `ax-engine serve` is killed by Gatekeeper before the sidecar starts.
  if (process.platform === "darwin") {
    await Process.run(["xattr", "-cr", dir], { timeout: 5_000, nothrow: true }).catch(() => undefined)
  }
  return { path: binary, version: release.version }
}
