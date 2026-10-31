import { detectCapabilities } from "@ax-code/akitty-sdk"
import type { Environment } from "@ax-code/akitty-sdk"

// The program-chrome surface that non-TUI code paths need, split from
// program-chrome.ts: terminal-cleanup.ts loads on every CLI start (boot ->
// thread), and pulling the pixel-art animation modules through it rasterized
// ~500 frames before the first byte of output. program-chrome.ts registers
// its real teardown here; until it loads no chrome can be active, so dispose
// stays a safe no-op.

export function supportsTuiProgramChrome(env: Environment, isTTY: boolean) {
  return detectCapabilities(env, isTTY).chrome
}

let disposer: (() => boolean) | undefined

export function registerTuiProgramChromeDisposer(dispose: () => boolean) {
  disposer = dispose
}

/** Stop any active program chrome and forget the state needed to revive it. */
export function disposeTuiProgramChrome() {
  return disposer?.() ?? false
}
