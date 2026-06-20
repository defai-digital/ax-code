import { describe, expect, test } from "vitest"
import fs from "fs/promises"
import path from "path"
import { Filesystem } from "@/util/filesystem"
import { tmpdir } from "../fixture/fixture"
import { SuperLongPolicy } from "@/session/super-long-policy"

async function loadSuperLongRuntime() {
  const { SuperLongRuntime } = await import("@/session/super-long-runtime")
  return SuperLongRuntime
}

async function withRuntimeStore<T>(
  fn: (runtime: Awaited<ReturnType<typeof loadSuperLongRuntime>>, storePath: string) => Promise<T>,
): Promise<T> {
  await using tmp = await tmpdir()
  const previous = process.env.AX_CODE_SUPER_LONG_RUNTIME_STORE
  const storePath = path.join(tmp.path, "super-long-runtime.json")
  process.env.AX_CODE_SUPER_LONG_RUNTIME_STORE = storePath
  try {
    const runtime = await loadSuperLongRuntime()
    await runtime.resetForTest()
    return await fn(runtime, storePath)
  } finally {
    if (previous === undefined) delete process.env.AX_CODE_SUPER_LONG_RUNTIME_STORE
    else process.env.AX_CODE_SUPER_LONG_RUNTIME_STORE = previous
  }
}

describe("SuperLongRuntime", () => {
  test("keeps a durable session start across prompt-loop resumes", async () => {
    await withRuntimeStore(async (SuperLongRuntime) => {
      const first = await SuperLongRuntime.sessionStartedAt({ sessionID: "ses_qwen", now: 1_000 })
      const resumed = await SuperLongRuntime.sessionStartedAt({ sessionID: "ses_qwen", now: 2_000 })

      expect(first).toBe(1_000)
      expect(resumed).toBe(1_000)
    })
  })

  test("reserves provider pacing through a durable store", async () => {
    await withRuntimeStore(async (SuperLongRuntime) => {
      const policy: SuperLongPolicy.PacingPolicy = {
        windowMs: 1_000,
        maxRequests: 10,
        minDelayMs: 100,
      }

      const first = await SuperLongRuntime.reservePacing({ key: "alibaba-coding-plan/qwen3.7-max", now: 1_000, policy })
      const second = await SuperLongRuntime.reservePacing({
        key: "alibaba-coding-plan/qwen3.7-max",
        now: 1_050,
        policy,
      })

      expect(first.decision.reason).toBe("allowed")
      expect(first.state?.timestamps).toEqual([1_000])
      expect(second.decision).toMatchObject({ reason: "min-delay", waitMs: 50 })
      expect(second.state).toBeUndefined()
    })
  })

  test("normalizes durable pacing state on wait decisions", async () => {
    await withRuntimeStore(async (SuperLongRuntime, storePath) => {
      const key = "alibaba-coding-plan/qwen3.7-max"
      await Filesystem.writeJson(storePath, {
        pacing: {
          [key]: {
            timestamps: [1_500, 1_000, 500],
          },
        },
      })

      const decision = await SuperLongRuntime.reservePacing({
        key,
        now: 1_550,
        policy: {
          windowMs: 1_000,
          maxRequests: 10,
          minDelayMs: 100,
        },
      })
      const store = await Filesystem.readJson<{ pacing?: Record<string, SuperLongPolicy.PacingState> }>(storePath)

      expect(decision.decision).toMatchObject({ reason: "min-delay", waitMs: 50 })
      expect(decision.state).toBeUndefined()
      expect(store.pacing?.[key]?.timestamps).toEqual([1_000, 1_500])
    })
  })

  test("releases only one durable pacing reservation when timestamps collide", async () => {
    await withRuntimeStore(async (SuperLongRuntime) => {
      const policy: SuperLongPolicy.PacingPolicy = {
        windowMs: 1_000,
        maxRequests: 10,
        minDelayMs: 0,
      }
      const key = "alibaba-coding-plan/qwen3.7-max"

      await SuperLongRuntime.reservePacing({ key, now: 1_000, policy })
      await SuperLongRuntime.reservePacing({ key, now: 1_000, policy })
      await SuperLongRuntime.releasePacingReservation({ key, timestamp: 1_000, now: 1_001 })
      const next = await SuperLongRuntime.reservePacing({ key, now: 1_001, policy })

      expect(next.state?.timestamps).toEqual([1_000, 1_001])
    })
  })

  test("does not overwrite a malformed durable runtime store", async () => {
    await withRuntimeStore(async (SuperLongRuntime, storePath) => {
      const malformed = "{not json"
      await fs.writeFile(storePath, malformed)

      await expect(SuperLongRuntime.sessionStartedAt({ sessionID: "ses_qwen", now: 1_000 })).rejects.toThrow(
        "Failed to parse JSON",
      )
      expect(await fs.readFile(storePath, "utf8")).toBe(malformed)
    })
  })

  test("does not overwrite a structurally invalid durable runtime store", async () => {
    await withRuntimeStore(async (SuperLongRuntime, storePath) => {
      await fs.writeFile(storePath, "[]")

      await expect(
        SuperLongRuntime.reservePacing({
          key: "alibaba-coding-plan/qwen3.7-max",
          now: 1_000,
          policy: {
            windowMs: 1_000,
            maxRequests: 10,
            minDelayMs: 100,
          },
        }),
      ).rejects.toThrow("Invalid super-long runtime store")
      expect(await fs.readFile(storePath, "utf8")).toBe("[]")
    })
  })
})
