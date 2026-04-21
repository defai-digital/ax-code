import type { PromptInfo } from "../../component/prompt/history"
import type { SyncedSessionQualityReadiness } from "../../context/sync-session-risk"

export type SessionQualityWorkflow = "review" | "debug"

export type SessionQualityActionKind = "capture_evidence" | "finish_label_coverage" | "benchmark"

export type SessionQualityAction = {
  workflow: SessionQualityWorkflow
  kind: SessionQualityActionKind
  title: string
  description: string
  footer: string
  prompt: PromptInfo
}

function workflowLabel(workflow: SessionQualityWorkflow) {
  return workflow === "review" ? "Review" : "Debug"
}

function actionKind(summary: SyncedSessionQualityReadiness): SessionQualityActionKind {
  if (summary.readyForBenchmark) return "benchmark"
  if (summary.totalItems === 0) return "capture_evidence"
  return "finish_label_coverage"
}

function promptForAction(input: {
  sessionID: string
  workflow: SessionQualityWorkflow
  kind: SessionQualityActionKind
}): PromptInfo {
  if (input.kind === "capture_evidence") {
    return {
      input:
        `Use the current session to produce ${input.workflow} workflow evidence for session ${input.sessionID}. `
        + `Run the relevant ${input.workflow} workflow until the session records evidence-bearing output, `
        + "then summarize what was captured and whether replay readiness should be refreshed.",
      parts: [],
    }
  }

  if (input.kind === "benchmark") {
    return {
      input:
        `Run the local quality rollout benchmark flow for session ${input.sessionID} and workflow ${input.workflow}. `
        + "Reuse the current replay evidence, produce the benchmark summary, and report the next calibration step.",
      parts: [],
    }
  }

  return {
    input:
      `Use the current session's ${input.workflow} replay evidence for session ${input.sessionID} to identify the `
      + "exported artifacts that still need resolved outcome labels. Summarize the evidence for each artifact and "
      + "stop before inventing labels.",
    parts: [],
  }
}

export function sessionQualityActions(input: {
  sessionID: string
  quality:
    | {
        review?: SyncedSessionQualityReadiness | null
        debug?: SyncedSessionQualityReadiness | null
      }
    | null
    | undefined
}): SessionQualityAction[] {
  const items = [
    input.quality?.review ? ({ workflow: "review" as const, summary: input.quality.review }) : null,
    input.quality?.debug ? ({ workflow: "debug" as const, summary: input.quality.debug }) : null,
  ].filter((item): item is { workflow: SessionQualityWorkflow; summary: SyncedSessionQualityReadiness } => !!item)

  return items.map(({ workflow, summary }) => {
    const kind = actionKind(summary)
    const title = kind === "benchmark"
      ? `Benchmark ${workflowLabel(workflow)} Replay`
      : kind === "capture_evidence"
        ? `Capture ${workflowLabel(workflow)} Evidence`
        : `Finish ${workflowLabel(workflow)} Label Coverage`

    const description =
      `${summary.overallStatus} · ${summary.readyForBenchmark ? "benchmark ready" : "benchmark not ready"}`
      + ` · ${summary.resolvedLabeledItems}/${summary.totalItems} resolved labels`

    const footer = summary.nextAction
      ?? (kind === "benchmark" ? "Ready to benchmark the current replay export." : "No additional next action recorded.")

    return {
      workflow,
      kind,
      title,
      description,
      footer,
      prompt: promptForAction({
        sessionID: input.sessionID,
        workflow,
        kind,
      }),
    }
  })
}
