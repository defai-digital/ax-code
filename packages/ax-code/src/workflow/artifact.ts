import type { WorkflowArtifactRecord } from "./state"

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
