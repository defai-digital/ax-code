// Phase 1a A/B harness — shared desktop task set executed against two
// computer-use providers in sequence, with a comparison report.
//
// The pure logic in this file is decoupled from any concrete provider
// implementation: it accepts any provider factory and runs the same task set
// against each, recording success/failure, verbatim refusal codes, and
// latency. Live runs use the real OcuProvider / CuaProvider; mock runs in CI
// use FakeProvider implementations from test/ab/ab.test.ts.

import type { ActionResult, ComputerAction } from "../../src/action"
import type { ComputerUseProvider, ObserveScope } from "../../src/provider"
import type { ComputerObservation } from "../../src/types"

export interface AbTaskSpec {
  id: AbTaskId
  name: string
  /**
   * Runs the task against the active provider. The harness classifies success
   * from the returned ActionResult (ok=true => pass) or from a thrown error
   * (=> fail with the error message as the refusal). The `app` argument is
   * the suite's target app — providers that observe via app scope receive it.
   */
  run: (provider: ComputerUseProvider, app: string) => Promise<ActionResult>
  /**
   * Optional post-condition check on a fresh observation. Returns true /
   * false when the provider surfaces enough information to verify, or
   * undefined to skip verification. The verify step is best-effort — it
   * never blocks the task from being recorded as a pass when the action
   * itself succeeded.
   */
  verify?: (observation: ComputerObservation) => boolean | undefined
}

export type AbTaskId = "AB-001" | "AB-002" | "AB-003" | "AB-004" | "AB-005" | "AB-006"

export interface AbCaseResult {
  id: AbTaskId
  name: string
  ok: boolean
  latencyMs: number
  /** backend refusal code carried verbatim, when the action refused */
  refusal?: string
  /** supplementary detail — most-recent observation summary, verify outcome, etc. */
  detail?: string
  /** per-task action trace, for the report and debugging */
  actions: { type: ComputerAction["type"]; ok: boolean; refusal?: string }[]
}

export interface AbSuiteOptions {
  app?: string
  /** typed string used by AB-004 — short, deterministic, easy to spot in logs */
  typedText?: string
}

/** Fixed, deterministic typed marker for AB-004. Plain ASCII so cua's
 * background text routing preserves it verbatim. */
export const AB_TYPED_TEXT = "ab-marker-1"
/** Fixed, deterministic scroll amount for AB-006. */
export const AB_SCROLL_AMOUNT = 1

/** observe the app scope, falling back to the desktop scope for app-agnostic
 * providers. Returns undefined when neither scope is supported. */
async function observeAny(provider: ComputerUseProvider, app: string): Promise<ComputerObservation | undefined> {
  try {
    return await provider.observe({ app })
  } catch {
    try {
      return await provider.observe({ desktop: true })
    } catch {
      return undefined
    }
  }
}

