import { EOL } from "os"
import type { Argv } from "yargs"
import { bootstrap } from "../bootstrap"
import { cmd } from "./cmd"
import { WorkflowRun } from "../../workflow/run"
import { WorkflowScheduler } from "../../workflow/scheduler"
import { isWorkflowRuntimeEnabled } from "../../workflow/spec"
import { WorkflowTemplate } from "../../workflow/template"
import type { SessionID } from "../../session/schema"
import type { WorkflowRunDetail, WorkflowRunID } from "../../workflow/state"

type JsonOption = {
  json?: boolean
}

type StartOptions = JsonOption & {
  templateID: string
  parentSession?: string
  allowScale?: boolean
  allowWrite?: boolean
  enqueue?: boolean
  durableChildren?: boolean
}

type RunIDOptions = JsonOption & {
  runID: string
}

export function formatWorkflowTemplateList(templates: WorkflowTemplate.Info[]) {
  if (templates.length === 0) return `No workflow templates found.${EOL}`
  return templates
    .map((template) => {
      const tags = template.tags.length ? template.tags.join(", ") : "none"
      return `${template.id.padEnd(32)} ${template.name}${EOL}  ${template.description}${EOL}  tags: ${tags}`
    })
    .join(EOL + EOL)
    .concat(EOL)
}

export function formatWorkflowRunList(runs: WorkflowRun.Info[]) {
  if (runs.length === 0) return `No workflow runs found.${EOL}`
  const lines = runs.map((run) => {
    const template = run.sourceTemplateID ?? "-"
    const current = run.currentPhaseID ?? "-"
    return `${run.status.padEnd(10)} ${run.id.padEnd(28)} ${template.padEnd(32)} ${current}`
  })
  return (
    [`status     run                          template                         currentPhase`, ...lines].join(EOL) + EOL
  )
}

export function formatWorkflowRunDetail(detail: WorkflowRunDetail) {
  const phaseCounts = countBy(detail.phases.map((phase) => phase.status))
  const childCounts = countBy(detail.children.map((child) => child.status))
  const artifactCounts = countBy(detail.artifacts.map((artifact) => artifact.kind))
  const lines = [
    `Run ${detail.id}`,
    `status: ${detail.status}`,
    `name: ${detail.spec.name}`,
    `template: ${detail.sourceTemplateID ?? "-"}`,
    `currentPhase: ${detail.currentPhaseID ?? "-"}`,
    `budgetUsage: ${detail.budgetUsage.totalTokens} tokens, ${detail.budgetUsage.childAgents} child agents, ` +
      `${detail.budgetUsage.toolCalls} tool calls`,
    `phases: ${formatCounts(phaseCounts)}`,
    `children: ${formatCounts(childCounts)}`,
    `artifacts: ${formatCounts(artifactCounts)}`,
  ]

  if (detail.error) lines.push(`error: ${detail.error}`)
  if (detail.phases.length) {
    lines.push("")
    lines.push("Phases")
    for (const phase of detail.phases) {
      lines.push(`  ${phase.position + 1}. ${phase.name} [${phase.kind}] ${phase.status}`)
    }
  }
  return lines.join(EOL).concat(EOL)
}

const WorkflowTemplateListCommand = cmd({
  command: "templates",
  describe: "list workflow templates",
  builder: (yargs: Argv) => yargs.option("json", jsonOption()),
  async handler(args) {
    await withWorkflowRuntime(async () => {
      const templates = await WorkflowTemplate.list()
      if (args.json) {
        writeJson(templates)
        return
      }
      process.stdout.write(formatWorkflowTemplateList(templates))
    })
  },
})

const WorkflowRunListCommand = cmd({
  command: "list",
  describe: "list workflow runs",
  builder: (yargs: Argv) =>
    yargs
      .option("status", {
        type: "string",
        choices: ["queued", "running", "blocked", "paused", "failed", "completed", "cancelled"] as const,
        describe: "filter by workflow run status",
      })
      .option("limit", {
        type: "number",
        describe: "maximum runs to show",
      })
      .option("json", jsonOption()),
  async handler(args) {
    await withWorkflowRuntime(async () => {
      const runs = await WorkflowRun.list({
        status: args.status as WorkflowRun.Status | undefined,
        limit: args.limit,
      })
      if (args.json) {
        writeJson(runs)
        return
      }
      process.stdout.write(formatWorkflowRunList(runs))
    })
  },
})

