import { describe, expect, test } from "vitest"
import type { ActionResult, ComputerAction } from "../../src/action"
import { ComputerUseError } from "../../src/errors"
import type { ComputerUseProvider, ObserveScope, ProviderCapabilities } from "../../src/provider"
import type { AppInfo, ComputerObservation, WindowInfo } from "../../src/types"
import { PNG_BASE64 } from "../fixtures"
import {
  AB_SCROLL_AMOUNT,
  AB_TYPED_TEXT,
  abTaskSet,
  compareAbRuns,
  formatAbReport,
  runAbSuite,
  type AbCaseResult,
  type AbSuiteRunResult,
} from "./suite"

/** in-memory provider implementing the canonical surface; controls per-action verdicts via a script */
class FakeProvider implements ComputerUseProvider {
  readonly acts: ComputerAction[] = []
  readonly observedScopes: ObserveScope[] = []
  /** per-task-id -> optional refusal override. When set, the next matching act returns ok:false */
  script = new Map<string, string>()

  constructor(
    readonly name: string,
    readonly elementIds: { id: string; role: string; name?: string }[] = [],
  ) {}

  capabilities(): ProviderCapabilities {
    return {
      actions: ["click", "type", "keypress", "scroll", "drag", "set_value", "activate_window", "launch_app"],
      backgroundDelivery: true,
      elementTargeting: true,
      windowActivation: false,
    }
  }

  async listApps(): Promise<AppInfo[]> {
    return [{ name: "TextEdit", pid: 1, bundleId: "com.apple.TextEdit" }]
  }

  async listWindows(): Promise<WindowInfo[]> {
    return [
      {
        id: "1",
        title: "Untitled",
        bounds: { x: 0, y: 0, width: 800, height: 600 },
        app: { name: "TextEdit", pid: 1 },
      },
    ]
  }

  async observe(scope: ObserveScope): Promise<ComputerObservation> {
    this.observedScopes.push(scope)
    // OCU is app-scoped; the suite's AB-002 calls observe({ app: ... }) and
    // the per-task observers pass `{ app } as never` for compatibility. Fake
    // providers don't need to dispatch — they just record.
    const appScope = scope as { app?: string }
    return {
      platform: "test",
      provider: this.name,
      timestamp: Date.now(),
      app: appScope.app ? { name: appScope.app } : { name: "TextEdit" },
      window: {
        id: "1",
        title: "Untitled",
        bounds: { x: 0, y: 0, width: 800, height: 600 },
        app: { name: "TextEdit" },
      },
      screenshot: { data: PNG_BASE64, mimeType: "image/png", width: 640, height: 480 },
      elements: this.elementIds.map((el) => ({ id: el.id, role: el.role, name: el.name })),
    }
  }

  async act(action: ComputerAction): Promise<ActionResult> {
    this.acts.push(action)
    // script-controlled refusals are keyed by task id, which the suite carries
    // in a side-channel: the test injects a marker action (typed/scroll/etc.)
    // and asks the fake to refuse the next matching action.
    for (const [marker, refusal] of this.script.entries()) {
      if (this.matchesMarker(action, marker)) {
        // script entries are one-shot
        this.script.delete(marker)
        return { ok: false, provider: this.name, action: action.type, refusal }
      }
    }
    return { ok: true, provider: this.name, action: action.type }
  }

  private matchesMarker(action: ComputerAction, marker: string): boolean {
    if (marker === "type" && action.type === "type") return true
    if (marker === "click" && action.type === "click") return true
    if (marker === "scroll" && action.type === "scroll") return true
    if (marker === "launch_app" && action.type === "launch_app") return true
    return false
  }

  async dispose(): Promise<void> {
    /* no-op */
  }
}

describe("ab task set", () => {
  test("returns the six shared tasks in stable order", () => {
    const ids = abTaskSet().map((t) => t.id)
    expect(ids).toEqual(["AB-001", "AB-002", "AB-003", "AB-004", "AB-005", "AB-006"])
  })

  test("AB_TYPED_TEXT and AB_SCROLL_AMOUNT are stable deterministic values", () => {
    expect(AB_TYPED_TEXT).toBe("ab-marker-1")
    expect(AB_SCROLL_AMOUNT).toBe(1)
  })
})