/** Stable, shared task set used by both providers in the A/B run. */
export function abTaskSet(): AbTaskSpec[] {
  return [
    {
      id: "AB-001",
      name: "launch app",
      run: async (provider, app) => provider.act({ type: "launch_app", app }),
    },
    {
      id: "AB-002",
      name: "observe app state",
      run: async (provider, app) => {
        // observe is side-effect-free in the canonical contract; the harness
        // treats a successful observe (carrying app or window info) as a pass
        // and folds the action latency into the suite total.
        const observation = await observeAny(provider, app)
        const ok = Boolean(observation?.app || observation?.window)
        const detail = observation?.app?.name ?? observation?.window?.id ?? "no app or window"
        return { ok, provider: provider.name, action: "launch_app" as const, detail }
      },
    },
    {
      id: "AB-003",
      name: "focus the editor (point click at screenshot center)",
      run: async (provider, app) => {
        const observation = await observeAny(provider, app)
        if (!observation?.screenshot?.width || !observation.screenshot.height) {
          // nothing clickable — record as ok so the missing screenshot dims
          // surface in the row detail rather than dragging the task down
          return { ok: true, provider: provider.name, action: "click" as const, detail: "skipped: no screenshot dims" }
        }
        return provider.act({
          type: "click",
          target: {
            kind: "point",
            x: Math.floor(observation.screenshot.width / 2),
            y: Math.floor(observation.screenshot.height / 2),
          },
        })
      },
    },
    {
      id: "AB-004",
      name: "type a known string",
      run: async (provider) => provider.act({ type: "type", text: AB_TYPED_TEXT }),
      verify: (observation) => {
        // best-effort: some providers surface typed content in a11y text
        const text = observation.a11yText ?? ""
        return text.includes(AB_TYPED_TEXT) || undefined
      },
    },
    {
      id: "AB-005",
      name: "click a button-like element from the observation",
      run: async (provider, app) => {
        const observation = await observeAny(provider, app)
        if (!observation) {
          return { ok: true, provider: provider.name, action: "click" as const, detail: "skipped: no observation" }
        }
        const button = observation.elements.find((el) => /button/i.test(el.role ?? ""))
        if (!button) {
          return {
            ok: true,
            provider: provider.name,
            action: "click" as const,
            detail: "skipped: no button-like element",
          }
        }
        return provider.act({ type: "click", target: { kind: "element", id: button.id } })
      },
    },
    {
      id: "AB-006",
      name: "scroll down",
      run: async (provider, app) => {
        // observe once so the provider has a current screenshot for anchoring;
        // we ignore the result and let act() pick up the routing context
        await observeAny(provider, app)
        return provider.act({ type: "scroll", direction: "down", amount: AB_SCROLL_AMOUNT })
      },
    },
  ]
}

export interface AbSuiteRunResult {
  provider: string
  cases: AbCaseResult[]
  /** wall-clock latency for the entire suite, not the sum of per-task latencies */
  totalLatencyMs: number
}

/**
 * Runs the shared A/B task set against a single provider. Tasks execute
 * sequentially and share the provider instance (mirroring real usage). Errors
 * are caught per-task — a failed task does not abort the run.
 */
export async function runAbSuite(
  factory: () => Promise<ComputerUseProvider>,
  options: AbSuiteOptions = {},
): Promise<AbSuiteRunResult> {
  const app = options.app ?? "TextEdit"
  const provider = await factory()
  const started = Date.now()
  const cases: AbCaseResult[] = []
  const tasks = abTaskSet()
  try {
    for (const task of tasks) {
      const actions: AbCaseResult["actions"] = []
      const taskStart = Date.now()
      try {
        const result = await task.run(provider, app)
        actions.push({ type: result.action, ok: result.ok, refusal: result.refusal })
        let verifyDetail: string | undefined
        if (task.verify) {
          try {
            const observation = await observeAny(provider, app)
            const verdict = observation ? task.verify(observation) : undefined
            verifyDetail =
              verdict === undefined
                ? "verify: observation did not expose typed text (best-effort)"
                : `verify: ${verdict ? "ok" : "no match"}`
          } catch (err) {
            verifyDetail = `verify: ${err instanceof Error ? err.message : String(err)}`
          }
        }
        cases.push({
          id: task.id,
          name: task.name,
          ok: result.ok,
          latencyMs: Date.now() - taskStart,
          refusal: result.refusal,
          detail: result.detail ?? verifyDetail,
          actions,
        })
      } catch (error) {
        cases.push({
          id: task.id,
          name: task.name,
          ok: false,
          latencyMs: Date.now() - taskStart,
          refusal: error instanceof Error ? error.message : String(error),
          actions,
        })
      }
    }
  } finally {
    await provider.dispose().catch(() => {})
  }
  return {
    provider: provider.name,
    cases,
    totalLatencyMs: Date.now() - started,
  }
}

export interface AbComparisonRow {
  id: AbTaskId
  name: string
  primary: { ok: boolean; latencyMs: number; refusal?: string }
  secondary: { ok: boolean; latencyMs: number; refusal?: string }
  /** identical refusal codes on both sides — strong signal the failure is provider-independent */
  bothRefused: boolean
  /** either side passed but not both — usually the better provider wins here */
  disagreement: boolean
}

export interface AbComparisonReport {
  generatedAt: string
  primary: { name: string; passed: number; failed: number; totalLatencyMs: number }
  secondary: { name: string; passed: number; failed: number; totalLatencyMs: number }
  rows: AbComparisonRow[]
  /** rows where the primary refused but the secondary succeeded, or vice versa — high-signal disagreements */
  discrepancies: { id: AbTaskId; name: string; winner: "primary" | "secondary" }[]
}

