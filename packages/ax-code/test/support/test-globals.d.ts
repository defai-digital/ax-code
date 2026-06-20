// Ambient declarations for the test suite, replacing the jest-extended-style
// matchers and the global `spyOn` that `bun:test` bundled. The matchers are
// registered at runtime in `test/support/vitest.setup.ts` via `expect.extend`.
import "vitest"

interface BunCompatMatchers<R = unknown> {
  toBeFunction(): R
  toBeNumber(): R
  toBeString(): R
  toBeNil(): R
  toBeArray(): R
  toBeTrue(): R
  toBeFalse(): R
  toStartWith(prefix: string): R
  toEndWith(suffix: string): R
  toInclude(substring: string): R
}

declare module "vitest" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Assertion<T = any> extends BunCompatMatchers<void> {}
  interface AsymmetricMatchersContaining extends BunCompatMatchers {}
}

declare global {
  // `bun:test` exposed `spyOn` as a global. The suite references it both as a
  // value (runtime calls go through vitest's `vi.spyOn`) and in `typeof spyOn`
  // type positions, including explicit type arguments. Declare a clean generic
  // matching `bun:test`'s signature so both forms resolve.
  function spyOn<T, K extends keyof T>(obj: T, method: K): import("vitest").MockInstance
}

export {}