describe("runAbSuite (mock providers)", () => {
  test("runs all six tasks against the happy-path fake and records per-task latency", async () => {
    const provider = new FakeProvider("mock-primary", [
      { id: "0", role: "AXButton", name: "Save" },
      { id: "1", role: "AXTextArea", name: "Editor" },
    ])
    const result = await runAbSuite(async () => provider)
    expect(result.provider).toBe("mock-primary")
    expect(result.cases.map((c) => c.id)).toEqual(["AB-001", "AB-002", "AB-003", "AB-004", "AB-005", "AB-006"])
    for (const c of result.cases) {
      expect(c.ok, `${c.id}: ${c.detail ?? c.refusal}`).toBe(true)
      expect(c.latencyMs).toBeGreaterThanOrEqual(0)
    }
    expect(result.cases.find((c) => c.id === "AB-004")?.actions[0]?.type).toBe("type")
    expect(result.totalLatencyMs).toBeGreaterThanOrEqual(0)
  })

  test("AB-004 issues the typed marker text", async () => {
    const provider = new FakeProvider("mock-typed", [{ id: "0", role: "AXTextArea" }])
    await runAbSuite(async () => provider)
    const typeAction = provider.acts.find((action) => action.type === "type")
    expect(typeAction).toEqual({ type: "type", text: AB_TYPED_TEXT })
  })

  test("AB-006 issues a scroll down with the configured amount", async () => {
    const provider = new FakeProvider("mock-scroll", [])
    await runAbSuite(async () => provider)
    const scrollAction = provider.acts.find((action) => action.type === "scroll")
    expect(scrollAction).toEqual({ type: "scroll", direction: "down", amount: AB_SCROLL_AMOUNT })
  })

  test("AB-005 is skipped when the observation has no button-like element", async () => {
    const provider = new FakeProvider("mock-nobtn", [])
    const result = await runAbSuite(async () => provider)
    const ab005 = result.cases.find((c) => c.id === "AB-005")
    expect(ab005?.ok).toBe(true)
    expect(ab005?.detail).toContain("skipped")
    expect(provider.acts.some((action) => action.type === "click" && action.target.kind === "element")).toBe(false)
  })

  test("AB-005 clicks the first button-like element from the observation", async () => {
    const provider = new FakeProvider("mock-btn", [
      { id: "0", role: "AXGroup", name: "Container" },
      { id: "1", role: "AXButton", name: "Save" },
      { id: "2", role: "AXTextArea", name: "Editor" },
    ])
    const result = await runAbSuite(async () => provider)
    expect(result.cases.find((c) => c.id === "AB-005")?.ok).toBe(true)
    const elementClick = provider.acts.find(
      (action) =>
        action.type === "click" && action.target.kind === "element" && (action.target as { id: string }).id === "1",
    )
    expect(elementClick).toBeDefined()
  })

  test("a per-task refusal is captured verbatim and the suite continues", async () => {
    const provider = new FakeProvider("mock-refuse", [{ id: "0", role: "AXButton" }])
    provider.script.set("type", "same_pid_keyboard_ambiguity")
    const result = await runAbSuite(async () => provider)
    const ab004 = result.cases.find((c) => c.id === "AB-004")
    expect(ab004?.ok).toBe(false)
    expect(ab004?.refusal).toBe("same_pid_keyboard_ambiguity")
    // downstream tasks still ran
    expect(result.cases.find((c) => c.id === "AB-005")?.actions.length).toBeGreaterThan(0)
  })

  test("an exception thrown by the provider is caught and recorded as the task refusal", async () => {
    const provider = new FakeProvider("mock-throw", [])
    provider.act = () =>
      Promise.reject(new ComputerUseError("synthetic boom", { provider: "mock-throw", code: "provider_error" }))
    const result = await runAbSuite(async () => provider)
    expect(result.cases.find((c) => c.id === "AB-001")?.ok).toBe(false)
    expect(result.cases.find((c) => c.id === "AB-001")?.refusal).toContain("synthetic boom")
  })

  test("the provider is disposed exactly once even when a task throws", async () => {
    let disposeCount = 0
    const provider = new FakeProvider("mock-dispose", [])
    provider.dispose = async () => {
      disposeCount += 1
    }
    await runAbSuite(async () => provider)
    expect(disposeCount).toBe(1)
  })

  test("AB-003 is skipped cleanly when the observation carries no screenshot dimensions", async () => {
    const provider = new FakeProvider("mock-nodims", [])
    // strip dimensions from the screenshot to exercise the skip branch
    provider.observe = (async () => ({
      platform: "test",
      provider: provider.name,
      timestamp: Date.now(),
      app: { name: "TextEdit" },
      screenshot: { data: PNG_BASE64, mimeType: "image/png" },
      elements: [],
    })) as never
    const result = await runAbSuite(async () => provider)
    const ab003 = result.cases.find((c) => c.id === "AB-003")
    expect(ab003?.ok).toBe(true)
    expect(ab003?.detail).toContain("skipped")
  })
})