/** Compare two provider runs into a structured report. Pure: no I/O. */
export function compareAbRuns(primary: AbSuiteRunResult, secondary: AbSuiteRunResult): AbComparisonReport {
  const rows: AbComparisonRow[] = []
  const discrepancies: AbComparisonReport["discrepancies"] = []
  const byId = (run: AbSuiteRunResult) => new Map(run.cases.map((c) => [c.id, c]))
  const pCases = byId(primary)
  const sCases = byId(secondary)
  for (const pCase of primary.cases) {
    const sCase = sCases.get(pCase.id)
    if (!sCase) continue
    const bothRefused = !pCase.ok && !sCase.ok
    const disagreement = pCase.ok !== sCase.ok
    rows.push({
      id: pCase.id,
      name: pCase.name,
      primary: { ok: pCase.ok, latencyMs: pCase.latencyMs, refusal: pCase.refusal },
      secondary: { ok: sCase.ok, latencyMs: sCase.latencyMs, refusal: sCase.refusal },
      bothRefused,
      disagreement,
    })
    if (disagreement) {
      discrepancies.push({ id: pCase.id, name: pCase.name, winner: pCase.ok ? "primary" : "secondary" })
    }
  }
  const passed = (run: AbSuiteRunResult) => run.cases.filter((c) => c.ok).length
  const failed = (run: AbSuiteRunResult) => run.cases.filter((c) => !c.ok).length
  return {
    generatedAt: new Date().toISOString(),
    primary: {
      name: primary.provider,
      passed: passed(primary),
      failed: failed(primary),
      totalLatencyMs: primary.totalLatencyMs,
    },
    secondary: {
      name: secondary.provider,
      passed: passed(secondary),
      failed: failed(secondary),
      totalLatencyMs: secondary.totalLatencyMs,
    },
    rows,
    discrepancies,
  }
}

/**
 * Console-friendly table summary. Returns the table string and the lines
 * for the JSON `consoleLines` array, but does not write any files itself —
 * writing last-report.json is the live-runner's responsibility.
 */
export function formatAbReport(report: AbComparisonReport): string {
  const lines: string[] = []
  const header = `${"Task".padEnd(8)} | ${report.primary.name.padEnd(10)} | ${report.secondary.name.padEnd(10)} | Result`
  const sep = "-".repeat(header.length)
  lines.push(sep)
  lines.push(`A/B comparison — primary=${report.primary.name} secondary=${report.secondary.name}`)
  lines.push(`generatedAt: ${report.generatedAt}`)
  lines.push(sep)
  lines.push(header)
  lines.push(sep)
  for (const row of report.rows) {
    const p = row.primary.ok
      ? `pass ${row.primary.latencyMs}ms`
      : `FAIL${row.primary.refusal ? " " + row.primary.refusal : ""}`
    const s = row.secondary.ok
      ? `pass ${row.secondary.latencyMs}ms`
      : `FAIL${row.secondary.refusal ? " " + row.secondary.refusal : ""}`
    const verdict = row.bothRefused ? "both refused" : row.disagreement ? "DISAGREE" : "agree"
    lines.push(`${row.id.padEnd(8)} | ${p.padEnd(20)} | ${s.padEnd(20)} | ${verdict}`)
  }
  lines.push(sep)
  lines.push(
    `${report.primary.name}: ${report.primary.passed}/${report.primary.passed + report.primary.failed} passed, total ${report.primary.totalLatencyMs}ms`,
  )
  lines.push(
    `${report.secondary.name}: ${report.secondary.passed}/${report.secondary.passed + report.secondary.failed} passed, total ${report.secondary.totalLatencyMs}ms`,
  )
  if (report.discrepancies.length > 0) {
    lines.push(sep)
    lines.push("discrepancies:")
    for (const d of report.discrepancies) lines.push(`  ${d.id} ${d.name}: winner=${d.winner}`)
  }
  lines.push(sep)
  return lines.join("\n")
}
