import { afterEach, describe, expect, test, vi } from "vitest"
import { createRoot } from "solid-js"
import { PromptStashProvider, type usePromptStash } from "../../../src/cli/tui/component/prompt/stash"

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
  temp: "",
  pending: [] as Array<() => void>,
  truncateOnWrite: false,
  readGated: false,
  readGates: [] as Array<() => void>,
}))
vi.mock("fs/promises", () => ({
  appendFile: (_path: unknown, data: string) =>
    new Promise<void>((resolve) => {
      fs.pending.push(() => {
        fs.file += data
        resolve()
      })
    }),
  writeFile: (path: unknown, data: string) =>
    new Promise<void>((resolve) => {
      const target = String(path)
      // A non-atomic direct write truncates the main file before writing;
      // atomic temp-file writes never touch it.
      if (fs.truncateOnWrite && !target.endsWith(".tmp")) fs.file = ""
      fs.pending.push(() => {
        if (target.endsWith(".tmp")) fs.temp = data
        else fs.file = data
        resolve()
      })
    }),
  rename: (_from: unknown, _to: unknown) =>
    new Promise<void>((resolve) => {
      fs.pending.push(() => {
        fs.file = fs.temp
        resolve()
      })
    }),
}))
vi.mock("@/global", () => ({ Global: { Path: { state: "/test-state" } } }))
vi.mock("@/util/filesystem", () => ({
  Filesystem: {
    readText: async () => {
      if (fs.readGated) await new Promise<void>((resolve) => fs.readGates.push(resolve))
      return fs.file
    },
  },
}))
const lock = vi.hoisted(() => ({
  gated: false,
  gates: [] as Array<() => void>,
  held: false,
  waiters: [] as Array<() => void>,
}))
vi.mock("@/util/filelock", () => ({
  FileLock: {
    acquire: async () => {
      if (lock.gated) await new Promise<void>((resolve) => lock.gates.push(resolve))
      if (lock.held) await new Promise<void>((resolve) => lock.waiters.push(resolve))
      lock.held = true
      return {
        [Symbol.dispose]: () => {
          lock.held = false
          lock.waiters.shift()?.()
        },
      }
    },
  },
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
  fs.temp = ""
  fs.pending.length = 0
  fs.truncateOnWrite = false
  fs.readGated = false
  fs.readGates.length = 0
  lock.gated = false
  lock.gates.length = 0
  lock.held = false
  lock.waiters.length = 0
  mocked.startup = undefined
  await new Promise<void>((resolve) => setImmediate(resolve))
})

function setup() {
  return createRoot((dispose) => {
    disposals.push(dispose)
    return PromptStashProvider({}) as unknown as ReturnType<typeof usePromptStash>
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

describe("prompt stash write ordering", () => {
  test("a pop rewrite cannot land before an earlier push append", async () => {
    const stash = setup()
    stash.push({ input: "prompt", parts: [] })
    expect(stash.pop()?.input).toBe("prompt")
    // The fs thread pool may complete the rewrite before the append; the
    // popped entry must not resurrect in the persisted file.
    await flushReversed()
    expect(fs.file).toBe("")
  })

  test("a remove rewrite cannot land before an earlier push append", async () => {
    const stash = setup()
    stash.push({ input: "prompt", parts: [] })
    const id = stash.list()[0]!.id
    stash.remove(id)
    await flushReversed()
    expect(fs.file).toBe("")
  })

  test("sequential pushes and a pop persist the remaining entries in order", async () => {
    const stash = setup()
    stash.push({ input: "first", parts: [] })
    stash.push({ input: "second", parts: [] })
    expect(stash.pop()?.input).toBe("second")
    await flushReversed()
    const lines = fs.file
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { input: string })
    expect(lines.map((line) => line.input)).toEqual(["first"])
  })

  test("a pop does not drop entries another window appended", async () => {
    // Another TUI window shares the state file; its entry is on disk but not
    // in this window's store.
    fs.file = JSON.stringify({ id: "external", input: "other window", parts: [], timestamp: 1 }) + "\n"
    const stash = setup()
    stash.push({ input: "mine", parts: [] })
    stash.pop()
    await flushReversed()
    const lines = fs.file
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { id: string })
    expect(lines.map((line) => line.id)).toEqual(["external"])
  })

  test("a remove does not drop entries another window appended", async () => {
    fs.file = JSON.stringify({ id: "external", input: "other window", parts: [], timestamp: 1 }) + "\n"
    const stash = setup()
    stash.push({ input: "mine", parts: [] })
    stash.remove(stash.list()[0]!.id)
    await flushReversed()
    const lines = fs.file
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { id: string })
    expect(lines.map((line) => line.id)).toEqual(["external"])
  })

  test("a push at the cap persists the new entry and evicts the oldest", async () => {
    const stash = setup()
    for (let index = 0; index < 50; index += 1) stash.push({ input: `entry-${index}`, parts: [] })
    stash.push({ input: "newest", parts: [] })
    await flushReversed()
    const lines = fs.file
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { input: string })
    expect(lines).toHaveLength(50)
    expect(lines.at(-1)?.input).toBe("newest")
    expect(lines.map((line) => line.input)).not.toContain("entry-0")
  })

  test("the load rewrite does not duplicate id-less lines", async () => {
    fs.file =
      JSON.stringify({ input: "legacy-a", parts: [], timestamp: 1 }) +
      "\n" +
      JSON.stringify({ input: "legacy-b", parts: [], timestamp: 2 }) +
      "\n"
    const stash = setup()
    await mocked.startup!()
    await flushReversed()
    const lines = fs.file
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { input: string })
    expect(lines.map((line) => line.input).sort()).toEqual(["legacy-a", "legacy-b"])
    expect(stash.list()).toHaveLength(2)
  })

  test("a load rewrite does not resurrect an entry another window removed", async () => {
    const lineX = JSON.stringify({ id: "x", input: "X", parts: [], timestamp: 1 })
    const lineY = JSON.stringify({ id: "y", input: "Y", parts: [], timestamp: 2 })
    fs.file = lineX + "\n" + lineY + "\n"
    const stash = setup()
    // Hold the load read, let it observe X+Y, then hold the rewrite at the
    // lock while another window removes X.
    fs.readGated = true
    const load = mocked.startup!()
    await new Promise<void>((resolve) => setImmediate(resolve))
    fs.readGated = false
    fs.readGates.shift()!()
    lock.gated = true
    await new Promise<void>((resolve) => setImmediate(resolve))
    fs.file = lineY + "\n"
    lock.gated = false
    lock.gates.shift()!()
    await load
    await flushReversed()
    const lines = fs.file
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { id: string })
    expect(lines.map((line) => line.id)).toEqual(["y"])
    expect(stash.list().map((entry) => entry.id)).toEqual(["x", "y"])
  })

  test("a load waits for an in-flight rewrite from another window", async () => {
    const lineX = JSON.stringify({ id: "x", input: "X", parts: [], timestamp: 1 })
    const lineY = JSON.stringify({ id: "y", input: "Y", parts: [], timestamp: 2 })
    fs.file = lineX + "\n" + lineY + "\n"
    const first = setup()
    await mocked.startup!()
    await flushReversed()
    // A rewrite from the first window is in flight while a second window
    // mounts and loads; the lock must hold the load until the rewrite settles.
    first.remove("y")
    await new Promise<void>((resolve) => setImmediate(resolve))
    const second = setup()
    const load = mocked.startup!()
    await flushReversed()
    await load
    expect(second.list().map((entry) => entry.id)).toEqual(["x"])
  })

  test("a crash during a rewrite leaves the previous file intact", async () => {
    fs.file = JSON.stringify({ id: "x", input: "X", parts: [], timestamp: 1 }) + "\n"
    const stash = setup()
    await mocked.startup!()
    await flushReversed()
    fs.truncateOnWrite = true
    stash.pop()
    await new Promise<void>((resolve) => setImmediate(resolve))
    // The rewrite never settles (process killed mid-write); the main file
    // must still hold the pre-pop content.
    expect(fs.file).toContain('"x"')
  })

  test("the load rewrite bounds the disk file to the stash cap", async () => {
    const a = setup()
    const b = setup()
    for (let index = 0; index < 30; index += 1) a.push({ input: `a${index}`, parts: [] })
    for (let index = 0; index < 30; index += 1) b.push({ input: `b${index}`, parts: [] })
    await flushReversed()
    expect(fs.file.split("\n").filter(Boolean)).toHaveLength(60)
    const c = setup()
    await mocked.startup!()
    await flushReversed()
    expect(fs.file.split("\n").filter(Boolean).length).toBeLessThanOrEqual(50)
    expect(c.list()).toHaveLength(50)
  })

  test("the load rewrite clears a fully corrupt file", async () => {
    fs.file = "not json\n{broken\n"
    const stash = setup()
    await mocked.startup!()
    await flushReversed()
    expect(fs.file).toBe("")
    expect(stash.list()).toHaveLength(0)
  })
})
