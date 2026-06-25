// Ambient declarations for the test suite, replacing the jest-extended-style
// matchers and the global `spyOn` that `bun:test` bundled. The matchers are
// registered at runtime in `test/support/vitest.setup.ts` via `expect.extend`.
//
// vitest 4: augment `Matchers` (not `Assertion`), which `Assertion<T>` extends.
// See https://vitest.dev/guide/extending-matchers
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
  interface Matchers<T = any> extends BunCompatMatchers<void> {}
  interface AsymmetricMatchersContaining extends BunCompatMatchers {}
}

declare global {
  // `bun:test` exposed `spyOn` as a global. The suite references it both as a
  // value (runtime calls go through vitest's `vi.spyOn`) and in `typeof spyOn`
  // type positions, including explicit type arguments. Declare a clean generic
  // matching `bun:test`'s signature so both forms resolve.
  function spyOn<T, K extends keyof T>(obj: T, method: K): import("vitest").MockInstance

  // Bun→Node compat shim installed by test/support/vitest.setup.ts.
  // These declarations allow tests that exercise the shim to typecheck.
  interface BunCompatShellPromise extends PromiseLike<{ stdout: Buffer; stderr: Buffer; exitCode: number }> {
    quiet(): Promise<{ stdout: Buffer; stderr: Buffer; exitCode: number }>
  }
  namespace Bun {
    function write(path: string, data: string | Uint8Array): Promise<number>
    function sleep(ms: number): Promise<void>
    function hash(data: string | Uint8Array): { toString(): string }
    const $: {
      (strings: TemplateStringsArray, ...values: unknown[]): BunCompatShellPromise
      env(env: Record<string, string | undefined>): typeof $
    }
    class Glob {
      constructor(pattern: string)
      scan(options?: string | { cwd?: string; dot?: boolean; absolute?: boolean; onlyFiles?: boolean }): AsyncIterable<string>
      scanSync(options?: { cwd?: string; dot?: boolean; absolute?: boolean; onlyFiles?: boolean }): Iterable<string>
    }
    function spawnSync(input: { cmd: string[]; cwd?: string; env?: Record<string, string> }): {
      exitCode: number
      stdout: Buffer
      stderr: Buffer
      success: boolean
    }
  }
}

export {}
