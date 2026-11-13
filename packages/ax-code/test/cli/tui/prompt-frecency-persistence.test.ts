import { afterEach, describe, expect, test, vi } from "vitest"
import { createRoot } from "solid-js"
import { FrecencyProvider, type useFrecency } from "../../../src/cli/tui/component/prompt/frecency"

vi.mock("solid-js", async () => {
  const { createRequire } = await import("node:module")
  return createRequire(import.meta.url)("solid-js/dist/solid.cjs") as typeof import("solid-js")
})
vi.mock("solid-js/store", async () => {
  const { createRequire } = await import("node:module")
  const require = createRequire(import.meta.url)
  require("solid-js/dist/solid.cjs")
  const runtimePath = require.resolve("solid-js")
  const previous = require.cache[runtimePath]
  require.cache[runtimePath] = require.cache[require.resolve("solid-js/dist/solid.cjs")]
  try {
    return require("solid-js/store/dist/store.cjs") as typeof import("solid-js/store")
  } finally {
    if (previous) require.cache[runtimePath] = previous
    else delete require.cache[runtimePath]
  }
})
vi.mock("../../../src/cli/tui/context/helper", () => ({
  createSimpleContext: (input: { init: () => unknown }) => ({ provider: input.init }),
}))

const fs = vi.hoisted(() => ({
  file: "",
  pending: [] as Array<() => void>,
}))
vi.mock("fs/promises", () => ({
  appendFile: (_path: unknown, data: string) =>
    new Promise<void>((resolve) => {
      fs.pending.push(() => {
        fs.file += data
        resolve()
      })
    }),
  writeFile: (_path: unknown, data: string) =>
    new Promise<void>((resolve) => {
      fs.pending.push(() => {
        fs.file = data
        resolve()
      })
    }),
}))
vi.mock("@/global", () => ({ Global: { Path: { state: "/test-state" } } }))
vi.mock("@/util/filesystem", () => ({ Filesystem: { readText: async () => fs.file } }))
vi.mock("@/util/filelock", () => ({
  FileLock: { acquire: async () => ({ [Symbol.dispose]: () => {} }) },
}))
vi.mock("../../../src/cli/tui/ui/toast", () => ({ useToast: () => ({ show: vi.fn() }) }))
const mocked = vi.hoisted(() => ({
  startup: undefined as (() => void | Promise<void>) | undefined,
}))
vi.mock("@tui/util/startup-task", () => ({
  scheduleDeferredStartupTask: (task: () => void | Promise<void>) => {
    mocked.startup = task
    return () => {}
  },
}))

const disposals: (() => void)[] = []

afterEach(async () => {
  for (const dispose of disposals.splice(0)) dispose()
  fs.file = ""
  fs.pending.length = 0
  mocked.startup = undefined
  await new Promise<void>((resolve) => setImmediate(resolve))
})

function setup() {
  return createRoot((dispose) => {
    disposals.push(dispose)
    return FrecencyProvider({}) as unknown as ReturnType<typeof useFrecency>
  })
}

/** Settle issued writes in reverse issuance order, then drain chained follow-ups. */
async function flushReversed() {
  const batch = fs.pending.splice(0)
  for (const operation of batch.reverse()) operation()
  await new Promise<void>((resolve) => setImmediate(resolve))
  while (fs.pending.length > 0) {
    const operation = fs.pending.shift()!
    operation()
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
}

function persistedPaths(): string[] {
  return fs.file
    .split("\n")
    .filter(Boolean)
    .map((line) => (JSON.parse(line) as { path: string }).path)
}

describe("frecency compact write ordering", () => {
  test("an update racing the compact rewrite is not lost from disk", async () => {
    const frecency = setup()
    // The 100th write triggers compact(), which rewrites the file after the
    // pending append settles.
    for (let index = 0; index < 100; index += 1) frecency.updateFrecency(`/repo/file-${index}.ts`)
    // A new open lands while the compact rewrite is still queued.
    frecency.updateFrecency("/repo/raced.ts")
    await flushReversed()
    expect(persistedPaths()).toContain("/repo/raced.ts")
  })

  test("sequential updates persist every opened path", async () => {
    const frecency = setup()
    frecency.updateFrecency("/repo/a.ts")
    frecency.updateFrecency("/repo/b.ts")
    await flushReversed()
    expect(persistedPaths().sort()).toEqual(["/repo/a.ts", "/repo/b.ts"])
  })

  test("load does not regress a count appended from a stale base", async () => {
    fs.file = JSON.stringify({ path: "/repo/x.ts", frequency: 42, lastOpen: 1000 }) + "\n"
    const frecency = setup()
    // Before the deferred load runs, an open appends a session-local count.
    frecency.updateFrecency("/repo/x.ts")
    await flushReversed()
    await mocked.startup!()
    expect(frecency.data()["/repo/x.ts"]?.frequency).toBe(42)
    await flushReversed()
    const entry = fs.file
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { path: string; frequency: number })
      .find((line) => line.path === "/repo/x.ts")
    expect(entry?.frequency).toBe(42)
  })

  test("a compact rewrite does not drop entries another window appended", async () => {
    fs.file = JSON.stringify({ path: "/repo/external.ts", frequency: 5, lastOpen: 500 }) + "\n"
    const frecency = setup()
    for (let index = 0; index < 100; index += 1) frecency.updateFrecency(`/repo/file-${index}.ts`)
    await flushReversed()
    expect(persistedPaths()).toContain("/repo/external.ts")
  })
})
