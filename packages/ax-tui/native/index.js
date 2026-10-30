/**
 * Manifest-verified native library delivery and cache for AX TUI.
 *
 * @module
 */
export {};
import { fileURLToPath } from "node:url";
import { prepareNativeLibraryFrom } from "./resolve.js";
/** Prepare an AX TUI native library for rendering or downstream staging. */
export function prepareNativeLibrary(target, options) {
    return prepareNativeLibraryFrom(fileURLToPath(new URL("../", import.meta.url)), target, options);
}
