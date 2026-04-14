import { describe, expect, test } from "bun:test"
import {
  createTuiRendererContractTemplate,
  evaluateTuiRendererParity,
  normalizeTuiRendererContractReport,
  TUI_NATIVE_DEFAULT_REQUIRED_CRITERIA,
  validateTuiRendererParityBenchmarkReport,
  type TuiRendererContractReport,
  type TuiRendererParityBenchmarkReport,
} from "../../../src/cli/cmd/tui/renderer-parity"
import {
  TUI_PERFORMANCE_CRITERIA,
  TUI_PERFORMANCE_CRITERIA_VERSION,
} from "../../../src/cli/cmd/tui/performance-criteria"
import { TUI_RENDERER_CONTRACT, TUI_RENDERER_CONTRACT_VERSION } from "../../../src/cli/cmd/tui/renderer-contract"

const contract: TuiRendererContractReport = {
  version: TUI_RENDERER_CONTRACT_VERSION,
  statuses: TUI_RENDERER_CONTRACT.map((item) => ({
    id: item.id,
    status: "passed",
    evidence: [`test:${item.id}`],
  })),
}

function report(input: Partial<TuiRendererParityBenchmarkReport> = {}): TuiRendererParityBenchmarkReport {
  return {
    version: TUI_PERFORMANCE_CRITERIA_VERSION,
    metadata: { renderer: { name: "native" } },
    results: TUI_NATIVE_DEFAULT_REQUIRED_CRITERIA.map((criterionID) => ({
      id: `${criterionID}:probe`,
      criterionID,
      metric: metricFor(criterionID),
      value: metricFor(criterionID) === "minFps" ? 60 : 1,
    })),
    verdict: { ok: true, failures: [] },
    ...input,
  }
}

function metricFor(criterionID: string): "p95Ms" | "minFps" {
  const criterion = TUI_PERFORMANCE_CRITERIA.find((item) => item.id === criterionID)
  if (!criterion) throw new Error(`Missing test criterion ${criterionID}`)
  return criterion.target.minFps === undefined ? "p95Ms" : "minFps"
}

