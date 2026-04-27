import { describe, expect, test, afterEach, beforeEach } from "bun:test"
import { BlastRadius } from "../../src/session/blast-radius"
import type { SessionID } from "../../src/session/schema"

const SID = "ses_blast_test_0001" as unknown as SessionID

describe("BlastRadius", () => {
  beforeEach(() => {
    BlastRadius.reset(SID)
  })

  afterEach(() => {
    BlastRadius.reset(SID)
    delete process.env["AX_CODE_AUTONOMOUS"]
  })

  test("step counter starts at 0 and increments", () => {
    expect(BlastRadius.incrementStep(SID)).toBe(1)
    expect(BlastRadius.incrementStep(SID)).toBe(2)
  })

  test("recordWrite is idempotent for the same path", () => {
    BlastRadius.recordWrite(SID, "/a/b.ts", 10)
    BlastRadius.recordWrite(SID, "/a/b.ts", 5)
    const state = BlastRadius.get(SID)
    expect(state.files.size).toBe(1)
    expect(state.lines).toBe(15)
  })

  test("isPathBlocked matches glob patterns", () => {
    BlastRadius.get(SID, { blockedPaths: [".env", "**/secrets/**", "infra/**"] })
    expect(BlastRadius.isPathBlocked(SID, ".env").blocked).toBe(true)
    expect(BlastRadius.isPathBlocked(SID, "src/secrets/key.txt").blocked).toBe(true)
    expect(BlastRadius.isPathBlocked(SID, "infra/terraform.tfstate").blocked).toBe(true)
    expect(BlastRadius.isPathBlocked(SID, "src/index.ts").blocked).toBe(false)
  })

  test("default AUTONOMOUS_BLOCKED_PATHS catches nested dotenv and secrets (regression: HIGH security finding)", () => {
    // Ensures the glob list covers nested placements, not just top-level.
    // Wildcard.match anchors patterns with ^...$ and treats * as regex .*,
    // so the list must include both `X` and `**/X` for "anywhere" guards.
    // Reset to defaults — get() with no overrides uses AUTONOMOUS_BLOCKED_PATHS.
    BlastRadius.reset(SID)
    BlastRadius.get(SID)

    // Top-level (these always worked)
    expect(BlastRadius.isPathBlocked(SID, ".env").blocked).toBe(true)
    expect(BlastRadius.isPathBlocked(SID, ".env.local").blocked).toBe(true)

    // Nested .env / .env.* — were the bypass before the fix
    expect(BlastRadius.isPathBlocked(SID, "packages/ax-code/.env").blocked).toBe(true)
    expect(BlastRadius.isPathBlocked(SID, "apps/web/.env.production").blocked).toBe(true)

    // Top-level secrets/ — was the bypass before the fix
    expect(BlastRadius.isPathBlocked(SID, "secrets/credentials.json").blocked).toBe(true)
    // Nested secrets/ — already worked
    expect(BlastRadius.isPathBlocked(SID, "src/secrets/keys.json").blocked).toBe(true)

    // Top-level .git/hooks/ — was the bypass before the fix
    expect(BlastRadius.isPathBlocked(SID, ".git/hooks/post-commit").blocked).toBe(true)

    // Negative cases
    expect(BlastRadius.isPathBlocked(SID, "src/index.ts").blocked).toBe(false)
    expect(BlastRadius.isPathBlocked(SID, "test/foo/env.test.ts").blocked).toBe(false)
  })

  test("checkAfterIncrement returns null while under caps", () => {
    BlastRadius.get(SID, { steps: 5, files: 5, lines: 100 })
    BlastRadius.incrementStep(SID)
    expect(BlastRadius.checkAfterIncrement(SID)).toBeNull()
  })

  test("checkAfterIncrement reports steps overage", () => {
    BlastRadius.get(SID, { steps: 2, files: 100, lines: 1000 })
    BlastRadius.incrementStep(SID)
    BlastRadius.incrementStep(SID)
    BlastRadius.incrementStep(SID)
    const result = BlastRadius.checkAfterIncrement(SID)
    expect(result?.kind).toBe("steps")
    expect(result?.current).toBe(3)
    expect(result?.limit).toBe(2)
  })

  test("checkAfterIncrement reports lines overage", () => {
    BlastRadius.get(SID, { steps: 100, files: 100, lines: 10 })
    BlastRadius.recordWrite(SID, "/a", 11)
    expect(BlastRadius.checkAfterIncrement(SID)?.kind).toBe("lines")
  })

  test("assertWritable is a no-op when not autonomous", () => {
    BlastRadius.get(SID, { blockedPaths: [".env"] })
    expect(() => BlastRadius.assertWritable(SID, ".env")).not.toThrow()
  })

  test("assertWritable throws on blocked path in autonomous mode", () => {
    process.env["AX_CODE_AUTONOMOUS"] = "true"
    BlastRadius.get(SID, { blockedPaths: [".env"] })
    expect(() => BlastRadius.assertWritable(SID, ".env")).toThrow(/blocked-path pattern/)
  })

  test("recordWriteAndAssert no-ops when not autonomous", () => {
    BlastRadius.get(SID, { steps: 1, files: 1, lines: 1 })
    expect(() => BlastRadius.recordWriteAndAssert(SID, "/a", 100)).not.toThrow()
    // No accounting when autonomous is off.
    expect(BlastRadius.get(SID).lines).toBe(0)
  })

  test("recordWriteAndAssert tallies and throws once over caps", () => {
    process.env["AX_CODE_AUTONOMOUS"] = "true"
    BlastRadius.get(SID, { steps: 100, files: 100, lines: 5 })
    BlastRadius.recordWriteAndAssert(SID, "/a", 3)
    expect(() => BlastRadius.recordWriteAndAssert(SID, "/b", 10)).toThrow()
  })
})
