import { afterEach, describe, expect, test } from "vitest"
import { Env } from "../../src/util/env"

// The Bun→Node compat shim is installed globally by test/support/vitest.setup.ts.
const Bun = (globalThis as unknown as { Bun: { $: any } }).Bun

describe("node-compat Bun.$ shell", () => {
  const SECRET = "PLUGIN_LEAK_API_KEY"

  afterEach(() => {
    delete process.env[SECRET]
  })

  // Regression: the plugin host gives plugins `Bun.$.env(Env.sanitize(process.env))`
  // so an untrusted plugin shell cannot read provider tokens. Bun's `$.env(obj)`
  // REPLACES the environment; if the shim merged process.env back in as a base,
  // sanitize()'s stripped keys (omitted, not set to undefined) would reappear.
  test(".env(obj) replaces the environment instead of merging process.env", async () => {
    process.env[SECRET] = "should-not-leak"
    const sanitized = Env.sanitize(process.env)
    expect(sanitized[SECRET]).toBeUndefined()

    const shell = Bun.$.env(sanitized)
    const res =
      await shell`${process.execPath} -e ${"process.stdout.write(Object.keys(process.env).join(String.fromCharCode(10)))"}`.quiet()
    const keys = res.stdout.toString().split("\n")

    expect(keys).not.toContain(SECRET)
    // PATH is not secret-like, so sanitize keeps it and the child still resolves.
    expect(keys).toContain("PATH")
  })

  // Bun's `$` flattens an interpolated array into separate escaped args; a naive
  // String(array) would collapse them into one comma-joined token.
  test("interpolated arrays flatten into separate arguments", async () => {
    const args = ["one", "two three", "fo'ur"]
    const res =
      await Bun.$`${process.execPath} -e ${"process.stdout.write(process.argv.slice(1).join(String.fromCharCode(10)))"} ${args}`.quiet()
    const printed = res.stdout.toString().split("\n")
    expect(printed).toEqual(args)
  })
})
