import type { Command } from "../command"
import { WorkflowTemplate } from "../workflow/template"
import { WorkflowScheduler } from "../workflow/scheduler"
import type { WorkflowArtifactRecord, WorkflowRunDetail } from "../workflow/state"
import { summarizeWorkflowRunDetail } from "../workflow/projection"
import { isWorkflowRuntimeEnabled } from "../workflow/spec"
import type { SessionID } from "./schema"

export class WorkflowCommandRuntimeDisabledError extends Error {
  constructor() {
    super("Workflow runtime is disabled. Set AX_CODE_WORKFLOW_RUNTIME=1 to enable workflow-backed commands.")
    this.name = "WorkflowCommandRuntimeDisabledError"
  }
}

export function parseWorkflowCommandArguments(input: string): Record<string, unknown> {
  const trimmed = input.trim()
  if (!trimmed) return {}

  const result: Record<string, unknown> = {}
  const parts = trimmed.match(/"[^"]*"|'[^']*'|[^\s"']+/g) ?? []
  let parsedAssignments = 0
  for (const part of parts) {
    const index = part.indexOf("=")
    if (index <= 0) continue
    const key = part.slice(0, index)
    const raw = stripQuotes(part.slice(index + 1))
    result[key] = parseWorkflowValue(raw)
    parsedAssignments++
  }
  if (parsedAssignments > 0) return result

  return { arguments: trimmed }
}

export async function createWorkflowCommandRun(input: {
  commandName: string
  command: Pick<Command.Info, "workflow">
  arguments: string
  sessionID: SessionID
}): Promise<WorkflowRunDetail> {
  if (!isWorkflowRuntimeEnabled()) throw new WorkflowCommandRuntimeDisabledError()
  if (!input.command.workflow) throw new Error(`Command is not workflow-backed: ${input.commandName}`)

  const run = await WorkflowTemplate.createRun({
    templateID: WorkflowTemplate.ID.parse(input.command.workflow),
    parentSessionID: input.sessionID,
    sourceTaskID: `command:${input.commandName}`,
    inputValues: parseWorkflowCommandArguments(input.arguments),
  })
  return WorkflowScheduler.start(run.id, {
    allowScaleBeyondDefaults: false,
    allowWriteWorkflows: false,
    durableChildren: true,
    enqueueChildren: true,
  })
}

const MAX_EXPOSED_ARTIFACTS = 10
const MAX_ARTIFACT_SUMMARY_LENGTH = 280

export function workflowCommandPrompt(input: {
  commandName: string
  templateID: string
  run: WorkflowRunDetail
  template: string
}) {
  const summary = summarizeWorkflowCommandRun(input.run)
  return [
    `Workflow command "${input.commandName}" started workflow run ${input.run.id}.`,
    `Template: ${input.templateID}`,
    summary,
    input.template ? `Command notes:\n${input.template}` : undefined,
    [
      "Tell the user the workflow run was created and include the run id.",
      "Report only the compact status above; do not invent results that are not listed.",
      "Full phase, child, and artifact detail is available through the workflow run routes for this run id.",
    ].join(" "),
  ]
    .filter(Boolean)
    .join("\n\n")
}

/**
 * Build a compact, ADR-025-compliant summary of a workflow command run for the parent session.
 * Surfaces status, progress counts, budget usage, and artifacts explicitly marked
 * `exposeToMainContext` — using each artifact's `summary` text only, never raw payloads,
 * and honoring redaction state.
 */
export function summarizeWorkflowCommandRun(run: WorkflowRunDetail): string {
  const projection = summarizeWorkflowRunDetail(run)
  const lines: string[] = [`Status: ${projection.status}`]

  if (projection.currentPhaseName) {
    const phaseStatus = projection.currentPhaseStatus ? ` (${projection.currentPhaseStatus})` : ""
    lines.push(`Current phase: ${projection.currentPhaseName}${phaseStatus}`)
  }

  const phases = projection.phaseCounts
  const phaseTotal = phases.queued + phases.running + phases.blocked + phases.paused + phases.failed + phases.completed + phases.cancelled
  const children = projection.childCounts
  const childTotal =
    children.queued +
    children.running +
    children.blockedPermission +
    children.blockedQuestion +
    children.paused +
    children.failed +
    children.completed +
    children.cancelled
  lines.push(`Progress: phases ${phases.completed}/${phaseTotal} completed, children ${children.completed}/${childTotal} completed`)

  lines.push(
    `Budget: ${projection.budgetUsage.totalTokens}/${projection.budgetLimit.maxTotalTokens} tokens, ${projection.elapsedMs}ms elapsed`,
  )

  if (projection.blockedReason) lines.push(`Blocked: ${projection.blockedReason}`)

  const exposed = run.artifacts.filter((artifact) => artifact.exposeToMainContext)
  if (exposed.length > 0) {
    lines.push(`Exposed artifacts (${exposed.length}):`)
    for (const artifact of exposed.slice(0, MAX_EXPOSED_ARTIFACTS)) {
      lines.push(`- [${artifact.kind}] ${exposedArtifactText(artifact)}`)
    }
    if (exposed.length > MAX_EXPOSED_ARTIFACTS) {
      lines.push(`- ...and ${exposed.length - MAX_EXPOSED_ARTIFACTS} more (see workflow run detail).`)
    }
  }

  return lines.join("\n")
}

function exposedArtifactText(artifact: WorkflowArtifactRecord): string {
  const redaction = artifact.redaction
  if (redaction?.status === "redacted") return clampSummary(redaction.summary ?? "[redacted]")
  if (redaction?.status === "pending") return clampSummary(artifact.summary ?? "[pending redaction]")
  return clampSummary(artifact.summary ?? "[no summary]")
}

function clampSummary(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim()
  if (!compact) return "[no summary]"
  return compact.length <= MAX_ARTIFACT_SUMMARY_LENGTH ? compact : `${compact.slice(0, MAX_ARTIFACT_SUMMARY_LENGTH - 3)}...`
}

function stripQuotes(input: string) {
  if ((input.startsWith('"') && input.endsWith('"')) || (input.startsWith("'") && input.endsWith("'"))) {
    return input.slice(1, -1)
  }
  return input
}

function parseWorkflowValue(input: string): unknown {
  try {
    return JSON.parse(input)
  } catch {
    return input
  }
}
