/**
 * Shared Kitty-protocol modifier-mask decoding.
 *
 * This module is intentionally NOT re-exported from `lib/index.ts`: it stays
 * an internal detail of the key parsers so the public package surface is
 * unchanged.
 *
 * @module
 */

/**
 * Decode a Kitty-protocol modifier mask (with the conventional `+1` bias
 * already removed) into individual modifier flags. Shared by the Kitty
 * keyboard parser and the modifyOtherKeys (CSI 27;mod;code~) decode path in
 * parse.keypress.ts.
 */
export function fromKittyMods(mod: number): {
  shift: boolean
  alt: boolean
  ctrl: boolean
  super: boolean
  hyper: boolean
  meta: boolean
  capsLock: boolean
  numLock: boolean
} {
  return {
    shift: !!(mod & 1),
    alt: !!(mod & 2),
    ctrl: !!(mod & 4),
    super: !!(mod & 8),
    hyper: !!(mod & 16),
    meta: !!(mod & 32),
    capsLock: !!(mod & 64),
    numLock: !!(mod & 128),
  }
}
