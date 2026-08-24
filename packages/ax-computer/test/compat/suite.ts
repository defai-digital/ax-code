import { ComputerUseError } from "../../src/errors"
import type { ComputerUseProvider } from "../../src/provider"
import { ComputerSession } from "../../src/session"
import type { ComputerObservation } from "../../src/types"

export interface CompatCaseResult {
  id: string
  ok: boolean
  detail?: string
}

export interface CompatSuiteOptions {
  /** benign app used for launch/observe/type cases, default "TextEdit" (macOS) */
  app?: string
}

function assert(condition: unknown, detail: string): asserts condition {
  if (!condition) throw new Error(detail)
}

/**
 * CU-001..CU-016 compat suite. Runs against any provider factory — mock
 * providers in CI, live backends when AX_COMPUTER_LIVE=1. Cases are
 * sequential and share one provider instance, mirroring real usage; CU-010
 * builds its own session from two fresh factory instances.
 */
export async function runCompatSuite(
  factory: () => Promise<ComputerUseProvider>,
  options: CompatSuiteOptions = {},
): Promise<CompatCaseResult[]> {
  const app = options.app ?? "TextEdit"
  const results: CompatCaseResult[] = []
  const provider = await factory()

  const run = async (id: string, fn: () => Promise<string | void>) => {
    try {
      const detail = await fn()
      results.push({ id, ok: true, detail: detail ?? undefined })
    } catch (error) {
      results.push({ id, ok: false, detail: error instanceof Error ? error.message : String(error) })
    }
  }

  /** observe the desktop, falling back to the app scope for app-scoped backends */
  const observeAny = async (): Promise<ComputerObservation> => {
    try {
      return await provider.observe({ desktop: true })
    } catch (error) {
      if (error instanceof ComputerUseError && error.code === "unsupported_scope") {
        return provider.observe({ app })
      }
      throw error
    }
  }

  /**
   * Screenshot-pixel point that is safe to click: the center of the observed
   * screenshot. window.bounds is a different (desktop-absolute) coordinate
   * space and must NOT be used here — cua rejects out-of-frame window-local
   * points.
   */
  const safePoint = (observation: ComputerObservation): { x: number; y: number } | undefined => {
    const shot = observation.screenshot
    if (!shot?.width || !shot.height) return undefined
    return { x: Math.floor(shot.width / 2), y: Math.floor(shot.height / 2) }
  }

  try {
    await run("CU-001", async () => {
      const observation = await observeAny()
      assert(observation.screenshot?.data, "observation carries no screenshot")
    })

    await run("CU-002", async () => {
      const apps = await provider.listApps()
      assert(apps.length > 0, "listApps returned no apps")
      return `${apps.length} apps`
    })

    await run("CU-003", async () => {
      const launched = await provider.act({ type: "launch_app", app })
      assert(launched.ok, `launch_app refused: ${launched.refusal ?? launched.detail ?? "?"}`)
      const observation = await provider.observe({ app })
      assert(observation.app || observation.window, "observation after launch has neither app nor window info")
    })

    await run("CU-004", async () => {
      const observation = await provider.observe({ app })
      // elements[0] can be a non-pressable container (live cua: AXPress
      // returned -25206 on an AXGroup); prefer a button-like element
      const element =
        observation.elements.find((el) => /button/i.test(el.role ?? "")) ??
        observation.elements.find((el) => /(menu|cell|link|check\s*box|radio|tab)/i.test(el.role ?? ""))
      if (!element) return "skipped: provider exposes no pressable elements"
      const result = await provider.act({ type: "click", target: { kind: "element", id: element.id } })
      assert(result.ok, `element click refused: ${result.refusal ?? result.detail ?? "?"}`)
      return `clicked ${element.role ?? "?"} "${element.name ?? element.id}"`
    })

    await run("CU-005", async () => {
      const observation = await provider.observe({ app })
      const point = safePoint(observation)
      if (!point) return "skipped: observation screenshot has no dimensions to derive a safe point"
      const result = await provider.act({ type: "click", target: { kind: "point", x: point.x, y: point.y } })
      assert(result.ok, `point click refused: ${result.refusal ?? result.detail ?? "?"}`)
    })

    await run("CU-006", async () => {
      // a freshly launched TextEdit shows a modal Open dialog with nothing
      // editable focused (live OCU refused type_text over this). Escape
      // dismisses the dialog, cmd+n opens a new document; both are harmless
      // in apps that are already in a document, so the sequence stays gated
      // to TextEdit rather than special-casing per provider.
      if (app === "TextEdit") {
        await provider.act({ type: "keypress", keys: ["escape"] })
        await provider.act({ type: "keypress", keys: ["cmd", "n"] })
      }
      const observation = await provider.observe({ app })
      // click the screenshot center to focus the text area before typing
      const point = safePoint(observation)
      if (point) {
        await provider.act({ type: "click", target: { kind: "point", x: point.x, y: point.y } })
      }
      const result = await provider.act({ type: "type", text: "ax" })
      assert(result.ok, `type refused: ${result.refusal ?? result.detail ?? "?"}`)
    })

    await run("CU-007", async () => {
      await provider.observe({ app })
      const result = await provider.act({ type: "keypress", keys: ["a"] })
      assert(result.ok, `keypress refused: ${result.refusal ?? result.detail ?? "?"}`)
    })

    await run("CU-008", async () => {
      const observation = await provider.observe({ app })
      const untargeted = await provider.act({ type: "scroll", direction: "down", amount: 1 })
      if (untargeted.ok) return
      // The app-scoped OCU dialect refuses untargeted scroll by design (see
      // "Known intentional gaps"): retry against a scrollable element from
      // the observation instead of treating the refusal as a failure.
      const refusal = untargeted.refusal ?? untargeted.detail ?? "?"
      assert(/element target/.test(refusal), `scroll refused: ${refusal}`)
      const element =
        observation.elements.find((el) => /scroll\s*area/i.test(el.role ?? "")) ??
        observation.elements.find((el) => /(text\s*area|web\s*area|table|outline|list)/i.test(el.role ?? "")) ??
        observation.elements[0]
      assert(element, "scroll requires an element target but the observation exposes no elements")
      const targeted = await provider.act({
        type: "scroll",
        target: { kind: "element", id: element.id },
        direction: "down",
        amount: 1,
      })
      assert(targeted.ok, `element-targeted scroll refused: ${targeted.refusal ?? targeted.detail ?? "?"}`)
      return `element-targeted scroll via ${element.role ?? "?"} "${element.name ?? element.id}"`
    })

    await run("CU-009", async () => {
      if (!provider.capabilities().windowActivation || !provider.listWindows) {
        return "skipped: provider does not support window activation"
      }
      const windows = await provider.listWindows()
      // Pick the activation target deliberately: live TextEdit reports
      // 1440x30 menu-bar slivers and service windows, and cua refuses to
      // foreground a window it cannot verify. Prefer a window owned by the
      // suite's app with a real frame; fall back to any non-degenerate window.
      const real = windows.filter((window) => window.bounds.width >= 100 && window.bounds.height >= 100)
      const target = real.find((window) => window.app?.name === app) ?? real[0]
      if (!target) return "skipped: listWindows returned no window with a non-degenerate frame"
      const result = await provider.act({ type: "activate_window", windowId: target.id })
      assert(result.ok, `activate_window refused: ${result.refusal ?? result.detail ?? "?"}`)
      return `activated window ${target.id} (${target.app?.name ?? "unknown app"})`
    })

    await run("CU-010", async () => {
      const first = await factory()
      const second = await factory()
      const session = new ComputerSession(first)
      try {
        await session.observe({ app })
        const fresh = await session.failover(second)
        assert(fresh.provider === second.name, "failover observation did not come from the new provider")
        const point = safePoint(fresh)
        if (!point) return "failover ok; act skipped (no window bounds for a safe point)"
        const result = await session.act({ type: "click", target: { kind: "point", x: point.x, y: point.y } })
        assert(result.ok, `act after failover refused: ${result.refusal ?? result.detail ?? "?"}`)
        assert(result.provider === second.name, "act after failover was not routed to the new provider")
      } finally {
        await session.dispose()
      }
    })

    await run("CU-011", async () => {
      // wait support is advertised via capabilities.actions; providers that
      // only speak the original action set skip, matching CU-009's gating
      if (!provider.capabilities().actions.includes("wait")) {
        return "skipped: provider does not advertise the wait action"
      }
      const observation = await provider.observe({ app })
      const element = observation.elements[0]
      if (!element) return "skipped: observation exposes no elements to wait on"
      // the element is already on screen, so a conforming backend resolves on
      // the first poll; the timeout only guards against a hung wait
      const result = await provider.act({
        type: "wait",
        condition: { type: "element_visible", target: { kind: "element", id: element.id } },
        timeoutMs: 2_000,
      })
      assert(result.ok, `wait element_visible refused: ${result.refusal ?? result.detail ?? "?"}`)
    })

    await run("CU-012", async () => {
      if (typeof provider.actBatch !== "function") return "skipped: provider does not support batch act"
      const observation = await provider.observe({ app })
      const point = safePoint(observation)
      if (!point) return "skipped: observation screenshot has no dimensions to derive a safe point"
      const result = await provider.actBatch([
        { type: "click", target: { kind: "point", x: point.x, y: point.y } },
        { type: "click", target: { kind: "point", x: point.x, y: point.y } },
      ])
      assert(result.ok, `batch refused: ${result.refusal ?? result.detail ?? "?"}`)
      const steps = result.results ?? []
      assert(steps.length === 2, `batch returned ${steps.length} step results, expected 2`)
      assert(steps[0]?.index === 0 && steps[0].ok, "batch step 0 did not report ok")
      assert(steps[1]?.index === 1 && steps[1].ok, "batch step 1 did not report ok")
    })

    await run("CU-013", async () => {
      if (typeof provider.actBatch !== "function") return "skipped: provider does not support batch act"
      const observation = await provider.observe({ app })
      const point = safePoint(observation)
      if (!point) return "skipped: observation screenshot has no dimensions to derive a safe point"
      // the middle step targets an element id no observation ever issued, so
      // every conforming backend must refuse it; the default stopOnError must
      // then abort the trailing step before it runs
      const result = await provider.actBatch([
        { type: "click", target: { kind: "point", x: point.x, y: point.y } },
        { type: "click", target: { kind: "element", id: "ax-compat-no-such-element" } },
        { type: "click", target: { kind: "point", x: point.x, y: point.y } },
      ])
      assert(!result.ok, "batch with a refused middle step reported ok")
      const steps = result.results ?? []
      assert(steps.length === 2, `stopOnError did not abort the batch: ${steps.length} step results, expected 2`)
      assert(steps[0]?.ok === true, "batch step 0 should have run and succeeded")
      assert(steps[1]?.ok === false, "batch step 1 should report the refusal")
      assert(steps[1]?.refusal, "batch step 1 carries no refusal code")
    })

    // passive observe (CU-014..CU-016) gates on a feature probe: providers
    // without passive support ignore the options and return a legacy
    // observation (no revision), which skips all three cases — matching the
    // capabilities/probe gating style of CU-009..CU-013
    let passive: { revision: string } | undefined

    await run("CU-014", async () => {
      const bootstrap = await provider.observe({ app }, { sinceRevision: null })
      if (bootstrap.revision === undefined || bootstrap.frameHash === undefined) {
        return "skipped: provider does not support passive observe"
      }
      assert(bootstrap.elements.length === 0, "passive bootstrap carried targetable elements")
      assert(bootstrap.gap !== true, "passive bootstrap reported a gap")
      passive = { revision: bootstrap.revision }
      return `revision ${bootstrap.revision}`
    })

    await run("CU-015", async () => {
      if (!passive) return "skipped: provider does not support passive observe"
      const poll = await provider.observe({ app }, { sinceRevision: passive.revision })
      assert(poll.unchanged === true, "immediate passive re-poll did not report unchanged: true")
      assert(poll.revision === passive.revision, "unchanged poll moved the revision")
      assert(!poll.screenshot, "unchanged poll carried a screenshot")
      assert(poll.elements.length === 0, "unchanged poll carried elements")
    })

    await run("CU-016", async () => {
      if (!passive) return "skipped: provider does not support passive observe"
      const typed = await provider.act({ type: "type", text: "ax-passive" })
      assert(typed.ok, `type refused: ${typed.refusal ?? typed.detail ?? "?"}`)
      const poll = await provider.observe({ app }, { sinceRevision: passive.revision })
      assert(poll.unchanged === false, "poll after a visible change did not report unchanged: false")
      assert(poll.revision !== undefined && poll.revision !== passive.revision, "changed poll issued no new revision")
      assert(poll.gap !== true, "changed poll reported a gap for a known revision")
      assert(poll.elements.length === 0, "passive change frame carried targetable elements")
      passive = { revision: poll.revision }
    })
  } finally {
    await provider.dispose()
  }

  return results
}
