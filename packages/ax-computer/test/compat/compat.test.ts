import { describe, expect, test } from "vitest"
import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"
import type { ActionResult, ActStepResult, ComputerAction } from "../../src/action"
import type {
  ActBatchOptions,
  ComputerUseProvider,
  ObserveScope,
  PassiveObserveOptions,
  ProviderCapabilities,
} from "../../src/provider"
import { ExternalComputerProvider } from "../../src/providers/external"
import type { AppInfo, ComputerObservation, WindowInfo } from "../../src/types"
import { runCompatSuite } from "./suite"
import { PNG_BASE64 } from "../fixtures"

/** element ids the mock observation below issues */
const KNOWN_ELEMENTS = new Set(["el-0", "el-1", "el-2"])

/** in-memory provider implementing the full canonical surface */
class MockProvider implements ComputerUseProvider {
  disposed = false
  readonly acts: ComputerAction[] = []
  /** batch steps are recorded separately so they never pollute acts assertions */
  readonly batches: ComputerAction[][] = []

  constructor(
    readonly name: string,
    private readonly screenshotDims = true,
    private readonly windowsList?: WindowInfo[],
  ) {}

  /** text typed so far; part of the passive frame's hashed content */
  private typed = ""
  private passiveRevision = 0
  /** revision token -> frame hash, so superseded-but-known revisions are not gaps */
  private readonly passiveFrames = new Map<string, string>()
  private passiveLatest: { revision: string; frameHash: string } | undefined

  capabilities(): ProviderCapabilities {
    return {
      actions: [
        "click",
        "type",
        "keypress",
        "scroll",
        "drag",
        "set_value",
        "activate_window",
        "launch_app",
        "move",
        "wait",
      ],
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

  async observe(scope: ObserveScope, options?: PassiveObserveOptions): Promise<ComputerObservation> {
    if (options) return this.observePassive(scope, options)
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

  /**
   * Passive frames hash the mock's visible content (typed text); a revision
   * is allocated only when that content changes, so an immediate re-poll is
   * deterministically unchanged.
   */
  private observePassive(scope: ObserveScope, options: PassiveObserveOptions): ComputerObservation {
    const frameHash = `sha256:${createHash("sha256")
      .update(JSON.stringify({ scope, typed: this.typed }))
      .digest("hex")}`
    if (this.passiveLatest?.frameHash !== frameHash) {
      this.passiveRevision += 1
      this.passiveLatest = { revision: `r${this.passiveRevision}`, frameHash }
      this.passiveFrames.set(this.passiveLatest.revision, frameHash)
    }
    const latest = this.passiveLatest!
    const base: ComputerObservation = {
      platform: "test",
      provider: this.name,
      timestamp: Date.now(),
      elements: [],
      revision: latest.revision,
      frameHash: latest.frameHash,
    }
    // screenshot dedup: the client already advertises this frame hash
    const screenshot = options.have?.includes(latest.frameHash)
      ? undefined
      : { data: PNG_BASE64, mimeType: "image/png", width: 1, height: 1 }
    if (options.sinceRevision !== null) {
      // unknown or evicted revision: latest full frame + gap, never silent unchanged
      if (!this.passiveFrames.has(options.sinceRevision)) {
        return { ...base, unchanged: false, gap: true, screenshot }
      }
      if (options.sinceRevision === latest.revision) return { ...base, unchanged: true }
    }
    return { ...base, unchanged: false, screenshot }
  }

  async act(action: ComputerAction): Promise<ActionResult> {
    this.acts.push(action)
    const refusal = this.refusalFor(action)
    if (refusal) return { ok: false, provider: this.name, action: action.type, refusal }
    // typing visibly changes the mock's content, so passive polls must move
    if (action.type === "type") this.typed += action.text
    return { ok: true, provider: this.name, action: action.type }
  }

  async actBatch(actions: ComputerAction[], options: ActBatchOptions = {}): Promise<ActionResult> {
    this.batches.push(actions)
    const results: ActStepResult[] = []
    // default stopOnError: the first refusal aborts the remaining steps
    const stopOnError = options.stopOnError !== false
    for (const [index, action] of actions.entries()) {
      const refusal = this.refusalFor(action)
      results.push({ index, ok: refusal === undefined, refusal })
      if (refusal !== undefined && stopOnError) break
    }
    const failed = results.find((step) => !step.ok)
    return {
      ok: failed === undefined,
      provider: this.name,
      action: actions[0]!.type,
      refusal: failed?.refusal,
      results,
    }
  }

  /** in-memory refusal: element targets the mock observation never issued */
  private refusalFor(action: ComputerAction): string | undefined {
    if (action.type === "wait" && action.condition.type !== "screen_stable") {
      const target = action.condition.target
      if (target.kind !== "element") return "unsupported_target"
      return KNOWN_ELEMENTS.has(target.id) ? undefined : "unknown_element"
    }
    if (
      (action.type === "click" || action.type === "set_value" || action.type === "move") &&
      action.target.kind === "element"
    ) {
      return KNOWN_ELEMENTS.has(action.target.id) ? undefined : "unknown_element"
    }
    return undefined
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
  "CU-011",
  "CU-012",
  "CU-013",
  "CU-014",
  "CU-015",
  "CU-016",
]

function expectAllPass(results: { id: string; ok: boolean; detail?: string }[]) {
  expect(results.map((result) => result.id)).toEqual(EXPECTED_CASES)
  for (const result of results) {
    expect(result.ok, `${result.id}: ${result.detail ?? "failed"}`).toBe(true)
  }
}

describe("compat suite: mock provider", () => {
  test("CU-001..CU-016 all pass", async () => {
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
  test("CU-001..CU-016 all pass against a fake canonical MCP server", async () => {
    const results = await runCompatSuite(
      async () => new ExternalComputerProvider({ command: process.execPath, args: [axServer, "basic"] }),
    )
    expectAllPass(results)
  })
})
