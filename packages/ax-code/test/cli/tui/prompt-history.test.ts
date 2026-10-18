import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { createRoot, createSignal } from "solid-js"
import { PromptHistoryProvider, type usePromptHistory } from "../../../src/cli/tui/component/prompt/history"
import type { PromptInfo } from "../../../src/cli/tui/component/prompt/prompt-info"

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

const mocked = vi.hoisted(() => ({
  directory: (): string => "/project-a",
  fetch: vi.fn<typeof fetch>(),
  startup: undefined as (() => void | Promise<void>) | undefined,
}))
vi.mock("@tui/context/sdk", () => ({
  useSDK: () => ({
    url: "http://localhost:4096",
    get directory() {
      return mocked.directory()
    },
    fetch: mocked.fetch,
  }),
}))
vi.mock("../../../src/cli/tui/ui/toast", () => ({ useToast: () => ({ show: vi.fn() }) }))
vi.mock("@tui/util/startup-task", () => ({
  scheduleDeferredStartupTask: (task: () => void | Promise<void>) => {
    mocked.startup = task
    return () => {}
  },
}))

const disposals: (() => void)[] = []
const entry = (input: string): PromptInfo => ({ input, parts: [], mode: "normal" })

beforeEach(() => {
  mocked.fetch.mockReset().mockResolvedValue(Response.json([]))
  mocked.startup = undefined
})
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose()
})

function setup() {
  return createRoot((dispose) => {
    disposals.push(dispose)
    const [directory, setDirectory] = createSignal("/project-a")
    mocked.directory = directory
    const history = PromptHistoryProvider({}) as unknown as ReturnType<typeof usePromptHistory>
    return { history, setDirectory }
  })
}

describe("prompt history recall", () => {
  test("starts at the latest prompt after a recalled draft is cleared with Escape", () => {
    const { history } = setup()
    history.append(entry("older prompt"))
    history.append(entry("latest prompt"))
    expect(history.move(-1, "")?.input).toBe("latest prompt")
    // Double Escape clears the composer without submitting another entry.
    expect(history.move(-1, "")?.input).toBe("latest prompt")
  })

  test("keeps ordinary Up/Down traversal and protects edited drafts", () => {
    const { history } = setup()
    history.append(entry("older prompt"))
    history.append(entry("latest prompt"))
    expect(history.move(-1, "")?.input).toBe("latest prompt")
    expect(history.move(-1, "edited prompt")).toBeUndefined()
    expect(history.move(-1, "latest prompt")?.input).toBe("older prompt")
    expect(history.move(1, "older prompt")?.input).toBe("latest prompt")
    expect(history.move(1, "latest prompt")?.input).toBe("")
  })

  test("retains prompts submitted while workspace history is loading", async () => {
    const { history, setDirectory } = setup()
    const loaded = Promise.withResolvers<Response>()
    mocked.fetch.mockImplementation(async (_url, init) =>
      init?.method === "POST" ? Response.json(true) : loaded.promise,
    )
    setDirectory("/project-b")
    history.append(entry("latest prompt"))
    loaded.resolve(Response.json([entry("older prompt")]))
    await vi.waitFor(() => {
      expect(history.move(-1, "")?.input).toBe("latest prompt")
      expect(history.move(-1, "latest prompt")?.input).toBe("older prompt")
    })
  })

  test("does not reset active navigation when deferred startup history arrives", async () => {
    const { history } = setup()
    const loaded = Promise.withResolvers<Response>()
    mocked.fetch.mockImplementation(async (_url, init) =>
      init?.method === "POST" ? Response.json(true) : loaded.promise,
    )
    const loading = mocked.startup!()
    history.append(entry("latest prompt"))
    expect(history.move(-1, "")?.input).toBe("latest prompt")
    loaded.resolve(Response.json([entry("older prompt")]))
    await loading
    expect(history.move(-1, "latest prompt")?.input).toBe("older prompt")
  })

  test("merges overlapping persisted and local entries without repeated recall", async () => {
    const { history } = setup()
    history.append(entry("latest prompt"))
    mocked.fetch.mockResolvedValue(Response.json([entry("older prompt"), entry("latest prompt")]))
    await mocked.startup!()
    expect(history.move(-1, "")?.input).toBe("latest prompt")
    expect(history.move(-1, "latest prompt")?.input).toBe("older prompt")
  })

  test("ignores a previous workspace's late history response", async () => {
    const { history, setDirectory } = setup()
    const loaded = Promise.withResolvers<Response>()
    mocked.fetch.mockImplementation(async (_url, init) => {
      if (init?.method === "POST") return Response.json(true)
      if (new Headers(init?.headers).get("x-opencode-directory") === "/project-a") return loaded.promise
      return Response.json([entry("project B older prompt")])
    })
    const loading = mocked.startup!()
    setDirectory("/project-b")
    history.append(entry("project B latest prompt"))
    loaded.resolve(Response.json([entry("project A prompt")]))
    await loading
    await vi.waitFor(() => {
      expect(history.move(-1, "")?.input).toBe("project B latest prompt")
      expect(history.move(-1, "project B latest prompt")?.input).toBe("project B older prompt")
    })
    expect(history.move(-1, "project B older prompt")?.input).toBe("project B older prompt")
  })

  test("keeps the newest 50 entries when merging persisted and local history", async () => {
    const { history } = setup()
    mocked.fetch.mockResolvedValue(Response.json(Array.from({ length: 50 }, (_, index) => entry(`prompt ${index}`))))
    history.append(entry("prompt 50"))
    await mocked.startup!()
    let recalled = history.move(-1, "")!
    expect(recalled.input).toBe("prompt 50")
    for (let index = 49; index >= 1; index--) {
      recalled = history.move(-1, recalled.input)!
      expect(recalled.input).toBe(`prompt ${index}`)
    }
    expect(history.move(-1, recalled.input)?.input).toBe("prompt 1")
  })
})
