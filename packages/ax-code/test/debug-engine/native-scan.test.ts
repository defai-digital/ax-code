import { describe, expect, test } from "vitest"

describe("debug-engine native scan", () => {
  test("decodes native scan output with explicit schemas", async () => {
    const { parseNativeDetectResult, parseNativeReadFilesBatchResult, parseNativeScanResult } = await import(
      "../../src/debug-engine/native-scan"
    )

    expect(
      parseNativeScanResult(
        JSON.stringify({
          matches: [
            {
              file: "/repo/a.ts",
              line: 1,
              column: 2,
              text: "needle",
              label: "label",
              id: "id",
              contextBefore: [],
              contextAfter: ["after"],
            },
          ],
          filesScanned: 3,
          elapsedMs: 4,
        }),
      ),
    ).toEqual({
      matches: [
        {
          file: "/repo/a.ts",
          line: 1,
          column: 2,
          text: "needle",
          label: "label",
          id: "id",
          contextBefore: [],
          contextAfter: ["after"],
        },
      ],
      filesScanned: 3,
      elapsedMs: 4,
    })

    expect(parseNativeReadFilesBatchResult(JSON.stringify([["/repo/a.ts", "content"]]))).toEqual([
      ["/repo/a.ts", "content"],
    ])
    expect(
      parseNativeDetectResult(
        JSON.stringify({
          findings: [{ file: "/repo/a.ts" }],
          filesScanned: 1,
          truncated: false,
          elapsedMs: 2,
          heuristics: ["h"],
        }),
      ),
    ).toEqual({
      findings: [{ file: "/repo/a.ts" }],
      filesScanned: 1,
      truncated: false,
      elapsedMs: 2,
      heuristics: ["h"],
    })
  })

  test("rejects malformed native scan output", async () => {
    const { parseNativeDetectResult, parseNativeReadFilesBatchResult, parseNativeScanResult } = await import(
      "../../src/debug-engine/native-scan"
    )

    expect(() => parseNativeScanResult("{not json")).toThrow(SyntaxError)
    expect(() => parseNativeScanResult(JSON.stringify({ matches: [], filesScanned: "3", elapsedMs: 4 }))).toThrow(
      SyntaxError,
    )
    expect(() => parseNativeReadFilesBatchResult(JSON.stringify([["/repo/a.ts", 123]]))).toThrow(SyntaxError)
    expect(() =>
      parseNativeDetectResult(JSON.stringify({ findings: [], filesScanned: 1, truncated: "false", elapsedMs: 2 })),
    ).toThrow(SyntaxError)
  })

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
