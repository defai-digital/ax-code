import { describe, expect, test } from "bun:test"
import { compactWorkflowArtifact, defaultWorkflowArtifactRedaction } from "../../src/workflow/artifact"
import type { WorkflowArtifactRecord } from "../../src/workflow/state"

describe("workflow artifacts", () => {
  test("marks hidden payloads as pending redaction in compact views", () => {
    const redaction = defaultWorkflowArtifactRedaction({
      payload: { raw: "child transcript" },
      exposeToMainContext: false,
    })

    expect(redaction).toMatchObject({
      status: "pending",
      summary: expect.stringContaining("payload omitted"),
    })
  })

  test("omits payloads while preserving redaction metadata", () => {
    const compact = compactWorkflowArtifact({
      id: "workflow_artifact_01",
      runID: "workflow_run_01",
      kind: "summary",
      retention: "session",
      exposeToMainContext: false,
      payload: { raw: "child transcript" },
      evidenceRefs: [],
      time: { created: 1, updated: 1 },
    } as unknown as WorkflowArtifactRecord)

    expect("payload" in compact).toBe(false)
    expect(compact.redaction).toMatchObject({ status: "pending" })
  })
})