describe("compareAbRuns", () => {
  function mkRun(
    provider: string,
    overrides: Partial<Record<string, { ok: boolean; refusal?: string; latencyMs?: number }>>,
  ): AbSuiteRunResult {
    const ids = ["AB-001", "AB-002", "AB-003", "AB-004", "AB-005", "AB-006"] as const
    const cases: AbCaseResult[] = ids.map((id) => {
      const o = overrides[id] ?? { ok: true, latencyMs: 10 }
      return {
        id,
        name: id,
        ok: o.ok,
        latencyMs: o.latencyMs ?? 10,
        refusal: o.refusal,
        actions: [{ type: "type", ok: o.ok, refusal: o.refusal }],
      }
    })
    return { provider, cases, totalLatencyMs: cases.reduce((sum, c) => sum + c.latencyMs, 0) }
  }

  test("agreements are not discrepancies; identical refusals are flagged both_refused", () => {
    const report = compareAbRuns(
      mkRun("primary", { "AB-004": { ok: false, refusal: "x" } }),
      mkRun("secondary", { "AB-004": { ok: false, refusal: "x" } }),
    )
    expect(report.discrepancies).toEqual([])
    expect(report.rows.find((r) => r.id === "AB-004")?.bothRefused).toBe(true)
    expect(report.rows.find((r) => r.id === "AB-004")?.disagreement).toBe(false)
  })

  test("a one-sided failure is recorded as a discrepancy with the winner", () => {
    const report = compareAbRuns(
      mkRun("primary", { "AB-005": { ok: false, refusal: "wrong_target" } }),
      mkRun("secondary", { "AB-005": { ok: true } }),
    )
    expect(report.discrepancies).toEqual([{ id: "AB-005", name: "AB-005", winner: "secondary" }])
    expect(report.rows.find((r) => r.id === "AB-005")?.disagreement).toBe(true)
  })

  test("counts passed/failed per provider", () => {
    const report = compareAbRuns(
      mkRun("primary", {
        "AB-001": { ok: true },
        "AB-002": { ok: true },
        "AB-003": { ok: false, refusal: "x" },
        "AB-004": { ok: true },
        "AB-005": { ok: true },
        "AB-006": { ok: true },
      }),
      mkRun("secondary", {
        "AB-001": { ok: true },
        "AB-002": { ok: true },
        "AB-003": { ok: true },
        "AB-004": { ok: true },
        "AB-005": { ok: true },
        "AB-006": { ok: true },
      }),
    )
    expect(report.primary.passed).toBe(5)
    expect(report.primary.failed).toBe(1)
    expect(report.secondary.passed).toBe(6)
    expect(report.secondary.failed).toBe(0)
  })
})

describe("formatAbReport", () => {
  test("produces a header, per-task rows, totals, and discrepancy section", () => {
    const report = compareAbRuns(
      mkRunForFormat("primary", [
        { id: "AB-001", ok: true, latencyMs: 100 },
        { id: "AB-002", ok: true, latencyMs: 50 },
        { id: "AB-003", ok: false, refusal: "no screenshot dims", latencyMs: 5 },
        { id: "AB-004", ok: true, latencyMs: 200 },
        { id: "AB-005", ok: true, latencyMs: 30 },
        { id: "AB-006", ok: true, latencyMs: 20 },
      ]),
      mkRunForFormat("secondary", [
        { id: "AB-001", ok: true, latencyMs: 150 },
        { id: "AB-002", ok: true, latencyMs: 80 },
        { id: "AB-003", ok: true, latencyMs: 25 },
        { id: "AB-004", ok: true, latencyMs: 220 },
        { id: "AB-005", ok: true, latencyMs: 40 },
        { id: "AB-006", ok: true, latencyMs: 25 },
      ]),
    )
    const out = formatAbReport(report)
    expect(out).toContain("A/B comparison")
    expect(out).toContain("AB-001")
    expect(out).toContain("AB-006")
    expect(out).toContain("DISAGREE")
    expect(out).toContain("discrepancies:")
    expect(out).toContain("primary: 5/6 passed")
    expect(out).toContain("secondary: 6/6 passed")
  })
})

function mkRunForFormat(
  provider: string,
  cases: { id: string; ok: boolean; refusal?: string; latencyMs: number }[],
): AbSuiteRunResult {
  return {
    provider,
    cases: cases.map((c) => ({
      id: c.id as AbCaseResult["id"],
      name: c.id,
      ok: c.ok,
      latencyMs: c.latencyMs,
      refusal: c.refusal,
      actions: [{ type: "type", ok: c.ok, refusal: c.refusal }],
    })),
    totalLatencyMs: cases.reduce((s, c) => s + c.latencyMs, 0),
  }
}
