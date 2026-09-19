import fs from "fs"
import path from "path"
import { AX_ENGINE_MANAGED_BINARY_NAME } from "./constants"

const MACHO_MAGICS = new Set(["cafebabe", "cafebabf", "cefaedfe", "cffaedfe", "feedface", "feedfacf"])

/** Directory name inside a node-bundled AX Code runtime that holds the sidecar. */
export const AX_ENGINE_BUNDLED_DIR_NAME = "engine"

/** Files that must be colocated for a clean-Mac model load (@loader_path MLX). */
export const AX_ENGINE_RUNTIME_REQUIRED_FILES = [
  AX_ENGINE_MANAGED_BINARY_NAME,
  "ax-engine-server",
  "libmlx.dylib",
  "libjaccl.dylib",
  "mlx.metallib",
] as const

/** Mach-O files that must be executable and code-signature verified. */
export const AX_ENGINE_RUNTIME_SIGNED_FILES = [
  AX_ENGINE_MANAGED_BINARY_NAME,
  "ax-engine-server",
  "libmlx.dylib",
  "libjaccl.dylib",
] as const

export function axEngineRuntimeFile(dir: string, name: string) {
  return path.join(dir, name)
}

export function missingAxEngineRuntimeFiles(dir: string, exists: (file: string) => boolean): string[] {
  return AX_ENGINE_RUNTIME_REQUIRED_FILES.filter((name) => !exists(axEngineRuntimeFile(dir, name)))
}

export function isMachOFile(file: string): boolean {
  try {
    const fd = fs.openSync(file, "r")
    try {
      const magic = Buffer.alloc(4)
      const bytes = fs.readSync(fd, magic, 0, 4, 0)
      return bytes === 4 && MACHO_MAGICS.has(magic.toString("hex"))
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return false
  }
}
