import { describe, expect, test } from "bun:test"
import { BunProc } from "../../src/bun"

describe("BunProc.resolveExecutable", () => {
  test("uses the current executable outside compiled runtime", () => {
    expect(
      BunProc.resolveExecutable({
        execPath: "/opt/homebrew/bin/bun",
        runtimeMode: "source",
        which: () => "/usr/local/bin/bun",
      }),
    ).toBe("/opt/homebrew/bin/bun")
  })

  test("prefers a real bun executable in compiled runtime", () => {
    expect(
      BunProc.resolveExecutable({
        execPath: "/opt/homebrew/bin/ax-code",
        runtimeMode: "compiled",
        which: () => "/opt/homebrew/bin/bun",
      }),
    ).toBe("/opt/homebrew/bin/bun")
  })

  test("does not reuse the compiled ax-code binary as bun", () => {
    expect(
      BunProc.resolveExecutable({
        execPath: "/opt/homebrew/bin/ax-code",
        runtimeMode: "compiled",
        which: () => "/opt/homebrew/bin/ax-code",
      }),
    ).toBe("bun")
  })
})
