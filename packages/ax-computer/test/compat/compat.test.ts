import { describe, expect, test } from "vitest"
import { fileURLToPath } from "node:url"
import type { ActionResult, ComputerAction } from "../../src/action"
import type { ComputerUseProvider, ObserveScope, ProviderCapabilities } from "../../src/provider"
import { ExternalComputerProvider } from "../../src/providers/external"
import type { AppInfo, ComputerObservation, WindowInfo } from "../../src/types"
import { runCompatSuite } from "./suite"
import { PNG_BASE64 } from "../fixtures"

/** in-memory provider implementing the full canonical surface */
class MockProvider implements ComputerUseProvider {
  disposed = false
  readonly acts: ComputerAction[] = []

  constructor(
    readonly name: string,
    private readonly screenshotDims = true,
    private readonly windowsList?: WindowInfo[],
  ) {}

  capabilities(): ProviderCapabilities {
    return {
      actions: ["click", "type", "keypress", "scroll", "drag", "set_value", "activate_window", "launch_app"],
      backgroundDelivery: true,
      elementTargeting: true,
      windowActivation: true,
    }
  }

  async listApps(): Promise<AppInfo[]> {
    return [{ name: "TextEdit", pid: 4242, bundleId: "com.apple.TextEdit" }]
  }

  async listWindows(): Promise<WindowInfo[]> {
    return (
      this.windowsList ?? [
        {
          id: "101",
          title: "Untitled",
          bounds: { x: 50, y: 50, width: 800, height: 600 },
          app: { name: "TextEdit", pid: 4242 },
        },
      ]
    )
  }

  async observe(scope: ObserveScope): Promise<ComputerObservation> {
    const base: ComputerObservation = {
      platform: "test",
      provider: this.name,
      timestamp: Date.now(),
      screenshot: this.screenshotDims
        ? { data: PNG_BASE64, mimeType: "image/png", width: 1, height: 1 }
        : { data: PNG_BASE64, mimeType: "image/png" },
      elements: [],
    }
    if ("desktop" in scope) return base
    return {
      ...base,
      app: { name: "TextEdit", pid: 4242 },
      window: { id: "101", title: "Untitled", bounds: { x: 50, y: 50, width: 800, height: 600 } },
      elements: [
        { id: "el-0", role: "AXGroup", name: "Container" },
        { id: "el-1", role: "AXButton", name: "Save", bounds: { x: 10, y: 20, width: 80, height: 24 } },
        { id: "el-2", role: "AXTextArea", name: "Editor" },
      ],
    }
  }

  async act(action: ComputerAction): Promise<ActionResult> {
    this.acts.push(action)
    return { ok: true, provider: this.name, action: action.type }
  }

  async dispose(): Promise<void> {
    this.disposed = true
  }
}

const EXPECTED_CASES = [
  "CU-001",
  "CU-002",
  "CU-003",
  "CU-004",
  "CU-005",
  "CU-006",
  "CU-007",
  "CU-008",
  "CU-009",
  "CU-010",
]

function expectAllPass(results: { id: string; ok: boolean; detail?: string }[]) {
  expect(results.map((result) => result.id)).toEqual(EXPECTED_CASES)
  for (const result of results) {
    expect(result.ok, `${result.id}: ${result.detail ?? "failed"}`).toBe(true)
  }
}

