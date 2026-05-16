import { describe, expect, test } from "bun:test"

describe("debug-engine native scan", () => {
  test("keeps native worktree scanners opt-in by default", async () => {
    if (process.env.AX_CODE_DEBUG_ENGINE_NATIVE_SCAN) return

    const { Flag } = await import("../../src/flag/flag")
    const { nativeReadFilesBatch, nativeDetectLifecycle } = await import("../../src/debug-engine/native-scan")

    expect(Flag.AX_CODE_DEBUG_ENGINE_NATIVE_SCAN).toBe(false)
    expect(nativeReadFilesBatch(["/tmp/ax-code-native-scan-disabled.ts"])).toBeUndefined()
    expect(
      nativeDetectLifecycle({
        cwd: "/tmp",
        include: ["**/*.ts"],
        patterns: ["timer"],
      }),
    ).toBeUndefined()
  })
})
