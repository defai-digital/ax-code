/**
 * Manifest-verified native library delivery and cache for AX TUI.
 *
 * @module
 */
export {};
import type { NativeTarget, NativeLibraryOptions, NativeLibraryPaths } from "./types.js";
export type { NativeTarget, NativeLibraryOptions, NativeLibraryPaths } from "./types.js";
/** Prepare an AX TUI native library for rendering or downstream staging. */
export declare function prepareNativeLibrary(target: NativeTarget, options?: NativeLibraryOptions): Promise<NativeLibraryPaths>;