describe("compat suite: mock provider", () => {
  test("CU-001..CU-010 all pass", async () => {
    let n = 0
    const results = await runCompatSuite(async () => new MockProvider(`mock-${++n}`))
    expectAllPass(results)
  })

  test("CU-006 dismisses the Open dialog and focuses before typing (TextEdit)", async () => {
    const providers: MockProvider[] = []
    const results = await runCompatSuite(async () => {
      const provider = new MockProvider(`mock-${providers.length}`)
      providers.push(provider)
      return provider
    })
    expectAllPass(results)

    const acts = providers[0]!.acts
    const typeIndex = acts.findIndex((action) => action.type === "type")
    expect(typeIndex).toBeGreaterThanOrEqual(3)
    expect(acts[typeIndex - 3]).toEqual({ type: "keypress", keys: ["escape"] })
    expect(acts[typeIndex - 2]).toEqual({ type: "keypress", keys: ["cmd", "n"] })
    // screenshot is 1x1, so the focus click lands at the screenshot-pixel center
    expect(acts[typeIndex - 1]).toEqual({ type: "click", target: { kind: "point", x: 0, y: 0 } })
  })

  test("CU-004 prefers a button-like element over a container", async () => {
    const providers: MockProvider[] = []
    const results = await runCompatSuite(async () => {
      const provider = new MockProvider(`mock-${providers.length}`)
      providers.push(provider)
      return provider
    })
    expectAllPass(results)

    // the first observation element is an AXGroup; the click must target the AXButton
    const elementClicks = providers[0]!.acts.filter(
      (action) => action.type === "click" && action.target.kind === "element",
    )
    expect(elementClicks).toEqual([{ type: "click", target: { kind: "element", id: "el-1" } }])
    expect(results.find((result) => result.id === "CU-004")?.detail).toContain("AXButton")
  })

  test("CU-009 skips menu-bar slivers and activates the app's real window", async () => {
    const providers: MockProvider[] = []
    const results = await runCompatSuite(async () => {
      const provider = new MockProvider(`mock-${providers.length}`, true, [
        {
          id: "sliver",
          title: "",
          bounds: { x: 0, y: 0, width: 1440, height: 30 },
          app: { name: "TextEdit", pid: 4242 },
        },
        {
          id: "real",
          title: "Untitled",
          bounds: { x: 50, y: 50, width: 800, height: 600 },
          app: { name: "TextEdit", pid: 4242 },
        },
      ])
      providers.push(provider)
      return provider
    })
    expectAllPass(results)
    const activation = providers[0]!.acts.find((action) => action.type === "activate_window")
    expect(activation).toEqual({ type: "activate_window", windowId: "real" })
    expect(results.find((result) => result.id === "CU-009")?.detail).toContain("real")
  })

  test("CU-009 falls back to a foreign non-degenerate window", async () => {
    const providers: MockProvider[] = []
    const results = await runCompatSuite(async () => {
      const provider = new MockProvider(`mock-${providers.length}`, true, [
        {
          id: "foreign",
          title: "Finder",
          bounds: { x: 0, y: 0, width: 900, height: 700 },
          app: { name: "Finder", pid: 111 },
        },
      ])
      providers.push(provider)
      return provider
    })
    expectAllPass(results)
    const activation = providers[0]!.acts.find((action) => action.type === "activate_window")
    expect(activation).toEqual({ type: "activate_window", windowId: "foreign" })
  })

  test("CU-006 skips the dialog sequence for other apps", async () => {
    const providers: MockProvider[] = []
    await runCompatSuite(
      async () => {
        const provider = new MockProvider(`mock-${providers.length}`)
        providers.push(provider)
        return provider
      },
      { app: "OtherApp" },
    )
    const acts = providers[0]!.acts
    expect(acts.some((action) => action.type === "type")).toBe(true)
    expect(
      acts.filter(
        (action) =>
          action.type === "keypress" &&
          (action.keys.includes("escape") || (action.keys.includes("cmd") && action.keys.includes("n"))),
      ),
    ).toEqual([])
  })

  test("CU-005 skips when the screenshot has no dimensions", async () => {
    const results = await runCompatSuite(async () => new MockProvider("mock-nodims", false))
    const cu005 = results.find((result) => result.id === "CU-005")
    expect(cu005?.ok).toBe(true)
    expect(cu005?.detail).toContain("skipped")
    // the rest still passes — CU-006 types without the focus click
    for (const result of results) expect(result.ok, `${result.id}: ${result.detail}`).toBe(true)
  })
})

const axServer = fileURLToPath(new URL("../helpers/fake-ax-server.mjs", import.meta.url))

describe("compat suite: external provider over the canonical protocol", () => {
  test("CU-001..CU-010 all pass against a fake canonical MCP server", async () => {
    const results = await runCompatSuite(
      async () => new ExternalComputerProvider({ command: process.execPath, args: [axServer, "basic"] }),
    )
    expectAllPass(results)
  })
})
