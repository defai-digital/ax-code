import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { createRoot } from "solid-js"
import type { ResilientStreamOptions } from "../../../src/cli/tui/util/resilient-stream"

vi.mock("solid-js", async () => {
  const { createRequire } = await import("node:module")
  return createRequire(import.meta.url)("solid-js/dist/solid.cjs") as typeof import("solid-js")
})
vi.mock("../../../src/cli/tui/context/helper", () => ({
  createSimpleContext: (input: { init: (props: unknown) => unknown }) => ({ provider: input.init }),
}))
const wire = vi.hoisted(() => ({
  runs: [] as ResilientStreamOptions<unknown>[],
  subscriptions: [] as {
    signal: AbortSignal
    headers?: Record<string, string>
    onSseEvent: (event: { id: string }) => void
  }[],
}))
vi.mock("@ax-code/sdk/v2", () => ({
  createAxCodeClient: () => ({
    event: {
      subscribe: async (_input: unknown, options: (typeof wire.subscriptions)[number]) => {
        wire.subscriptions.push(options)
        return { stream: (async function* () {})() }
      },
    },
  }),
}))
vi.mock("../../../src/cli/tui/util/resilient-stream", () => ({
  runResilientStream: (options: ResilientStreamOptions<unknown>) => {
    wire.runs.push(options)
    return new Promise<void>((resolve) => options.signal.addEventListener("abort", () => resolve(), { once: true }))
  },
}))
import { SDKProvider, type useSDK } from "../../../src/cli/tui/context/sdk"

const disposals: (() => void)[] = []
beforeEach(() => {
  wire.runs.length = 0
  wire.subscriptions.length = 0
})
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose()
})
function setup() {
  return createRoot((dispose) => {
    disposals.push(dispose)
    return SDKProvider({ url: "http://localhost:4096", directory: "/workspace/a" }) as unknown as ReturnType<
      typeof useSDK
    >
  })
}

test("a previous workspace cannot overwrite the active stream's replay cursor", async () => {
  const sdk = setup()
  await wire.runs[0].subscribe(new AbortController().signal)
  wire.subscriptions[0].onSseEvent({ id: "workspace-a-cursor" })
  sdk.setWorkspace("/workspace/b")
  await wire.runs[1].subscribe(new AbortController().signal)
  wire.subscriptions[1].onSseEvent({ id: "workspace-b-cursor" })
  wire.subscriptions[0].onSseEvent({ id: "stale-workspace-a-cursor" })
  await wire.runs[1].subscribe(new AbortController().signal)
  expect(wire.subscriptions[2].headers?.["Last-Event-ID"]).toBe("workspace-b-cursor")
})

test("an aborted connection cannot overwrite a newer connection's replay cursor", async () => {
  setup()
  const first = new AbortController()
  await wire.runs[0].subscribe(first.signal)
  wire.subscriptions[0].onSseEvent({ id: "first-cursor" })
  first.abort()
  await wire.runs[0].subscribe(new AbortController().signal)
  wire.subscriptions[1].onSseEvent({ id: "current-cursor" })
  wire.subscriptions[0].onSseEvent({ id: "stale-cursor" })
  await wire.runs[0].subscribe(new AbortController().signal)
  expect(wire.subscriptions[2].headers?.["Last-Event-ID"]).toBe("current-cursor")
})
