import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import {
  findSessionQualityAction,
  hasSidebarSignal,
  renderSessionChecksSummary,
  renderSessionDecisionHintsSummary,
  renderSessionQualityBrief,
  renderSessionQualityInlineSummary,
  renderSessionQualityPrompt,
  renderSessionQualitySidebarLine,
  renderSessionReviewResultsSummary,
  sessionQualityActions,
  sessionQualityActionValue,
  sessionQualityDetailItems,
} from "../../../src/cli/cmd/tui/routes/session/quality"
import type { VerificationEnvelope } from "../../../src/quality/verification-envelope"
import type { ReviewResult } from "../../../src/quality/review-result"
import type { DecisionHints } from "../../../src/session/decision-hints"

const SESSION_ROUTE_SRC = path.resolve(import.meta.dir, "../../../src/cli/cmd/tui/routes/session/index.tsx")

describe("tui session quality actions", () => {
  test("builds capture evidence actions when no replay items are exportable yet", () => {
    const actions = sessionQualityActions({
      sessionID: "ses_capture",
      quality: {
        review: {
          workflow: "review",
          overallStatus: "fail",
          readyForBenchmark: false,
          labeledItems: 0,
          resolvedLabeledItems: 0,
          unresolvedLabeledItems: 0,
          missingLabels: 0,
          totalItems: 0,
          nextAction: "Capture review workflow activity before exporting replay again.",
          gates: [],
        },
        debug: null,
      },
    })

    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({
      workflow: "review",
      kind: "capture_evidence",
      title: "Capture Review Evidence",
    })
    expect(actions[0]?.description).toBe("blocked · no replay evidence yet")
    expect(sessionQualityActionValue(actions[0]!)).toBe("session.quality.review.capture_evidence")
    expect(actions[0]?.prompt.input).toContain("session ses_capture")
    expect(actions[0]?.prompt.input).toContain("produce review workflow evidence")
  })

  test("uses a workflow-specific capture fallback when next action is missing", () => {
    const actions = sessionQualityActions({
      sessionID: "ses_capture_fallback",
      quality: {
        debug: {
          workflow: "debug",
          overallStatus: "fail",
          readyForBenchmark: false,
          labeledItems: 0,
          resolvedLabeledItems: 0,
          unresolvedLabeledItems: 0,
          missingLabels: 0,
          totalItems: 0,
          nextAction: null,
          gates: [],
        },
        review: null,
      },
    })

    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({
      workflow: "debug",
      kind: "capture_evidence",
      footer: "Capture debug workflow activity before exporting replay again.",
    })
    expect(renderSessionQualityBrief(actions[0]!)).toContain(
      "- next action: Capture debug workflow activity before exporting replay again.",
    )
  })

  test("builds missing-label actions when replay evidence exists but outcome labels are not recorded yet", () => {
    const actions = sessionQualityActions({
      sessionID: "ses_label",
      quality: {
        review: {
          workflow: "review",
          overallStatus: "warn",
          readyForBenchmark: false,
          labeledItems: 1,
          resolvedLabeledItems: 1,
          unresolvedLabeledItems: 0,
          missingLabels: 2,
          totalItems: 3,
          nextAction: "Finish label coverage for the remaining exported artifacts.",
          gates: [
            {
              name: "label-coverage",
              status: "warn",
              detail: "1 labeled, 2 missing, 0 unresolved",
            },
          ],
        },
        debug: null,
      },
    })

    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({
      workflow: "review",
      kind: "finish_label_coverage",
      title: "Record Review Outcome Labels",
      footer: "Record outcome labels for the remaining exported artifacts.",
    })
    expect(sessionQualityActionValue(actions[0]!)).toBe("session.quality.review.finish_label_coverage")
    expect(actions[0]?.description).toContain("1/3 resolved labels · 2 missing")
    expect(actions[0]?.prompt.input).toContain("2 missing label(s), 0 unresolved label(s)")
    expect(actions[0]?.prompt.input).toContain("record the missing outcome labels")
  })

  test("infers missing labels from legacy counts when missing label metadata is absent", () => {
    const actions = sessionQualityActions({
      sessionID: "ses_label_legacy",
      quality: {
        review: {
          workflow: "review",
          overallStatus: "warn",
          readyForBenchmark: false,
          labeledItems: 1,
          resolvedLabeledItems: 1,
          unresolvedLabeledItems: 0,
          missingLabels: 0,
          totalItems: 3,
          nextAction: "Finish label coverage for the remaining exported artifacts.",
          gates: [],
        },
        debug: null,
      },
    })

    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({
      workflow: "review",
      kind: "finish_label_coverage",
      title: "Record Review Outcome Labels",
      footer: "Record outcome labels for the remaining exported artifacts.",
    })
    expect(actions[0]?.description).toContain("1/3 resolved labels · 2 missing")
  })

  test("builds unresolved-label actions when labels exist but outcomes still need to be resolved", () => {
    const actions = sessionQualityActions({
      sessionID: "ses_unresolved",
      quality: {
        review: {
          workflow: "review",
          overallStatus: "warn",
          readyForBenchmark: false,
          labeledItems: 3,
          resolvedLabeledItems: 1,
          unresolvedLabeledItems: 2,
          missingLabels: 0,
          totalItems: 3,
          nextAction: "Finish label coverage for the remaining exported artifacts.",
          gates: [
            {
              name: "label-coverage",
              status: "warn",
              detail: "3 labeled, 0 missing, 2 unresolved",
            },
          ],
        },
        debug: null,
      },
    })

    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({
      workflow: "review",
      kind: "finish_label_coverage",
      title: "Resolve Review Outcome Labels",
      footer: "Revisit unresolved outcome labels using the current session evidence.",
    })
    expect(actions[0]?.description).toContain("1/3 resolved labels · 2 unresolved")
    expect(actions[0]?.prompt.input).toContain("revisit unresolved outcome labels")
    expect(actions[0]?.prompt.input).toContain("0 missing label(s), 2 unresolved label(s)")
  })

  test("builds benchmark actions when workflow readiness is benchmark-ready", () => {
    const actions = sessionQualityActions({
      sessionID: "ses_benchmark",
      quality: {
        review: null,
        debug: {
          workflow: "debug",
          overallStatus: "pass",
          readyForBenchmark: true,
          labeledItems: 2,
          resolvedLabeledItems: 2,
          unresolvedLabeledItems: 0,
          missingLabels: 0,
          totalItems: 2,
          nextAction: null,
          gates: [
            {
              name: "benchmark-readiness",
              status: "pass",
              detail: "2 resolved label(s) available for calibration or benchmark work",
            },
          ],
        },
      },
    })

    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({
      workflow: "debug",
      kind: "benchmark",
      title: "Benchmark Debug Replay",
      footer: "Ready to benchmark the current replay export.",
    })
    expect(sessionQualityActionValue(actions[0]!)).toBe("session.quality.debug.benchmark")
    expect(actions[0]?.prompt.input).toContain("Quality readiness context for session ses_benchmark:")
    expect(actions[0]?.prompt.input).toContain("Prepare the next benchmark step for the current debug replay evidence.")
  })

  test("builds qa actions with targeted test recommendation context", () => {
    const actions = sessionQualityActions({
      sessionID: "ses_qa",
      quality: {
        review: null,
        debug: null,
        qa: {
          workflow: "qa",
          overallStatus: "warn",
          readyForBenchmark: false,
          labeledItems: 1,
          resolvedLabeledItems: 0,
          unresolvedLabeledItems: 1,
          missingLabels: 1,
          totalItems: 2,
          nextAction: "Finish QA label coverage for the remaining exported test artifacts.",
          gates: [
            {
              name: "targeted-test-recommendation",
              status: "pass",
              detail: "prioritize these QA command(s): bun test test/auth.test.ts",
            },
          ],
        },
      },
    })

    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({
      workflow: "qa",
      kind: "finish_label_coverage",
      title: "Finish QA Label Coverage",
      footer: "Finish label coverage for the remaining exported artifacts.",
    })
    expect(actions[0]?.prompt.input).toContain("Use the current session's QA replay evidence")
    expect(actions[0]?.prompt.input).toContain("Targeted QA recommendation: run bun test test/auth.test.ts first.")
    expect(renderSessionQualityBrief(actions[0]!)).toContain("- recommended tests: bun test test/auth.test.ts")
    expect(renderSessionQualityBrief(actions[0]!)).toContain(
      "[pass] targeted-test-recommendation: prioritize these QA command(s): bun test test/auth.test.ts",
    )
    expect(renderSessionQualityInlineSummary(actions[0]!)).toBe(
      "finish label coverage · needs labels · 0/2 resolved labels · 1 missing · 1 unresolved · first: bun test test/auth.test.ts",
    )
  })

  test("switches to replay-readiness guidance when labels are complete but benchmarking is still blocked", () => {
    const actions = sessionQualityActions({
      sessionID: "ses_readiness_blocked",
      quality: {
        review: {
          workflow: "review",
          overallStatus: "warn",
          readyForBenchmark: false,
          labeledItems: 3,
          resolvedLabeledItems: 3,
          unresolvedLabeledItems: 0,
          missingLabels: 0,
          totalItems: 3,
          nextAction: "Finish label coverage for the remaining exported artifacts.",
          gates: [
            {
              name: "refresh-required",
              status: "warn",
              detail: "refresh replay readiness after recent session activity",
            },
          ],
        },
        debug: null,
      },
    })

    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({
      workflow: "review",
      kind: "finish_label_coverage",
      title: "Check Review Replay Readiness",
      footer: "Check review replay readiness gates before benchmarking.",
      description: "not ready · label coverage complete · 3/3 resolved labels",
    })
    expect(renderSessionQualityInlineSummary(actions[0]!)).toBe(
      "review replay readiness · not ready · label coverage complete · 3/3 resolved labels",
    )
    expect(renderSessionQualityPrompt(actions[0]!, "ses_readiness_blocked")).toContain(
      "review the remaining replay-readiness gates",
    )
    expect(sessionQualityDetailItems(actions[0]!)[1]).toMatchObject({
      title: "Replay readiness incomplete",
      footer: "Check review replay readiness gates before benchmarking.",
    })
  })

  test("uses workflow-aware replay-readiness wording for QA and debug flows", () => {
    const qaAction = sessionQualityActions({
      sessionID: "ses_qa_readiness",
      quality: {
        review: null,
        debug: null,
        qa: {
          workflow: "qa",
          overallStatus: "warn",
          readyForBenchmark: false,
          labeledItems: 2,
          resolvedLabeledItems: 2,
          unresolvedLabeledItems: 0,
          missingLabels: 0,
          totalItems: 2,
          nextAction: "Finish label coverage for the remaining exported artifacts.",
          gates: [
            {
              name: "benchmark-readiness",
              status: "warn",
              detail: "refresh QA replay evidence before benchmarking",
            },
          ],
        },
      },
    })[0]!

    const debugAction = sessionQualityActions({
      sessionID: "ses_debug_readiness",
      quality: {
        review: null,
        debug: {
          workflow: "debug",
          overallStatus: "warn",
          readyForBenchmark: false,
          labeledItems: 1,
          resolvedLabeledItems: 1,
          unresolvedLabeledItems: 0,
          missingLabels: 0,
          totalItems: 1,
          nextAction: "Finish label coverage for the remaining exported artifacts.",
          gates: [
            {
              name: "benchmark-readiness",
              status: "warn",
              detail: "refresh debug replay evidence before benchmarking",
            },
          ],
        },
        qa: null,
      },
    })[0]!

    expect(qaAction).toMatchObject({
      title: "Check QA Replay Readiness",
      footer: "Check QA replay readiness gates before benchmarking.",
    })
    expect(renderSessionQualityInlineSummary(qaAction)).toContain("qa replay readiness")
    expect(renderSessionQualityBrief(qaAction)).toContain(
      "- next action: Check QA replay readiness gates before benchmarking.",
    )

    expect(debugAction).toMatchObject({
      title: "Check Debug Replay Readiness",
      footer: "Check debug replay readiness gates before benchmarking.",
    })
    expect(renderSessionQualityInlineSummary(debugAction)).toContain("debug replay readiness")
  })

  test("derives detail items that explain status and expose the next-step action", () => {
    const action = sessionQualityActions({
      sessionID: "ses_detail",
      quality: {
        review: {
          workflow: "review",
          overallStatus: "warn",
          readyForBenchmark: false,
          labeledItems: 1,
          resolvedLabeledItems: 1,
          unresolvedLabeledItems: 0,
          missingLabels: 2,
          totalItems: 3,
          nextAction: "Finish label coverage for the remaining exported artifacts.",
          gates: [
            {
              name: "label-coverage",
              status: "warn",
              detail: "1 labeled, 2 missing, 0 unresolved",
            },
          ],
        },
        debug: null,
      },
    })[0]!

    const items = sessionQualityDetailItems(action)
    expect(items).toHaveLength(3)
    expect(items[0]).toMatchObject({
      category: "Next Step",
      title: "Record Review Outcome Labels",
      action,
    })
    expect(items[1]).toMatchObject({
      category: "Status",
      title: "Label coverage incomplete",
      description: "needs labels · 1/3 resolved labels · 2 missing",
      footer: "Record outcome labels for the remaining exported artifacts.",
    })
    expect(items[2]).toMatchObject({
      category: "Gate",
      title: "[warn] label-coverage",
      description: "1 labeled, 2 missing, 0 unresolved",
    })
  })

  test("uses a capture-evidence status summary without misleading zero label ratios", () => {
    const action = sessionQualityActions({
      sessionID: "ses_capture_detail",
      quality: {
        review: {
          workflow: "review",
          overallStatus: "fail",
          readyForBenchmark: false,
          labeledItems: 0,
          resolvedLabeledItems: 0,
          unresolvedLabeledItems: 0,
          missingLabels: 0,
          totalItems: 0,
          nextAction: "Capture review workflow activity before exporting replay again.",
          gates: [],
        },
        debug: null,
      },
    })[0]!

    const items = sessionQualityDetailItems(action)
    expect(items[1]).toMatchObject({
      category: "Status",
      title: "Replay evidence missing",
      description: "blocked · no replay evidence yet",
    })
  })

  test("prefers capture-evidence guidance when fail gates block readiness even with stale label counts", () => {
    const action = sessionQualityActions({
      sessionID: "ses_capture_gate_blocked",
      quality: {
        review: {
          workflow: "review",
          overallStatus: "fail",
          readyForBenchmark: false,
          labeledItems: 2,
          resolvedLabeledItems: 2,
          unresolvedLabeledItems: 0,
          missingLabels: 0,
          totalItems: 2,
          nextAction: "Capture review workflow activity before exporting replay again.",
          gates: [
            {
              name: "exportable-session-shape",
              status: "fail",
              detail: "no anchor items exported for workflow review",
            },
          ],
        },
        debug: null,
      },
    })[0]!

    expect(action).toMatchObject({
      kind: "capture_evidence",
      title: "Capture Review Evidence",
      description: "blocked · no anchor items exported for workflow review",
      footer: "Capture review workflow activity before exporting replay again.",
    })
    expect(renderSessionQualityBrief(action)).toContain(
      "- readiness blocker: no anchor items exported for workflow review",
    )
    expect(renderSessionQualityBrief(action)).not.toContain("- replay items: none yet")
  })

  test("finds the current action by workflow and kind", () => {
    const action = findSessionQualityAction({
      sessionID: "ses_lookup",
      workflow: "debug",
      kind: "benchmark",
      quality: {
        review: null,
        debug: {
          workflow: "debug",
          overallStatus: "pass",
          readyForBenchmark: true,
          labeledItems: 2,
          resolvedLabeledItems: 2,
          unresolvedLabeledItems: 0,
          missingLabels: 0,
          totalItems: 2,
          nextAction: null,
          gates: [],
        },
      },
    })

    expect(action).toMatchObject({
      workflow: "debug",
      kind: "benchmark",
      title: "Benchmark Debug Replay",
    })
  })

  test("renders a clipboard-friendly readiness brief", () => {
    const action = sessionQualityActions({
      sessionID: "ses_brief",
      quality: {
        review: {
          workflow: "review",
          overallStatus: "warn",
          readyForBenchmark: false,
          labeledItems: 1,
          resolvedLabeledItems: 1,
          unresolvedLabeledItems: 0,
          missingLabels: 2,
          totalItems: 3,
          nextAction: "Finish label coverage for the remaining exported artifacts.",
          gates: [
            {
              name: "label-coverage",
              status: "warn",
              detail: "1 labeled, 2 missing, 0 unresolved",
            },
          ],
        },
        debug: null,
      },
    })[0]!

    expect(renderSessionQualityBrief(action)).toBe(
      [
        "Quality readiness · review",
        "- readiness state: needs labels",
        "- benchmark ready: no",
        "- missing labels: 2",
        "- unresolved labels: 0",
        "- resolved labels: 1/3 resolved labels",
        "- next action: Record outcome labels for the remaining exported artifacts.",
        "- gates:",
        "  - [warn] label-coverage: 1 labeled, 2 missing, 0 unresolved",
      ].join("\n"),
    )
  })

  test("renders a capture-evidence brief without misleading zero label ratios", () => {
    const action = sessionQualityActions({
      sessionID: "ses_brief_capture",
      quality: {
        review: {
          workflow: "review",
          overallStatus: "fail",
          readyForBenchmark: false,
          labeledItems: 0,
          resolvedLabeledItems: 0,
          unresolvedLabeledItems: 0,
          missingLabels: 0,
          totalItems: 0,
          nextAction: "Capture review workflow activity before exporting replay again.",
          gates: [],
        },
        debug: null,
      },
    })[0]!

    expect(renderSessionQualityBrief(action)).toBe(
      [
        "Quality readiness · review",
        "- readiness state: blocked",
        "- benchmark ready: no",
        "- replay items: none yet",
        "- next action: Capture review workflow activity before exporting replay again.",
      ].join("\n"),
    )
  })

  test("renders an inline summary for compact surfaces like the sidebar", () => {
    const action = sessionQualityActions({
      sessionID: "ses_inline",
      quality: {
        review: {
          workflow: "review",
          overallStatus: "warn",
          readyForBenchmark: false,
          labeledItems: 1,
          resolvedLabeledItems: 1,
          unresolvedLabeledItems: 0,
          missingLabels: 2,
          totalItems: 3,
          nextAction: "Finish label coverage for the remaining exported artifacts.",
          gates: [],
        },
        debug: null,
      },
    })[0]!

    expect(renderSessionQualityInlineSummary(action)).toBe(
      "record outcome labels · needs labels · 1/3 resolved labels · 2 missing",
    )
  })

  test("renders a capture-evidence inline summary without redundant label counts", () => {
    const action = sessionQualityActions({
      sessionID: "ses_inline_capture",
      quality: {
        review: {
          workflow: "review",
          overallStatus: "fail",
          readyForBenchmark: false,
          labeledItems: 0,
          resolvedLabeledItems: 0,
          unresolvedLabeledItems: 0,
          missingLabels: 0,
          totalItems: 0,
          nextAction: "Capture review workflow activity before exporting replay again.",
          gates: [],
        },
        debug: null,
      },
    })[0]!

    expect(renderSessionQualityInlineSummary(action)).toBe("capture evidence · blocked · no replay evidence yet")
  })

  test("renders a concrete capture-evidence prompt scaffold", () => {
    const action = sessionQualityActions({
      sessionID: "ses_prompt_capture",
      quality: {
        review: {
          workflow: "review",
          overallStatus: "fail",
          readyForBenchmark: false,
          labeledItems: 0,
          resolvedLabeledItems: 0,
          unresolvedLabeledItems: 0,
          missingLabels: 0,
          totalItems: 0,
          nextAction: "Capture review workflow activity before exporting replay again.",
          gates: [
            {
              name: "exportable-session-shape",
              status: "fail",
              detail: "no anchor items exported for workflow review",
            },
          ],
        },
        debug: null,
      },
    })[0]!

    const prompt = renderSessionQualityPrompt(action, "ses_prompt_capture")
    expect(prompt).toContain("Quality readiness context for session ses_prompt_capture:")
    expect(prompt).toContain("- readiness blocker: no anchor items exported for workflow review")
    expect(prompt).not.toContain("resolved labels: 0/0")
    expect(prompt).toContain("Use the current session to produce review workflow evidence")
    expect(prompt).toContain("Focus on the failing or warning readiness gates first.")
    expect(prompt).toContain("Do not fabricate results")
  })

  test("renders a concrete label-coverage prompt scaffold", () => {
    const action = sessionQualityActions({
      sessionID: "ses_prompt_label",
      quality: {
        review: {
          workflow: "review",
          overallStatus: "warn",
          readyForBenchmark: false,
          labeledItems: 1,
          resolvedLabeledItems: 1,
          unresolvedLabeledItems: 0,
          missingLabels: 2,
          totalItems: 3,
          nextAction: "Finish label coverage for the remaining exported artifacts.",
          gates: [
            {
              name: "label-coverage",
              status: "warn",
              detail: "1 labeled, 2 missing, 0 unresolved",
            },
          ],
        },
        debug: null,
      },
    })[0]!

    const prompt = renderSessionQualityPrompt(action, "ses_prompt_label")
    expect(prompt).toContain("Use the current session's review replay evidence to record the missing outcome labels.")
    expect(prompt).toContain("2 missing label(s), 0 unresolved label(s)")
    expect(prompt).toContain("Identify which exported artifacts are still missing labels.")
    expect(prompt).toContain("do not invent final outcomes")
  })

  test("renders a concrete benchmark prompt scaffold", () => {
    const action = sessionQualityActions({
      sessionID: "ses_prompt_benchmark",
      quality: {
        review: null,
        debug: {
          workflow: "debug",
          overallStatus: "pass",
          readyForBenchmark: true,
          labeledItems: 2,
          resolvedLabeledItems: 2,
          unresolvedLabeledItems: 0,
          missingLabels: 0,
          totalItems: 2,
          nextAction: null,
          gates: [
            {
              name: "benchmark-readiness",
              status: "pass",
              detail: "2 resolved label(s) available for calibration or benchmark work",
            },
          ],
        },
      },
    })[0]!

    const prompt = renderSessionQualityPrompt(action, "ses_prompt_benchmark")
    expect(prompt).toContain("Prepare the next benchmark step for the current debug replay evidence.")
    expect(prompt).toContain("Identify any missing inputs that would still block benchmarking.")
    expect(prompt).toContain("Do not invent benchmark results or calibration outcomes.")
  })

  test("clamps malformed readiness counts before rendering summaries", () => {
    const action = sessionQualityActions({
      sessionID: "ses_malformed_counts",
      quality: {
        review: {
          workflow: "review",
          overallStatus: "warn",
          readyForBenchmark: false,
          labeledItems: 7,
          resolvedLabeledItems: 5,
          unresolvedLabeledItems: 4,
          missingLabels: 2,
          totalItems: 3,
          nextAction: "Finish label coverage for the remaining exported artifacts.",
          gates: [],
        },
        debug: null,
      },
    })[0]!

    expect(action.description).toBe("not ready · label coverage complete · 3/3 resolved labels")
    expect(renderSessionQualityInlineSummary(action)).toBe(
      "review replay readiness · not ready · label coverage complete · 3/3 resolved labels",
    )
    expect(renderSessionQualityBrief(action)).toContain("- resolved labels: 3/3 resolved labels")
    expect(renderSessionQualityBrief(action)).toContain("- missing labels: 0")
    expect(renderSessionQualityBrief(action)).toContain("- unresolved labels: 0")
  })

  test("keeps QA-only readiness discoverable from the session route command gating", async () => {
    const sessionRoute = await fs.readFile(SESSION_ROUTE_SRC, "utf8")

    expect(sessionRoute).toContain("const hasQualityReadiness = createMemo(() => qualityActions().length > 0)")
  })

  describe("renderSessionChecksSummary", () => {
    function envelope(overrides: Partial<VerificationEnvelope> = {}): VerificationEnvelope {
      return {
        schemaVersion: 1,
        workflow: "qa",
        scope: { kind: "file", paths: ["src/foo.ts"] },
        command: { runner: "typecheck", argv: [], cwd: "/tmp/work" },
        result: {
          name: "typecheck",
          type: "typecheck",
          passed: true,
          status: "passed",
          issues: [],
          duration: 0,
        },
        structuredFailures: [],
        artifactRefs: [],
        source: { tool: "refactor_apply", version: "4.x.x", runId: "ses_test" },
        ...overrides,
      }
    }

    test("returns empty string when no envelopes are present", () => {
      expect(renderSessionChecksSummary([])).toBe("")
    })

    test("renders three-tick line when typecheck/lint/tests all passed", () => {
      const envs = [
        envelope({ command: { runner: "typecheck", argv: [], cwd: "/tmp" } }),
        envelope({ command: { runner: "lint", argv: [], cwd: "/tmp" } }),
        envelope({ command: { runner: "test", argv: [], cwd: "/tmp" } }),
      ]
      expect(renderSessionChecksSummary(envs)).toBe("typecheck ✓ · lint ✓ · tests ✓")
    })

    test("only includes kinds that have at least one envelope", () => {
      const envs = [envelope({ command: { runner: "typecheck", argv: [], cwd: "/tmp" } })]
      expect(renderSessionChecksSummary(envs)).toBe("typecheck ✓")
    })

    test("marks failed kinds with ✗ and a count when more than one envelope failed", () => {
      const fail = (runner: "typecheck" | "lint" | "test"): VerificationEnvelope =>
        envelope({
          command: { runner, argv: [], cwd: "/tmp" },
          result: { name: runner, type: runner, passed: false, status: "failed", issues: [], duration: 0 },
        })
      const envs = [fail("typecheck"), fail("typecheck"), fail("lint")]
      expect(renderSessionChecksSummary(envs)).toBe("typecheck ✗ 2 · lint ✗")
    })

    test("marks skipped kinds with ⏭ and prefers skipped over passed but loses to failed", () => {
      const skipped = envelope({
        command: { runner: "test", argv: [], cwd: "/tmp" },
        result: { name: "tests", type: "test", passed: false, status: "skipped", issues: [], duration: 0 },
      })
      expect(renderSessionChecksSummary([skipped])).toBe("tests ⏭")

      const passed = envelope({
        command: { runner: "test", argv: [], cwd: "/tmp" },
        result: { name: "tests", type: "test", passed: true, status: "passed", issues: [], duration: 0 },
      })
      expect(renderSessionChecksSummary([passed, skipped])).toBe("tests ⏭")

      const failed = envelope({
        command: { runner: "test", argv: [], cwd: "/tmp" },
        result: { name: "tests", type: "test", passed: false, status: "failed", issues: [], duration: 0 },
      })
      expect(renderSessionChecksSummary([passed, skipped, failed])).toBe("tests ✗")
    })

    test("treats error and timeout statuses as failures", () => {
      const errored = envelope({
        command: { runner: "lint", argv: [], cwd: "/tmp" },
        result: { name: "lint", type: "lint", passed: false, status: "error", issues: [], duration: 0 },
      })
      const timedOut = envelope({
        command: { runner: "test", argv: [], cwd: "/tmp" },
        result: { name: "tests", type: "test", passed: false, status: "timeout", issues: [], duration: 0 },
      })
      expect(renderSessionChecksSummary([errored, timedOut])).toBe("lint ✗ · tests ✗")
    })

    test("ignores envelopes with unrecognised runners (forward-compat)", () => {
      const unknown = envelope({
        command: { runner: "format", argv: [], cwd: "/tmp" },
      })
      expect(renderSessionChecksSummary([unknown])).toBe("")
    })
  })

  describe("renderSessionReviewResultsSummary", () => {
    function reviewResult(overrides: Partial<ReviewResult> = {}): ReviewResult {
      return {
        schemaVersion: 1,
        reviewId: "1111111111111111",
        workflow: "review",
        decision: "approve",
        recommendedDecision: "approve",
        summary: "Review completed.",
        findingIds: [],
        verificationEnvelopeIds: ["2222222222222222"],
        counts: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0, total: 0 },
        blockingFindingIds: [],
        missingVerification: false,
        createdAt: "2026-04-29T00:00:00.000Z",
        source: { tool: "review_complete", version: "4.x.x", runId: "ses_test" },
        ...overrides,
      }
    }

    test("returns empty string when no review result exists", () => {
      expect(renderSessionReviewResultsSummary([])).toBe("")
    })

    test("renders latest review decision and verification state", () => {
      const line = renderSessionReviewResultsSummary([
        reviewResult({ decision: "needs_verification", missingVerification: true }),
        reviewResult({
          decision: "request_changes",
          recommendedDecision: "request_changes",
          counts: { CRITICAL: 0, HIGH: 1, MEDIUM: 1, LOW: 0, INFO: 0, total: 2 },
          blockingFindingIds: ["3333333333333333"],
        }),
      ])
      expect(line).toBe("Review request changes · 2 findings · 1 blocking · verified")
    })

    test("renders verification-needed state when review lacks a clean verification set", () => {
      const line = renderSessionReviewResultsSummary([
        reviewResult({ decision: "needs_verification", missingVerification: true }),
      ])
      expect(line).toBe("Review needs verification · 0 findings · 0 blocking · verification needed")
    })
  })

  describe("renderSessionDecisionHintsSummary", () => {
    function summary(overrides: Partial<DecisionHints.Summary> = {}): DecisionHints.Summary {
      return {
        source: "replay",
        readiness: "needs_validation",
        actionCount: 3,
        hintCount: 1,
        hints: [
          {
            id: "missing-review-completion",
            category: "missing_review_completion",
            confidence: 0.82,
            title: "Complete the structured review result",
            body: "Run review_complete before finalizing the review.",
            evidence: [],
          },
        ],
        ...overrides,
      }
    }

    test("returns empty string when no hints exist", () => {
      expect(renderSessionDecisionHintsSummary(undefined)).toBe("")
      expect(renderSessionDecisionHintsSummary(summary({ hintCount: 0, hints: [] }))).toBe("")
    })

    test("renders the first actionable hint for compact sidebar surfaces", () => {
      expect(renderSessionDecisionHintsSummary(summary())).toBe(
        "Needs validation · Complete the structured review result",
      )
    })

    test("marks blocked hints and preserves overflow count", () => {
      const line = renderSessionDecisionHintsSummary(
        summary({
          readiness: "blocked",
          hintCount: 2,
          hints: [
            {
              id: "failed-review-verification",
              category: "failed_validation",
              confidence: 0.9,
              title: "Resolve failed review verification before closing review",
              body: "Review verification failed.",
              evidence: [],
            },
            {
              id: "missing-review-completion",
              category: "missing_review_completion",
              confidence: 0.82,
              title: "Complete the structured review result",
              body: "Run review_complete.",
              evidence: [],
            },
          ],
        }),
      )
      expect(line).toBe("Blocked · Resolve failed review verification before closing review · +1 more")
    })
  })

  describe("renderSessionQualitySidebarLine", () => {
    test("renders the dominant severity buckets", () => {
      const action = sessionQualityActions({
        sessionID: "ses_with_findings",
        quality: {
          review: {
            workflow: "review",
            overallStatus: "warn",
            readyForBenchmark: false,
            labeledItems: 1,
            resolvedLabeledItems: 1,
            unresolvedLabeledItems: 0,
            missingLabels: 0,
            totalItems: 1,
            nextAction: null,
            gates: [{ name: "refresh-required", status: "warn", detail: "refresh after recent activity" }],
          },
          debug: null,
        },
      })[0]!
      const counts = { CRITICAL: 0, HIGH: 2, MEDIUM: 1, LOW: 0, INFO: 0, total: 3 }
      const line = renderSessionQualitySidebarLine(action, { counts })
      expect(line).toBe("Review · 2 HIGH · 1 MED")
      expect(line).not.toContain("refresh after recent activity")
    })

    test("renders all severity buckets in CRITICAL→INFO order", () => {
      const action = sessionQualityActions({
        sessionID: "ses_all_severities",
        quality: {
          review: {
            workflow: "review",
            overallStatus: "fail",
            readyForBenchmark: false,
            labeledItems: 0,
            resolvedLabeledItems: 0,
            unresolvedLabeledItems: 0,
            missingLabels: 0,
            totalItems: 0,
            nextAction: null,
            gates: [],
          },
          debug: null,
        },
      })[0]!
      const counts = { CRITICAL: 1, HIGH: 2, MEDIUM: 3, LOW: 4, INFO: 5, total: 15 }
      expect(renderSessionQualitySidebarLine(action, { counts })).toBe(
        "Review · 1 CRITICAL · 2 HIGH · 3 MED · 4 LOW · 5 INFO",
      )
    })

    test("uses 'QA' label not 'Qa' for the qa workflow", () => {
      const action = sessionQualityActions({
        sessionID: "ses_qa_findings",
        quality: {
          review: null,
          debug: null,
          qa: {
            workflow: "qa",
            overallStatus: "pass",
            readyForBenchmark: true,
            labeledItems: 1,
            resolvedLabeledItems: 1,
            unresolvedLabeledItems: 0,
            missingLabels: 0,
            totalItems: 1,
            nextAction: null,
            gates: [],
          },
        },
      })[0]!
      const counts = { CRITICAL: 0, HIGH: 1, MEDIUM: 0, LOW: 0, INFO: 0, total: 1 }
      expect(renderSessionQualitySidebarLine(action, { counts })).toBe("QA · 1 HIGH")
    })

    test("never includes internal training vocabulary (label coverage / replay readiness / capture evidence)", () => {
      const action = sessionQualityActions({
        sessionID: "ses_no_jargon",
        quality: {
          review: {
            workflow: "review",
            overallStatus: "warn",
            readyForBenchmark: false,
            labeledItems: 1,
            resolvedLabeledItems: 1,
            unresolvedLabeledItems: 0,
            missingLabels: 2,
            totalItems: 3,
            nextAction: "Finish label coverage for the remaining exported artifacts.",
            gates: [],
          },
          debug: null,
        },
      })[0]!
      const counts = { CRITICAL: 0, HIGH: 1, MEDIUM: 0, LOW: 0, INFO: 0, total: 1 }
      const line = renderSessionQualitySidebarLine(action, { counts })
      expect(line).not.toContain("label coverage")
      expect(line).not.toContain("replay readiness")
      expect(line).not.toContain("capture evidence")
      expect(line).not.toContain("benchmark")
      expect(line).not.toContain("issues")
      expect(line).not.toContain("warning")
    })
  })

  describe("hasSidebarSignal", () => {
    test("hides workflows that only carry replay-readiness gates (no findings)", () => {
      // Typical ax-code coding session: readiness gates fail/warn structurally
      // because no replay export ever happens. The sidebar should not surface
      // that — only file-anchored findings warrant a row.
      const action = sessionQualityActions({
        sessionID: "ses_readiness_only",
        quality: {
          review: {
            workflow: "review",
            overallStatus: "fail",
            readyForBenchmark: false,
            labeledItems: 0,
            resolvedLabeledItems: 0,
            unresolvedLabeledItems: 0,
            missingLabels: 0,
            totalItems: 0,
            nextAction: null,
            gates: [
              { name: "exportable-session-shape", status: "fail", detail: "no anchor items exported" },
              { name: "workflow-evidence-present", status: "fail", detail: "no workflow evidence exported" },
              { name: "label-coverage", status: "warn", detail: "no labels recorded" },
              { name: "benchmark-readiness", status: "warn", detail: "no resolved labels yet" },
            ],
          },
          debug: null,
        },
      })[0]!
      expect(hasSidebarSignal(action)).toBe(false)
      expect(hasSidebarSignal(action, 0)).toBe(false)
    })

    test("hides workflows where the user has only labeled artifacts (no findings)", () => {
      // Labels alone are an internal training-pipeline metric — without
      // file-anchored findings, the sidebar should still hide the row.
      const action = sessionQualityActions({
        sessionID: "ses_labels",
        quality: {
          review: {
            workflow: "review",
            overallStatus: "warn",
            readyForBenchmark: false,
            labeledItems: 1,
            resolvedLabeledItems: 0,
            unresolvedLabeledItems: 1,
            missingLabels: 2,
            totalItems: 3,
            nextAction: null,
            gates: [{ name: "label-coverage", status: "warn", detail: "1 labeled, 2 missing" }],
          },
          debug: null,
        },
      })[0]!
      expect(hasSidebarSignal(action)).toBe(false)
      expect(hasSidebarSignal(action, 0)).toBe(false)
    })

    test("shows workflow when severity-graded findings exist for it", () => {
      const action = sessionQualityActions({
        sessionID: "ses_findings",
        quality: {
          review: {
            workflow: "review",
            overallStatus: "warn",
            readyForBenchmark: false,
            labeledItems: 0,
            resolvedLabeledItems: 0,
            unresolvedLabeledItems: 0,
            missingLabels: 0,
            totalItems: 0,
            nextAction: null,
            gates: [],
          },
          debug: null,
        },
      })[0]!
      expect(hasSidebarSignal(action, 2)).toBe(true)
      expect(hasSidebarSignal(action, 0)).toBe(false)
    })
  })
})