describe("tui renderer parity", () => {
  test("keeps native flagged when required benchmark coverage is missing", () => {
    const decision = evaluateTuiRendererParity({
      renderer: "native",
      benchmarkReport: report({ results: [] }),
      contract,
      opentuiFallbackRetained: true,
    })

    expect(decision.action).toBe("keep-native-flagged")
    expect(decision.checks.some((check) => check.id === "benchmark.startup.first-frame")).toBe(true)
  })

  test("keeps OpenTUI default unless the native renderer is evaluated", () => {
    const decision = evaluateTuiRendererParity({
      renderer: "opentui",
      benchmarkReport: report(),
      contract,
      opentuiFallbackRetained: true,
    })

    expect(decision.action).toBe("retain-opentui-default")
    expect(decision.ready).toBe(false)
  })

  test("requires OpenTUI fallback retention before default promotion", () => {
    const decision = evaluateTuiRendererParity({
      renderer: "native",
      benchmarkReport: report(),
      contract,
      opentuiFallbackRetained: false,
    })

    expect(decision.action).toBe("keep-native-flagged")
    expect(decision.checks).toContainEqual(
      expect.objectContaining({ id: "fallback.opentui-retained", status: "failed" }),
    )
  })

  test("promotes native only when benchmarks and contract gates pass", () => {
    const decision = evaluateTuiRendererParity({
      renderer: "native",
      benchmarkReport: report(),
      contract,
      opentuiFallbackRetained: true,
    })

    expect(decision).toMatchObject({ action: "promote-native-default", ready: true })
  })

  test("requires current contract version and provides a fail-closed template", () => {
    const template = createTuiRendererContractTemplate()
    const decision = evaluateTuiRendererParity({
      renderer: "native",
      benchmarkReport: report(),
      contract: { ...contract, version: "old" },
      opentuiFallbackRetained: true,
    })

    expect(template.statuses.every((item) => item.status === "failed")).toBe(true)
    expect(decision.action).toBe("keep-native-flagged")
    expect(decision.checks).toContainEqual(expect.objectContaining({ id: "contract.version", status: "failed" }))
  })

  test("fails parity on inconsistent benchmark verdicts and contract id mistakes", () => {
    const decision = evaluateTuiRendererParity({
      renderer: "native",
      benchmarkReport: report({
        results: [
          ...report().results,
          { id: "startup.first-frame:duplicate", criterionID: "startup.first-frame", metric: "p95Ms", value: 1 },
        ],
        verdict: { ok: true, failures: ["startup.first-frame:probe: failed"] },
      }),
      contract: {
        ...contract,
        statuses: [...contract.statuses, contract.statuses[0]!, { id: "unknown.contract", status: "passed" }],
      },
      opentuiFallbackRetained: true,
    })

    expect(decision.action).toBe("keep-native-flagged")
    expect(decision.checks).toContainEqual(expect.objectContaining({ id: "benchmark.report", status: "failed" }))
    expect(decision.checks).toContainEqual(
      expect.objectContaining({ id: "benchmark.duplicate-criteria", status: "failed" }),
    )
    expect(decision.checks).toContainEqual(expect.objectContaining({ id: "contract.duplicate-ids", status: "failed" }))
    expect(decision.checks).toContainEqual(expect.objectContaining({ id: "contract.unknown-ids", status: "failed" }))
  })

  test("rechecks benchmark metric and threshold even when report verdict says ok", () => {
    const decision = evaluateTuiRendererParity({
      renderer: "native",
      benchmarkReport: report({
        results: report().results.map((item) =>
          item.criterionID === "startup.first-frame" ? { ...item, metric: "minFps", value: 1 } : item,
        ),
      }),
      contract,
      opentuiFallbackRetained: true,
    })
    const slowDecision = evaluateTuiRendererParity({
      renderer: "native",
      benchmarkReport: report({
        results: report().results.map((item) =>
          item.criterionID === "input.keypress-echo" ? { ...item, value: 1_000 } : item,
        ),
      }),
      contract,
      opentuiFallbackRetained: true,
    })

    expect(decision.action).toBe("keep-native-flagged")
    expect(decision.checks).toContainEqual(
      expect.objectContaining({ id: "benchmark.startup.first-frame", status: "failed" }),
    )
    expect(slowDecision.action).toBe("keep-native-flagged")
    expect(slowDecision.checks).toContainEqual(
      expect.objectContaining({ id: "benchmark.input.keypress-echo", status: "failed" }),
    )
  })

  test("requires evidence for passed contract gates", () => {
    const decision = evaluateTuiRendererParity({
      renderer: "native",
      benchmarkReport: report(),
      contract: {
        ...contract,
        statuses: contract.statuses.map((item) =>
          item.id === "frame.lifecycle" ? { id: item.id, status: "passed" } : item,
        ),
      },
      opentuiFallbackRetained: true,
    })

    expect(decision.action).toBe("keep-native-flagged")
    expect(decision.checks).toContainEqual(expect.objectContaining({ id: "contract.evidence", status: "failed" }))
  })

  test("validates benchmark and contract report shapes", () => {
    expect(() =>
      validateTuiRendererParityBenchmarkReport({ version: "x", results: [], verdict: { ok: true } }),
    ).toThrow("verdict.failures")
    expect(() =>
      validateTuiRendererParityBenchmarkReport({
        version: "x",
        results: [{ id: "startup", criterionID: "startup.first-frame" }],
        verdict: { ok: true, failures: [] },
      }),
    ).toThrow("metric")
    expect(() => normalizeTuiRendererContractReport({ version: "x", statuses: [{ id: "frame.lifecycle" }] })).toThrow(
      "status",
    )
    expect(() =>
      normalizeTuiRendererContractReport({
        version: "x",
        statuses: [{ id: "frame.lifecycle", status: "passed", evidence: [123] }],
      }),
    ).toThrow("evidence")
    expect(normalizeTuiRendererContractReport([{ id: "frame.lifecycle", status: "passed" }]).version).toBe("missing")
  })
})