const WorkflowRunStartCommand = cmd({
  command: "start <templateID>",
  describe: "create and start a workflow run from a template",
  builder: (yargs: Argv) =>
    yargs
      .positional("templateID", {
        type: "string",
        demandOption: true,
        describe: "workflow template id, for example builtin:issue-triage",
      })
      .option("parent-session", {
        type: "string",
        describe: "parent session id for spawned workflow child sessions",
      })
      .option("allow-scale", {
        type: "boolean",
        describe: "allow plans beyond conservative default scale limits",
      })
      .option("allow-write", {
        type: "boolean",
        describe: "allow workflow specs with write-capable phases",
      })
      .option("enqueue", {
        type: "boolean",
        default: true,
        describe: "enqueue child-agent work items",
      })
      .option("durable-children", {
        type: "boolean",
        default: true,
        describe: "persist child-agent execution state",
      })
      .option("json", jsonOption()),
  async handler(args) {
    await withWorkflowRuntime(async () => {
      const options = args as unknown as StartOptions
      const run = await WorkflowTemplate.createRun({
        templateID: options.templateID as WorkflowTemplate.ID,
        parentSessionID: options.parentSession as SessionID | undefined,
      })
      const detail = await WorkflowScheduler.start(run.id, {
        allowScaleBeyondDefaults: options.allowScale,
        allowWriteWorkflows: options.allowWrite,
        durableChildren: options.durableChildren,
        enqueueChildren: options.enqueue,
      })
      if (options.json) {
        writeJson(detail)
        return
      }
      process.stdout.write(formatWorkflowRunDetail(detail))
    })
  },
})

const WorkflowRunStatusCommand = cmd({
  command: "status <runID>",
  describe: "show workflow run status",
  builder: (yargs: Argv) =>
    yargs
      .positional("runID", {
        type: "string",
        demandOption: true,
        describe: "workflow run id",
      })
      .option("json", jsonOption()),
  async handler(args) {
    await withWorkflowRuntime(async () => {
      const options = args as unknown as RunIDOptions
      const detail = await WorkflowRun.getDetail(options.runID as WorkflowRunID)
      if (options.json) {
        writeJson(detail)
        return
      }
      process.stdout.write(formatWorkflowRunDetail(detail))
    })
  },
})

const WorkflowRunPauseCommand = controlCommand("pause", "pause queued workflow children", WorkflowScheduler.pause)
const WorkflowRunResumeCommand = controlCommand("resume", "resume paused workflow children", WorkflowScheduler.resume)
const WorkflowRunCancelCommand = controlCommand("cancel", "cancel a workflow run", WorkflowScheduler.cancel)
const WorkflowRunRetryCommand = controlCommand(
  "retry",
  "retry failed or cancelled workflow children",
  WorkflowScheduler.retry,
)

export const WorkflowCommand = cmd({
  command: "workflow",
  aliases: ["wflow"],
  describe: "manage dynamic workflow runs",
  builder: (yargs: Argv) =>
    yargs
      .command(WorkflowTemplateListCommand)
      .command(WorkflowRunListCommand)
      .command(WorkflowRunStartCommand)
      .command(WorkflowRunStatusCommand)
      .command(WorkflowRunPauseCommand)
      .command(WorkflowRunResumeCommand)
      .command(WorkflowRunCancelCommand)
      .command(WorkflowRunRetryCommand)
      .demandCommand(),
  async handler() {},
})

function controlCommand(
  name: "pause" | "resume" | "cancel" | "retry",
  describe: string,
  run: (runID: WorkflowRunID) => Promise<WorkflowRunDetail>,
) {
  return cmd({
    command: `${name} <runID>`,
    describe,
    builder: (yargs: Argv) =>
      yargs
        .positional("runID", {
          type: "string",
          demandOption: true,
          describe: "workflow run id",
        })
        .option("json", jsonOption()),
    async handler(args) {
      await withWorkflowRuntime(async () => {
        const options = args as unknown as RunIDOptions
        const detail = await run(options.runID as WorkflowRunID)
        if (options.json) {
          writeJson(detail)
          return
        }
        process.stdout.write(formatWorkflowRunDetail(detail))
      })
    },
  })
}

async function withWorkflowRuntime(fn: () => Promise<void> | void) {
  assertWorkflowRuntimeEnabled()
  await bootstrap(process.cwd(), async () => {
    await fn()
  })
}

function assertWorkflowRuntimeEnabled() {
  if (isWorkflowRuntimeEnabled()) return
  throw new Error("Workflow runtime is disabled. Set AX_CODE_WORKFLOW_RUNTIME=1 to enable workflow commands.")
}

function jsonOption() {
  return {
    type: "boolean" as const,
    describe: "output machine-readable JSON",
  }
}

function writeJson(value: unknown) {
  process.stdout.write(JSON.stringify(value, null, 2) + EOL)
}

function countBy(values: string[]) {
  const counts: Record<string, number> = {}
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1
  return counts
}

function formatCounts(counts: Record<string, number>) {
  const entries = Object.entries(counts)
  if (entries.length === 0) return "none"
  return entries
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, count]) => `${key}=${count}`)
    .join(", ")
}
