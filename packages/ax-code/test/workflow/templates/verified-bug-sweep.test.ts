import fs from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"
import { afterEach, describe, expect, test } from "vitest"
import { Instance } from "../../../src/project/instance"
import type { VerificationEnvelope } from "../../../src/quality/verification-envelope"
import {
  WorkflowRun,
  WorkflowTemplate,
  evaluateWorkflowEvalCaseRun,
  getWorkflowEvalCase,
  type WorkflowEvalSeededFinding,
} from "../../../src/workflow"
import { tmpdir } from "../../fixture/fixture"

const FIXTURE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../fixture/workflow/verified-bug-sweep-seeded",
)

afterEach(async () => {
  await Instance.disposeAll()
})

describe("verified bug sweep workflow template", () => {
  test("keeps seeded fixture repository evidence aligned with the eval case", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.cp(FIXTURE_ROOT, tmp.path, { recursive: true })

    const evalCase = getWorkflowEvalCase("verified-bug-sweep-seeded")
    for (const seed of evalCase.seeds) {
      const contents = await fs.readFile(path.join(tmp.path, seed.file), "utf8")
      const line = contents.split(/\r?\n/)[seed.line - 1]
      expect(line).toContain(`ax-workflow-seed: ${seed.id}`)
    }
  })

  test("evaluates confirmed, likely, rejected, and unverified seeded findings", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.cp(FIXTURE_ROOT, tmp.path, { recursive: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const evalCase = getWorkflowEvalCase("verified-bug-sweep-seeded")
        const detail = await createCompletedSeededRun(evalCase.seeds)
        const result = evaluateWorkflowEvalCaseRun({ run: detail, caseID: evalCase.id, now: Date.now() })

        expect(result.decision).toBe("promote")
        expect(result.reasons).toEqual([])
        expect(result.summary.decision).toBe("promote")
        expect(result.summary.comparison).toMatchObject({
          baselineLabel: "single-agent-seeded-review",
          confirmedFindingsDelta: 0,
          falsePositiveFindingsDelta: 0,
          totalTokensDelta: -4_000,
        })
        expect(result.metrics).toMatchObject({
          expectedConfirmedFindings: 1,
          expectedLikelyFindings: 1,
          expectedRejectedFindings: 1,
          expectedUnverifiedFindings: 1,
          observedSeedConfirmedFindings: 1,
          observedSeedLikelyFindings: 1,
          observedSeedRejectedFindings: 1,
          observedSeedUnverifiedFindings: 1,
          falsePositiveRejectionRate: 1,
          confirmedFindingRecall: 1,
          tokensPerConfirmedFinding: 8000,
          completionRate: 1,
          verificationPassRate: 1,
        })

        const finalReport = detail.artifacts.find((artifact) => artifact.specArtifactID === "workflow-final-report")
        expect(finalReport?.summary).toContain("Findings: 1 confirmed, 1 likely, 1 rejected, 1 unverified.")
        expect(finalReport?.summary).toContain("Confirmed findings:")
        expect(finalReport?.summary).toContain("Likely findings:")
        expect(finalReport?.summary).toContain("Rejected findings:")
        expect(finalReport?.summary).toContain(
          "rejectionReason=React textContent escapes markup instead of executing it.",
        )
        expect(finalReport?.summary).toContain("Unverified findings:")
        expect(finalReport?.payload).toMatchObject({
          findings: {
            confirmed: [expect.objectContaining({ summary: expect.stringContaining("Unauthenticated callers") })],
            likely: [expect.objectContaining({ summary: expect.stringContaining("Retry delay grows") })],
            rejected: [
              expect.objectContaining({
                reason: "React textContent escapes markup instead of executing it.",
                summary: expect.stringContaining("textContent"),
              }),
            ],
            unverified: [expect.objectContaining({ summary: expect.stringContaining("Cache scoping") })],
          },
        })
      },
    })
  })

  test("holds promotion when false-positive seed findings are dropped", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.cp(FIXTURE_ROOT, tmp.path, { recursive: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const evalCase = getWorkflowEvalCase("verified-bug-sweep-seeded")
        const detail = await createCompletedSeededRun(
          evalCase.seeds.filter((seed) => seed.expectedStatus !== "rejected"),
        )
        const result = evaluateWorkflowEvalCaseRun({ run: detail, caseID: evalCase.id, now: Date.now() })

        expect(result.decision).toBe("hold")
        expect(result.missingSeedIDs).toEqual(["text-content-xss-rejected"])
        expect(result.metrics.falsePositiveRejectionRate).toBe(0)
        expect(result.reasons).toContain("expected false-positive rejections are missing: text-content-xss-rejected")
      },
    })
  })
})

