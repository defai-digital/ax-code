import { describe, expect, test } from "bun:test"
import { spawnExitsCleanly } from "../../src/mcp/discovery"

describe("mcp.discovery spawnExitsCleanly", () => {
  test("returns true when the command exits with code 0", async () => {
    expect(await spawnExitsCleanly("true", [])).toBe(true)
  })

  test("returns false when the command exits non-zero", async () => {
    expect(await spawnExitsCleanly("false", [])).toBe(false)
  })

  test("returns false when the command does not exist (cross-spawn ENOENT)", async () => {
    expect(await spawnExitsCleanly("ax-code-no-such-binary-xyz123", [])).toBe(false)
  })

  test("returns false when the command exceeds the timeout budget", async () => {
    // Sleep 60s but force a 200ms cap. Helper must kill the process and
    // resolve(false) within the timeout window, not block the test for
    // a minute.
    const started = Date.now()
    const result = await spawnExitsCleanly("sleep", ["60"], { timeoutMs: 200 })
    const elapsed = Date.now() - started
    expect(result).toBe(false)
    // Generous upper bound — timeout fires at 200ms, kill + resolve adds
    // a bit, but should never approach 60s if the timeout works.
    expect(elapsed).toBeLessThan(5_000)
  })
})
