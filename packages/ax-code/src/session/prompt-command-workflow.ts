import type { Command } from "../command"
import { WorkflowTemplate } from "../workflow/template"
import { WorkflowScheduler } from "../workflow/scheduler"
import type { WorkflowRunDetail } from "../workflow/state"
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

export function workflowCommandPrompt(input: {
  commandName: string
  templateID: string
  run: Pick<WorkflowRunDetail, "id" | "status">
  template: string
}) {
  return [
    `Workflow command "${input.commandName}" started workflow run ${input.run.id}.`,
    `Template: ${input.templateID}`,
    `Status: ${input.run.status}`,
    input.template ? `Command notes:\n${input.template}` : undefined,
    "Tell the user the workflow run was created and include the run id.",
  ]
    .filter(Boolean)
    .join("\n\n")
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