async function createCompletedSeededRun(seeds: WorkflowEvalSeededFinding[]) {
  const evalCase = getWorkflowEvalCase("verified-bug-sweep-seeded")
  const run = await WorkflowTemplate.createRun({ templateID: evalCase.templateID as WorkflowTemplate.ID })
  await WorkflowRun.setStatus({ id: run.id, status: "running" })

  const detail = await WorkflowRun.getDetail(run.id)
  const scan = detail.phases.find((phase) => phase.specPhaseID === "scan-files")
  const verification = detail.phases.find((phase) => phase.specPhaseID === "cross-check")
  const finalReport = detail.phases.find((phase) => phase.specPhaseID === "final-report")
  if (!scan || !verification || !finalReport) throw new Error("verified-bug-sweep fixture phases are missing")

  for (const seed of seeds) {
    await WorkflowRun.appendArtifact({
      runID: run.id,
      phaseID: scan.id,
      specArtifactID: "candidate-findings",
      kind: "finding",
      summary: `${seed.expectedStatus}: ${seed.summary}`,
      payload: {
        seedID: seed.id,
        status: seed.expectedStatus,
        file: seed.file,
        line: seed.line,
        ...(seed.expectedStatus === "rejected"
          ? { rejectionReason: "React textContent escapes markup instead of executing it." }
          : {}),
      },
    })
  }
  await WorkflowRun.appendArtifact({
    runID: run.id,
    phaseID: verification.id,
    specArtifactID: "verification-summary",
    kind: "verification",
    summary: "seeded verification evidence captured",
    payload: {
      caseID: evalCase.id,
      verificationEnvelopes: [{ envelope: verificationEnvelope(run.id, "passed", true) }],
    },
  })
  await WorkflowRun.appendArtifact({
    runID: run.id,
    phaseID: finalReport.id,
    specArtifactID: "bug-sweep-report",
    kind: "summary",
    exposeToMainContext: true,
    summary: "confirmed=1 likely=1 rejected=1 unverified=1",
    payload: { caseID: evalCase.id },
  })
  await WorkflowRun.appendBudgetUsage({
    runID: run.id,
    kind: "consume",
    usageDelta: {
      totalTokens: 8_000,
      inputTokens: 6_000,
      outputTokens: 2_000,
      toolCalls: 16,
      childAgents: 6,
    },
  })
  await WorkflowRun.setStatus({ id: run.id, status: "completed" })
  await WorkflowRun.ensureFinalReportArtifact(run.id)
  return WorkflowRun.getDetail(run.id)
}

function verificationEnvelope(runID: string, status: "passed" | "failed", passed: boolean): VerificationEnvelope {
  return {
    schemaVersion: 1,
    workflow: "review",
    scope: { kind: "workspace", description: "verified bug sweep seeded fixture" },
    command: { runner: "bun", argv: ["test"], cwd: "/tmp/verified-bug-sweep-seeded" },
    result: {
      name: "seeded-workflow-eval",
      type: "test",
      passed,
      status,
      issues: [],
      duration: 1,
      output: status === "passed" ? "ok" : "seeded eval failed",
    },
    structuredFailures:
      status === "passed" ? [] : [{ kind: "custom", message: "seeded eval failed", details: { runID } }],
    artifactRefs: [],
    source: { tool: "workflow-seeded-test", version: "1.0.0", runId: runID },
  }
}
