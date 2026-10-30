/**
 * Manifest-verified native library delivery and cache for AX TUI.
 *
 * @module
 */
export {}
import { fileURLToPath } from "node:url"
import { prepareNativeLibraryFrom } from "./resolve.js"
import type { NativeTarget, NativeLibraryOptions, NativeLibraryPaths } from "./types.js"
export type { NativeTarget, NativeLibraryOptions, NativeLibraryPaths } from "./types.js"

/** Prepare an AX TUI native library for rendering or downstream staging. */
export function prepareNativeLibrary(
  target: NativeTarget,
  options?: NativeLibraryOptions,
): Promise<NativeLibraryPaths> {
  return prepareNativeLibraryFrom(fileURLToPath(new URL("../", import.meta.url)), target, options)
}
