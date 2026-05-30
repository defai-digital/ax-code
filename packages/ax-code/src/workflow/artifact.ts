import type { WorkflowArtifactRecord } from "./state"
import type { WorkflowSpecV1 } from "./spec"

export type WorkflowArtifactRedaction = NonNullable<WorkflowArtifactRecord["redaction"]>

export function defaultWorkflowArtifactRedaction(input: {
  payload?: unknown
  exposeToMainContext?: boolean
}): WorkflowArtifactRedaction {
  if (input.payload === undefined || input.exposeToMainContext) return { status: "none" }
  return {
    status: "pending",
    summary: "payload omitted from compact workflow views; request artifact payload explicitly for drill-down.",
  }
}

export function compactWorkflowArtifact<T extends WorkflowArtifactRecord>(artifact: T): Omit<T, "payload"> {
  const { payload: _payload, ...compact } = artifact
  return {
    ...compact,
    redaction: artifact.redaction ?? defaultWorkflowArtifactRedaction(artifact),
  }
}

export function workflowArtifactRedactionFromSpec(
  spec: WorkflowSpecV1,
  specArtifactID: string | undefined,
): WorkflowArtifactRedaction | undefined {
  if (!specArtifactID) return undefined
  return spec.artifacts.find((artifact) => artifact.id === specArtifactID)?.redaction
}
