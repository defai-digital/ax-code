import { dlopen } from "./ffi.js"

export const AX_TUI_NATIVE_ABI = 3

/** Verify the AX-owned interface before binding any renderer functions. */
export function verifyNativeAbi(libraryPath: string): void {
  let probe
  try {
    probe = dlopen(libraryPath, { axTuiAbiVersion: { args: [], returns: "u32" } })
  } catch (cause) {
    throw new Error(`Native library does not expose the AX TUI ABI: ${libraryPath}`, { cause })
  }
  try {
    const actual = probe.symbols.axTuiAbiVersion()
    if (actual !== AX_TUI_NATIVE_ABI) {
      throw new Error(`Incompatible AX TUI native ABI: expected ${AX_TUI_NATIVE_ABI}, received ${actual}`)
    }
  } finally {
    probe.close()
  }
}
