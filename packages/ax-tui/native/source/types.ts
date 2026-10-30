/**
 * Manifest-verified native library delivery and cache for ax-tui.
 *
 * @module
 */
export {}
/** Supported operating-system, architecture, and libc target triple. */
export type NativeTarget =
  | "darwin-arm64"
  | "darwin-x64"
  | "linux-arm64"
  | "linux-arm64-musl"
  | "linux-x64"
  | "linux-x64-musl"
  | "win32-arm64"
  | "win32-x64"

/** Cache, offline, and abort options for {@link prepareNativeLibrary}. */
export interface NativeLibraryOptions {
  cacheDir?: string
  offline?: boolean
  signal?: AbortSignal
}

/** Resolved native library and license paths. */
export interface NativeLibraryPaths {
  libraryPath: string
  licensePath: string
}
