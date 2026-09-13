import { afterEach, expect, test, vi } from "vitest"
import z from "zod"
import { EvidenceCache } from "../../src/evidence/cache"
import { NativeAddon } from "../../src/native/addon"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

test("memory cache validates shape, expires entries, bounds bytes and isolates projects", async () => {
  vi.stubEnv("AX_CODE_EVIDENCE_CACHE", "memory")
  await using a = await tmpdir()
  await using b = await tmpdir()
  const key = EvidenceCache.key("test", "source")
  await Instance.provide({
    directory: a.path,
    fn: async () => {
      await EvidenceCache.put(key, { text: "source" })
      expect(await EvidenceCache.get(key, z.object({ text: z.string() }))).toEqual({ text: "source" })
      expect(await EvidenceCache.get(key, z.array(z.string()))).toBeUndefined()
      for (let i = 0; i < 140; i++) await EvidenceCache.put(EvidenceCache.key(i), "x".repeat(100_000))
      const stats = await EvidenceCache.stats()
      expect(stats.bytes).toBeLessThanOrEqual(4 * 1024 * 1024)
      expect(stats.entries).toBeLessThanOrEqual(128)
      await EvidenceCache.put(key, "expire")
      const now = Date.now()
      vi.spyOn(Date, "now").mockReturnValue(now + 25 * 60 * 60 * 1000)
      expect(await EvidenceCache.get(key, z.string())).toBeUndefined()
      vi.restoreAllMocks()
    },
  })
  await Instance.provide({
    directory: b.path,
    fn: async () => {
      expect(await EvidenceCache.get(key, z.string())).toBeUndefined()
    },
  })
})

test("absent or locked native store falls back; invalid/off mode never opens it", async () => {
  const loader = vi.spyOn(NativeAddon, "fs").mockReturnValue(undefined)
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      for (const mode of ["off", "invalid"]) {
        vi.stubEnv("AX_CODE_EVIDENCE_CACHE", mode)
        await EvidenceCache.put(EvidenceCache.key("off"), "value")
        expect((await EvidenceCache.stats()).backend).toBe("off")
      }
      expect(loader).not.toHaveBeenCalled()
      vi.stubEnv("AX_CODE_EVIDENCE_CACHE", "rocksdb")
      await EvidenceCache.put(EvidenceCache.key("fallback"), "value")
      expect(await EvidenceCache.get(EvidenceCache.key("fallback"), z.string())).toBe("value")
      expect((await EvidenceCache.stats()).backend).toBe("memory")
    },
  })
})

test("native open and read errors preserve ordinary memory fallback", async () => {
  vi.stubEnv("AX_CODE_EVIDENCE_CACHE", "rocksdb")
  const binding = NativeAddon.fs()
  await using locked = await tmpdir()
  const loader = vi.spyOn(NativeAddon, "fs").mockReturnValue({
    ...binding,
    openEvidenceStore: async () => {
      throw new Error("locked")
    },
  } as NonNullable<ReturnType<typeof NativeAddon.fs>>)
  await Instance.provide({
    directory: locked.path,
    fn: async () => {
      await EvidenceCache.put(EvidenceCache.key("locked"), "value")
      expect(await EvidenceCache.get(EvidenceCache.key("locked"), z.string())).toBe("value")
      expect((await EvidenceCache.stats()).backend).toBe("memory")
    },
  })
  const close = vi.fn(async () => {})
  loader.mockReturnValue({
    ...binding,
    openEvidenceStore: async () => ({
      get: async () => {
        throw new Error("I/O failure")
      },
      put: async () => {},
      close,
    }),
  } as NonNullable<ReturnType<typeof NativeAddon.fs>>)
  await using broken = await tmpdir()
  await Instance.provide({
    directory: broken.path,
    fn: async () => {
      expect(await EvidenceCache.get(EvidenceCache.key("broken"), z.string())).toBeUndefined()
      expect(close).toHaveBeenCalledOnce()
      await EvidenceCache.put(EvidenceCache.key("broken"), "fresh")
      expect(await EvidenceCache.get(EvidenceCache.key("broken"), z.string())).toBe("fresh")
    },
  })
})

test("a native close failure cannot prevent project disposal", async () => {
  vi.stubEnv("AX_CODE_EVIDENCE_CACHE", "rocksdb")
  const binding = NativeAddon.fs()
  const close = vi.fn(async () => {
    throw new Error("close failed")
  })
  vi.spyOn(NativeAddon, "fs").mockReturnValue({
    ...binding,
    openEvidenceStore: async () => ({ get: async () => null, put: async () => {}, close }),
  } as NonNullable<ReturnType<typeof NativeAddon.fs>>)
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      expect((await EvidenceCache.stats()).backend).toBe("rocksdb")
    },
  })
  await expect(Instance.disposeAll()).resolves.toBeUndefined()
  expect(close).toHaveBeenCalledOnce()
})
