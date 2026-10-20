import { expect, test, vi } from "vitest"
import { tmpdir } from "../fixture/fixture"

const parcel = vi.hoisted(() => ({
  resolve: undefined as undefined | ((value: { unsubscribe: () => Promise<void> }) => void),
  unsubscribe: vi.fn(async () => {}),
}))

// A parcel binding whose subscribe() settles only when the test says so.
vi.mock("@parcel/watcher/wrapper", () => ({
  createWrapper: () => ({
    subscribe: () =>
      new Promise((resolve) => {
        parcel.resolve = resolve
      }),
  }),
}))

// The platform binding package may be absent (CI runners install only some),
// and the watcher requires it before calling createWrapper. Resolve it to an
// empty stub; every other require keeps the real implementation.
vi.mock("node:module", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:module")>()
  const createRequire: typeof actual.createRequire = (from) => {
    const real = actual.createRequire(from)
    const stubbed = ((id: string) => (id.startsWith("@parcel/watcher-") ? {} : real(id))) as NodeJS.Require
    return Object.assign(stubbed, real)
  }
  return { ...actual, default: { ...actual, createRequire }, createRequire }
})

// Expire the first 10 s subscribe deadline (the parcel attempt) immediately;
// every other caller keeps the real implementation.
vi.mock("@/util/timeout", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/util/timeout")>()
  let expired = false
  return {
    ...actual,
    withTimeout: <T>(promise: Promise<T>, ms: number, message?: string) => {
      if (expired || message !== "Timed out after 10000ms") return actual.withTimeout(promise, ms, message)
      expired = true
      return Promise.reject(new Error(message))
    },
  }
})

test("a parcel subscription that resolves after the poll fallback is closed instead of kept", async () => {
  // The setup file already loaded the watcher graph; reload it so the mocks apply.
  vi.resetModules()
  const { FileWatcher } = await import("../../src/file/watcher")
  const { Instance } = await import("../../src/project/instance")

  await using tmp = await tmpdir()
  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        try {
          await FileWatcher.init({ enabled: true, disabled: false })
          expect(parcel.resolve).toBeDefined()
          parcel.resolve!({ unsubscribe: parcel.unsubscribe })
          await vi.waitFor(() => expect(parcel.unsubscribe).toHaveBeenCalledTimes(1), { timeout: 2_000 })
        } finally {
          await Instance.dispose()
        }
      },
    })
  } finally {
    await Instance.disposeAll()
  }
  expect(parcel.unsubscribe).toHaveBeenCalledTimes(1)
})
