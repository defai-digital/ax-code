import { beforeEach, describe, expect, test, vi } from "vitest"
import { createRoot } from "solid-js"

// Deferred initial read so tests control exactly when kv.json "loads".
let resolveLoad: (value: unknown) => void
const readOptionalJsonState = vi.fn(
  () =>
    new Promise((resolve) => {
      resolveLoad = resolve
    }),
)

const writeJson = vi.fn((_path: string, _value: unknown) => Promise.resolve())

vi.mock("@tui/util/optional-json-state", () => ({
  readOptionalJsonState: (...args: unknown[]) => readOptionalJsonState(...(args as [])),
}))
// Only override writeJson: other modules in the import graph (and the shared
// preload teardown) rely on the real Filesystem namespace.
vi.mock("@/util/filesystem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/util/filesystem")>()
  return {
    ...actual,
    Filesystem: {
      ...actual.Filesystem,
      writeJson: (path: string, value: unknown) => writeJson(path, value),
    },
  }
})

import { createKVStore } from "../../../src/cli/cmd/tui/context/kv"

function flush() {
  // Drain the microtask queue a few times so promise chains settle.
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function makeKV() {
  return createRoot((dispose) => {
    const kv = createKVStore()
    return { kv, dispose }
  })
}

beforeEach(() => {
  readOptionalJsonState.mockClear()
  writeJson.mockClear()
})

describe("tui kv store initial-load race", () => {
  test("a set() before the initial read resolves does not persist a near-empty snapshot", async () => {
    const { kv, dispose } = makeKV()
    try {
      kv.set("theme_mode", "dark")
      await flush()
      // Nothing must be written while kv.json is still loading — a write here
      // would snapshot the near-empty store and wipe persisted settings.
      expect(writeJson).not.toHaveBeenCalled()
      expect(kv.get("theme_mode")).toBe("dark")
      expect(kv.ready).toBe(false)
    } finally {
      dispose()
    }
  })

  test("early writes win over loaded values and persist merged with them", async () => {
    const { kv, dispose } = makeKV()
    try {
      kv.set("theme_mode", "dark")
      resolveLoad({ status: "found", value: { theme: "tokyonight", theme_mode: "light", skipped_version: "1.2.3" } })
      await flush()
      expect(kv.ready).toBe(true)
      // The late read must not revert the fresh in-memory value...
      expect(kv.get("theme_mode")).toBe("dark")
      // ...while untouched persisted keys survive.
      expect(kv.get("theme")).toBe("tokyonight")
      expect(kv.get("skipped_version")).toBe("1.2.3")
      // Exactly one write, containing loaded values merged with the early set.
      expect(writeJson).toHaveBeenCalledTimes(1)
      expect(writeJson.mock.calls[0]?.[1]).toEqual({
        theme: "tokyonight",
        theme_mode: "dark",
        skipped_version: "1.2.3",
      })
    } finally {
      dispose()
    }
  })

  test("no write is issued when nothing was set before or during load", async () => {
    const { kv, dispose } = makeKV()
    try {
      resolveLoad({ status: "found", value: { theme: "tokyonight" } })
      await flush()
      expect(kv.ready).toBe(true)
      expect(kv.get("theme")).toBe("tokyonight")
      expect(writeJson).not.toHaveBeenCalled()
    } finally {
      dispose()
    }
  })

  test("post-load set() persists a full snapshot", async () => {
    const { kv, dispose } = makeKV()
    try {
      resolveLoad({ status: "found", value: { theme: "tokyonight" } })
      await flush()
      kv.set("theme_mode", "light")
      await flush()
      expect(writeJson).toHaveBeenCalledTimes(1)
      expect(writeJson.mock.calls[0]?.[1]).toEqual({
        theme: "tokyonight",
        theme_mode: "light",
      })
    } finally {
      dispose()
    }
  })

  test("early writes stay in memory but never persist when the load is invalid", async () => {
    const { kv, dispose } = makeKV()
    try {
      kv.set("theme_mode", "dark")
      resolveLoad({ status: "invalid", error: new Error("corrupt") })
      await flush()
      expect(kv.ready).toBe(true)
      expect(kv.get("theme_mode")).toBe("dark")
      // persistenceBlocked must hold for buffered writes too — the corrupt
      // file must not be overwritten.
      expect(writeJson).not.toHaveBeenCalled()
      kv.set("theme", "everforest")
      await flush()
      expect(writeJson).not.toHaveBeenCalled()
    } finally {
      dispose()
    }
  })

  test("missing kv.json behaves as a clean first run", async () => {
    const { kv, dispose } = makeKV()
    try {
      kv.set("theme_mode", "dark")
      resolveLoad({ status: "missing" })
      await flush()
      expect(kv.ready).toBe(true)
      expect(kv.get("theme_mode")).toBe("dark")
      expect(writeJson).toHaveBeenCalledTimes(1)
      expect(writeJson.mock.calls[0]?.[1]).toEqual({ theme_mode: "dark" })
    } finally {
      dispose()
    }
  })
})
