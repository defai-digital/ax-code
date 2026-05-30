import { EOL } from "os"
import type { Argv } from "yargs"
import { bootstrap } from "../bootstrap"
import { cmd } from "./cmd"
import { compactWorkflowArtifact } from "../../workflow/artifact"
import { WorkflowRun } from "../../workflow/run"
import { WorkflowRoutineTrigger } from "../../workflow/routine"
import { WorkflowScheduler } from "../../workflow/scheduler"
import { isWorkflowRuntimeEnabled } from "../../workflow/spec"
import type { WorkflowModelPolicyOverride } from "../../workflow/spec"
import { WorkflowTemplate } from "../../workflow/template"
import type { SessionID } from "../../session/schema"
import type { WorkflowArtifactRecord, WorkflowPhaseID, WorkflowRunDetail, WorkflowRunID } from "../../workflow/state"
import { summarizeWorkflowRunDetail, type WorkflowRunProjection } from "../../workflow/projection"
import {
  evaluateWorkflowEvalCaseRun,
  listWorkflowEvalCases,
  type WorkflowEvalCase,
  type WorkflowEvalCaseID,
  type WorkflowEvalCaseRunSummary,
} from "../../workflow/eval-corpus"

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
  effort?: WorkflowModelPolicyOverride["effort"]
  defaultModel?: string
  cheapModel?: string
  strongModel?: string
  plannerModel?: string
  workerModel?: string
  verifierModel?: string
  synthesizerModel?: string
  allowedProvider?: unknown
  input?: unknown
}

type RoutineRunOptions = Omit<StartOptions, "templateID"> & {
  route: string
}

type RoutineCreateOptions = JsonOption & {
  templateID: string
  scope: "user" | "project"
  mode?: "api" | "scheduled" | "webhook"
  route?: string
  schedule?: string
  timezone?: string
  webhookEvent?: string
  enabled?: boolean
  trusted?: boolean
}

type RunIDOptions = JsonOption & {
  runID: string
}

type RetryOptions = RunIDOptions & {
  phaseId?: string
}

type EvalCaseOptions = RunIDOptions & {
  caseId?: string
}

type ArtifactOptions = RunIDOptions & {
  phaseId?: string
  childId?: string
  kind?: WorkflowRun.ArtifactKind
  includePayload?: boolean
}

type SaveTemplateOptions = RunIDOptions & {
  scope: "user" | "project"
}

export function formatWorkflowTemplateList(templates: WorkflowTemplate.Info[]) {
  if (templates.length === 0) return `No workflow templates found.${EOL}`
  return templates
    .map((template) => {
      const tags = template.tags.length ? template.tags.join(", ") : "none"
      return `${template.id.padEnd(32)} ${template.name}${EOL}  ${template.description}${EOL}  trust: ${template.trust}; revision: ${template.revision}; hash: ${template.specHash}${EOL}  tags: ${tags}`
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

export function formatWorkflowRunDashboard(runs: WorkflowRunProjection[]) {
  if (runs.length === 0) return `No workflow runs found.${EOL}`
  const lines = runs.map((run) => {
    const phase = run.currentPhaseName ?? "-"
    const activeChildren = run.childCounts.running + run.childCounts.blockedPermission + run.childCounts.blockedQuestion
    const queuedChildren = run.childCounts.queued
    const childSummary = `${activeChildren}/${queuedChildren}/${run.budgetUsage.childAgents}`
    const budgetSummary = `${run.budgetUsage.totalTokens}/${run.budgetLimit.maxTotalTokens}`
    const evidenceSummary = `${run.evidenceRefCount}/${run.verificationEnvelopeCount}/${totalArtifacts(run)}`
    const evalSummary = `${run.evaluation.decision}/${formatUsd(run.evaluation.metrics.costPerVerifiedCompletionUsd)}`
    const blocker = run.blockedReason ? truncate(run.blockedReason, 36) : "-"
    const models = truncate(formatNamedModels(run.models) || "-", 32)
    return [
      run.status.padEnd(10),
      run.runID.padEnd(28),
      truncate(run.name, 24).padEnd(24),
      truncate(phase, 22).padEnd(22),
      run.effort.padEnd(12),
      models.padEnd(32),
      childSummary.padEnd(13),
      budgetSummary.padEnd(18),
      evidenceSummary.padEnd(17),
      evalSummary.padEnd(17),
      blocker,
    ].join(" ")
  })
  return (
    [
      "status     run                          name                     phase                  effort       models                           active/queued/total tokens             evidence/ver/art  eval/cost        blocker",
      ...lines,
    ].join(EOL) + EOL
  )
}

export function formatWorkflowRoutineList(routines: WorkflowRoutineTrigger.Info[]) {
  if (routines.length === 0) return `No workflow routines found.${EOL}`
  const lines = routines.map((routine) => {
    const status = routine.enabled && routine.trust === "trusted" ? "enabled" : "disabled"
    const schedule =
      routine.mode === "scheduled" && routine.schedule
        ? truncate([routine.schedule, routine.timezone].filter(Boolean).join("@"), 28)
        : routine.mode === "webhook" && routine.webhookEvent
          ? truncate(routine.webhookEvent, 28)
        : "-"
    return [
      status.padEnd(8),
      routine.route.padEnd(28),
      routine.templateID.padEnd(32),
      routine.mode.padEnd(9),
      schedule.padEnd(28),
      routine.securityGate,
    ].join(" ")
  })
  return (
    ["status   route                        template                         mode      schedule                     gate", ...lines].join(EOL) + EOL
  )
}

export function formatWorkflowEvalCaseList(cases: WorkflowEvalCase[]) {
  if (cases.length === 0) return `No workflow eval cases found.${EOL}`
  return cases
    .map((item) => {
      const counts = countBy(item.seeds.map((seed) => seed.expectedStatus))
      return [
        `${item.id.padEnd(30)} ${item.templateID}`,
        `  ${item.description}`,
        `  fixture: ${item.fixtureID}; seeds: ${formatCounts(counts)}; baseline: ${item.baseline.label}`,
      ].join(EOL)
    })
    .join(EOL + EOL)
    .concat(EOL)
}

export function formatWorkflowEvalCaseRunSummary(result: WorkflowEvalCaseRunSummary) {
  const metrics = result.metrics
  const lines = [
    `Eval case ${result.caseID}`,
    `decision: ${result.decision}`,
    `template: ${result.templateID}`,
    `fixture: ${result.fixtureID}`,
    `summaryDecision: ${result.summary.decision}`,
    `verification: ${result.summary.verificationSatisfied ? "satisfied" : "missing"}`,
    [
      "seedFindings:",
      `confirmed ${metrics.observedSeedConfirmedFindings}/${metrics.expectedConfirmedFindings},`,
      `likely ${metrics.observedSeedLikelyFindings}/${metrics.expectedLikelyFindings},`,
      `rejected ${metrics.observedSeedRejectedFindings}/${metrics.expectedRejectedFindings},`,
      `unverified ${metrics.observedSeedUnverifiedFindings}/${metrics.expectedUnverifiedFindings}`,
    ].join(" "),
    `falsePositiveRejectionRate: ${formatPercent(metrics.falsePositiveRejectionRate)}`,
    `confirmedFindingRecall: ${formatPercent(metrics.confirmedFindingRecall)}`,
    `costPerConfirmedFindingUsd: ${formatUsd(metrics.costPerConfirmedFindingUsd)}`,
    `interventions: ${metrics.interventionCount}`,
  ]
  if (result.missingSeedIDs.length) lines.push(`missingSeeds: ${result.missingSeedIDs.join(", ")}`)
  if (result.mismatchedSeedIDs.length) lines.push(`mismatchedSeeds: ${result.mismatchedSeedIDs.join(", ")}`)
  if (result.reasons.length) {
    lines.push("")
    lines.push("Reasons")
    for (const reason of result.reasons) lines.push(`  - ${reason}`)
  }
  return lines.join(EOL).concat(EOL)
}

export function formatWorkflowArtifactList(artifacts: WorkflowArtifactRecord[]) {
  if (artifacts.length === 0) return `No workflow artifacts found.${EOL}`
  const lines: string[] = []
  for (const artifact of artifacts) {
    const phase = artifact.phaseID ? ` phase=${artifact.phaseID}` : ""
    const child = artifact.childID ? ` child=${artifact.childID}` : ""
    const spec = artifact.specArtifactID ? ` spec=${artifact.specArtifactID}` : ""
    const exposed = artifact.exposeToMainContext ? " exposed" : ""
    const redaction = artifact.redaction?.status ? ` redaction=${artifact.redaction.status}` : ""
    lines.push(
      `${artifact.id} ${artifact.kind} retention=${artifact.retention}${phase}${child}${spec}${exposed}${redaction}`,
    )
    if (artifact.summary) lines.push(`  summary: ${artifact.summary}`)
    if (artifact.evidenceRefs.length) {
      lines.push(`  evidence: ${artifact.evidenceRefs.map((ref) => `${ref.kind}:${ref.id}`).join(", ")}`)
    }
    if (artifact.payload !== undefined) lines.push(`  payload: ${formatArtifactPayload(artifact.payload)}`)
  }
  return lines.join(EOL).concat(EOL)
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
    `modelPolicy: ${formatRunModelPolicy(detail)}`,
    `executionPolicy: ${formatRunExecutionPolicy(detail)}`,
    `budgetUsage: ${detail.budgetUsage.totalTokens} tokens, ${detail.budgetUsage.childAgents} child agents, ` +
      `${detail.budgetUsage.toolCalls} tool calls`,
    `phases: ${formatCounts(phaseCounts)}`,
    `children: ${formatCounts(childCounts)}`,
    `artifacts: ${formatCounts(artifactCounts)}`,
  ]

  if (detail.error) lines.push(`error: ${detail.error}`)
  if (detail.verificationEnvelopeIDs.length) {
    lines.push(`verification: ${detail.verificationEnvelopeIDs.join(", ")}`)
  }
  if (detail.phases.length) {
    lines.push("")
    lines.push("Phases")
    for (const phase of detail.phases) {
      lines.push(`  ${phase.position + 1}. ${phase.name} [${phase.kind}] ${phase.status}`)
    }
  }
  if (detail.children.length) {
    lines.push("")
    lines.push("Children")
    for (const child of detail.children) {
      const agent = child.agent ? ` agent=${child.agent}` : ""
      const model = typeof child.model === "string" ? ` model=${child.model}` : ""
      const task = child.taskQueueID ? ` task=${child.taskQueueID}` : ""
      lines.push(`  ${child.id} phase=${child.phaseID} status=${child.status}${agent}${model}${task}`)
      if (child.outputSummary) lines.push(`    ${child.outputSummary}`)
      if (child.error) lines.push(`    error: ${child.error}`)
    }
  }
  if (detail.artifacts.length) {
    lines.push("")
    lines.push("Artifacts")
    for (const artifact of detail.artifacts) {
      const phase = artifact.phaseID ? ` phase=${artifact.phaseID}` : ""
      const child = artifact.childID ? ` child=${artifact.childID}` : ""
      const exposed = artifact.exposeToMainContext ? " exposed" : ""
      lines.push(`  ${artifact.id} ${artifact.kind}${phase}${child}${exposed}`)
      if (artifact.summary) lines.push(`    ${artifact.summary}`)
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

const WorkflowRunDashboardCommand = cmd({
  command: "dashboard",
  describe: "show compact workflow run dashboard",
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
      const summaries = await Promise.all(
        runs.map(async (run) => summarizeWorkflowRunDetail(await WorkflowRun.getDetail(run.id))),
      )
      if (args.json) {
        writeJson(summaries)
        return
      }
      process.stdout.write(formatWorkflowRunDashboard(summaries))
    })
  },
})

const WorkflowRoutineListCommand = cmd({
  command: "routines",
  describe: "list local workflow routines",
  builder: (yargs: Argv) => yargs.option("json", jsonOption()),
  async handler(args) {
    await withWorkflowRuntime(async () => {
      const routines = await WorkflowRoutineTrigger.list()
      if (args.json) {
        writeJson(routines)
        return
      }
      process.stdout.write(formatWorkflowRoutineList(routines))
    })
  },
})

const WorkflowEvalCaseListCommand = cmd({
  command: "eval-cases",
  describe: "list workflow evaluation cases",
  builder: (yargs: Argv) => yargs.option("json", jsonOption()),
  async handler(args) {
    await withWorkflowRuntime(async () => {
      const cases = listWorkflowEvalCases()
      if (args.json) {
        writeJson(cases)
        return
      }
      process.stdout.write(formatWorkflowEvalCaseList(cases))
    })
  },
})

const WorkflowEvalCaseRunCommand = cmd({
  command: "eval-case <runID>",
  describe: "evaluate a workflow run against a seeded local case",
  builder: (yargs: Argv) =>
    yargs
      .positional("runID", {
        type: "string",
        demandOption: true,
        describe: "workflow run id",
      })
      .option("case-id", {
        type: "string",
        default: "verified-bug-sweep-seeded",
        describe: "workflow eval case id",
      })
      .option("json", jsonOption()),
  async handler(args) {
    await withWorkflowRuntime(async () => {
      const options = args as unknown as EvalCaseOptions
      const detail = await WorkflowRun.getDetail(options.runID as WorkflowRunID)
      const result = evaluateWorkflowEvalCaseRun({
        run: detail,
        caseID: (options.caseId ?? "verified-bug-sweep-seeded") as WorkflowEvalCaseID,
      })
      if (options.json) {
        writeJson(result)
        return
      }
      process.stdout.write(formatWorkflowEvalCaseRunSummary(result))
    })
  },
})

const WorkflowRoutineCreateCommand = cmd({
  command: "create-routine <templateID>",
  describe: "create a local workflow routine trigger from a template",
  builder: (yargs: Argv) =>
    yargs
      .positional("templateID", {
        type: "string",
        demandOption: true,
        describe: "source workflow template id, for example builtin:noop-dry-run",
      })
      .option("scope", {
        type: "string",
        choices: ["user", "project"] as const,
        default: "project",
        describe: "where to save the routine template copy",
      })
      .option("route", {
        type: "string",
        describe: "local routine route, for example workflow/daily-review",
      })
      .option("mode", {
        type: "string",
        choices: ["api", "scheduled", "webhook"] as const,
        default: "api" as const,
        describe: "routine trigger mode",
      })
      .option("schedule", {
        type: "string",
        describe: "cron expression for scheduled workflow routines",
      })
      .option("timezone", {
        type: "string",
        describe: "IANA timezone for scheduled workflow routines",
      })
      .option("webhook-event", {
        type: "string",
        describe: "webhook event name for disabled future webhook routines",
      })
      .option("enabled", {
        type: "boolean",
        default: false,
        describe: "enable the routine trigger immediately",
      })
      .option("trusted", {
        type: "boolean",
        default: false,
        describe: "save the routine template as trusted instead of candidate",
      })
      .option("json", jsonOption()),
  async handler(args) {
    await withWorkflowRuntime(async () => {
      const options = args as unknown as RoutineCreateOptions
      const routine = await WorkflowRoutineTrigger.create({
        templateID: options.templateID as WorkflowTemplate.ID,
        scope: options.scope,
        mode: options.mode,
        route: options.route,
        schedule: options.schedule,
        timezone: options.timezone,
        webhookEvent: options.webhookEvent,
        enabled: options.enabled,
        trust: options.trusted ? "trusted" : "candidate",
      })
      if (options.json) {
        writeJson(routine)
        return
      }
      process.stdout.write(formatWorkflowRoutineList([routine]))
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
      .option("effort", {
        type: "string",
        choices: ["normal", "deep", "workflow", "max-workflow"] as const,
        describe: "override workflow model effort preset",
      })
      .option("default-model", {
        type: "string",
        describe: "override default workflow model",
      })
      .option("cheap-model", {
        type: "string",
        describe: "override cheap exploration model",
      })
      .option("strong-model", {
        type: "string",
        describe: "override strong synthesis model",
      })
      .option("planner-model", {
        type: "string",
        describe: "override planner model",
      })
      .option("worker-model", {
        type: "string",
        describe: "override worker model",
      })
      .option("verifier-model", {
        type: "string",
        describe: "override verifier model",
      })
      .option("synthesizer-model", {
        type: "string",
        describe: "override synthesizer model",
      })
      .option("allowed-provider", {
        type: "array",
        alias: "allowed-providers",
        describe: "restrict workflow model routing to provider IDs; repeat or comma-separate for multiple providers",
      })
      .option("input", {
        type: "array",
        describe: "workflow input assignment as key=JSON; repeat for multiple inputs",
      })
      .option("json", jsonOption()),
  async handler(args) {
    await withWorkflowRuntime(async () => {
      const options = args as unknown as StartOptions
      const run = await WorkflowTemplate.createRun({
        templateID: options.templateID as WorkflowTemplate.ID,
        parentSessionID: options.parentSession as SessionID | undefined,
        modelPolicy: modelPolicyFromStartOptions(options),
        inputValues: parseWorkflowInputArguments(options.input),
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

const WorkflowRoutineRunCommand = cmd({
  command: "run-routine <route>",
  describe: "run a trusted local workflow routine",
  builder: (yargs: Argv) =>
    yargs
      .positional("route", {
        type: "string",
        demandOption: true,
        describe: "workflow routine route, for example workflow/issue-triage",
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
      .option("effort", {
        type: "string",
        choices: ["normal", "deep", "workflow", "max-workflow"] as const,
        describe: "override workflow model effort preset",
      })
      .option("default-model", {
        type: "string",
        describe: "override default workflow model",
      })
      .option("cheap-model", {
        type: "string",
        describe: "override cheap exploration model",
      })
      .option("strong-model", {
        type: "string",
        describe: "override strong synthesis model",
      })
      .option("planner-model", {
        type: "string",
        describe: "override planner model",
      })
      .option("worker-model", {
        type: "string",
        describe: "override worker model",
      })
      .option("verifier-model", {
        type: "string",
        describe: "override verifier model",
      })
      .option("synthesizer-model", {
        type: "string",
        describe: "override synthesizer model",
      })
      .option("allowed-provider", {
        type: "array",
        alias: "allowed-providers",
        describe: "restrict workflow model routing to provider IDs; repeat or comma-separate for multiple providers",
      })
      .option("input", {
        type: "array",
        describe: "workflow input assignment as key=JSON; repeat for multiple inputs",
      })
      .option("json", jsonOption()),
  async handler(args) {
    await withWorkflowRuntime(async () => {
      const options = args as unknown as RoutineRunOptions
      const result = await WorkflowRoutineTrigger.run({
        route: options.route,
        parentSessionID: options.parentSession as SessionID | undefined,
        modelPolicy: modelPolicyFromStartOptions(options),
        inputValues: parseWorkflowInputArguments(options.input),
        startOptions: {
          allowScaleBeyondDefaults: options.allowScale,
          allowWriteWorkflows: options.allowWrite,
          durableChildren: options.durableChildren,
          enqueueChildren: options.enqueue,
        },
      })
      if (options.json) {
        writeJson(result)
        return
      }
      process.stdout.write(formatWorkflowRunDetail(result.run))
    })
  },
})

function modelPolicyFromStartOptions(
  options: Pick<
    StartOptions,
    | "effort"
    | "defaultModel"
    | "cheapModel"
    | "strongModel"
    | "plannerModel"
    | "workerModel"
    | "verifierModel"
    | "synthesizerModel"
    | "allowedProvider"
  >,
): WorkflowModelPolicyOverride | undefined {
  const modelPolicy: WorkflowModelPolicyOverride = {}
  if (options.effort) modelPolicy.effort = options.effort
  if (options.defaultModel) modelPolicy.defaultModel = options.defaultModel
  if (options.cheapModel) modelPolicy.cheapModel = options.cheapModel
  if (options.strongModel) modelPolicy.strongModel = options.strongModel
  if (options.plannerModel) modelPolicy.plannerModel = options.plannerModel
  if (options.workerModel) modelPolicy.workerModel = options.workerModel
  if (options.verifierModel) modelPolicy.verifierModel = options.verifierModel
  if (options.synthesizerModel) modelPolicy.synthesizerModel = options.synthesizerModel
  const allowedProviders = parseAllowedProvidersOption(options.allowedProvider)
  if (allowedProviders) modelPolicy.allowedProviders = allowedProviders
  return Object.keys(modelPolicy).length > 0 ? modelPolicy : undefined
}

function parseAllowedProvidersOption(input: unknown): string[] | undefined {
  const values = input === undefined ? [] : Array.isArray(input) ? input : [input]
  const providers = values.flatMap((value) => {
    if (typeof value !== "string") throw new Error("Workflow allowed providers must be provider ID strings.")
    return value
      .split(",")
      .map((provider) => provider.trim())
      .filter(Boolean)
  })
  const unique = [...new Set(providers)]
  return unique.length > 0 ? unique : undefined
}

export function parseWorkflowInputArguments(input: unknown): Record<string, unknown> | undefined {
  const values = input === undefined ? [] : Array.isArray(input) ? input : [input]
  if (values.length === 0) return undefined
  const result: Record<string, unknown> = {}
  for (const value of values) {
    if (typeof value !== "string") throw new Error("Workflow inputs must be passed as key=value strings.")
    const separator = value.indexOf("=")
    if (separator <= 0) throw new Error(`Workflow input must use key=value syntax: ${value}`)
    const key = value.slice(0, separator).trim()
    if (!key) throw new Error(`Workflow input key is empty: ${value}`)
    result[key] = parseWorkflowInputValue(value.slice(separator + 1))
  }
  return result
}

function parseWorkflowInputValue(value: string): unknown {
  if (value === "") return ""
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

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

const WorkflowRunArtifactsCommand = cmd({
  command: "artifacts <runID>",
  describe: "list workflow artifacts with optional payload drill-down",
  builder: (yargs: Argv) =>
    yargs
      .positional("runID", {
        type: "string",
        demandOption: true,
        describe: "workflow run id",
      })
      .option("phase-id", {
        type: "string",
        describe: "filter artifacts by workflow phase id",
      })
      .option("child-id", {
        type: "string",
        describe: "filter artifacts by workflow child id",
      })
      .option("kind", {
        type: "string",
        choices: ["summary", "finding", "patch", "verification", "metric", "log"] as const,
        describe: "filter artifacts by kind",
      })
      .option("include-payload", {
        type: "boolean",
        default: false,
        describe: "include raw artifact payloads in the output",
      })
      .option("json", jsonOption()),
  async handler(args) {
    await withWorkflowRuntime(async () => {
      const options = args as unknown as ArtifactOptions
      const detail = await WorkflowRun.getDetail(options.runID as WorkflowRunID)
      const artifacts = detail.artifacts
        .filter((artifact) => (options.phaseId ? artifact.phaseID === options.phaseId : true))
        .filter((artifact) => (options.childId ? artifact.childID === options.childId : true))
        .filter((artifact) => (options.kind ? artifact.kind === options.kind : true))
        .map((artifact) => (options.includePayload ? artifact : compactWorkflowArtifact(artifact)))

      if (options.json) {
        writeJson(artifacts)
        return
      }
      process.stdout.write(formatWorkflowArtifactList(artifacts))
    })
  },
})

const WorkflowRunSaveTemplateCommand = cmd({
  command: "save-template <runID>",
  describe: "save a workflow run spec snapshot as a candidate template",
  builder: (yargs: Argv) =>
    yargs
      .positional("runID", {
        type: "string",
        demandOption: true,
        describe: "workflow run id",
      })
      .option("scope", {
        type: "string",
        choices: ["project", "user"] as const,
        default: "project" as const,
        describe: "template catalog to save into",
      })
      .option("json", jsonOption()),
  async handler(args) {
    await withWorkflowRuntime(async () => {
      const options = args as unknown as SaveTemplateOptions
      const template = await WorkflowTemplate.saveFromRun({
        runID: options.runID as WorkflowRunID,
        scope: options.scope,
      })
      if (options.json) {
        writeJson(template)
        return
      }
      process.stdout.write(formatWorkflowTemplateList([template]))
    })
  },
})

const WorkflowRunPauseCommand = controlCommand("pause", "pause queued workflow children", WorkflowScheduler.pause)
const WorkflowRunResumeCommand = controlCommand("resume", "resume paused workflow children", WorkflowScheduler.resume)
const WorkflowRunCancelCommand = controlCommand("cancel", "cancel a workflow run", WorkflowScheduler.cancel)
const WorkflowRunRetryCommand = cmd({
  command: "retry <runID>",
  describe: "retry failed or cancelled workflow children",
  builder: (yargs: Argv) =>
    yargs
      .positional("runID", {
        type: "string",
        demandOption: true,
        describe: "workflow run id",
      })
      .option("phase-id", {
        type: "string",
        describe: "retry failed or cancelled children for one workflow phase id",
      })
      .option("json", jsonOption()),
  async handler(args) {
    await withWorkflowRuntime(async () => {
      const options = args as unknown as RetryOptions
      const detail = options.phaseId
        ? await WorkflowScheduler.retryPhase(options.runID as WorkflowRunID, options.phaseId as WorkflowPhaseID)
        : await WorkflowScheduler.retry(options.runID as WorkflowRunID)
      if (options.json) {
        writeJson(detail)
        return
      }
      process.stdout.write(formatWorkflowRunDetail(detail))
    })
  },
})

export const WorkflowCommand = cmd({
  command: "workflow",
  aliases: ["wflow"],
  describe: "manage dynamic workflow runs",
  builder: (yargs: Argv) =>
    yargs
      .command(WorkflowTemplateListCommand)
      .command(WorkflowRunListCommand)
      .command(WorkflowRunDashboardCommand)
      .command(WorkflowRoutineListCommand)
      .command(WorkflowEvalCaseListCommand)
      .command(WorkflowEvalCaseRunCommand)
      .command(WorkflowRoutineCreateCommand)
      .command(WorkflowRunStartCommand)
      .command(WorkflowRoutineRunCommand)
      .command(WorkflowRunStatusCommand)
      .command(WorkflowRunArtifactsCommand)
      .command(WorkflowRunSaveTemplateCommand)
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

function formatRunModelPolicy(detail: WorkflowRunDetail) {
  const policy = detail.spec.modelPolicy ?? {}
  const models = formatNamedModels({
    default: policy.defaultModel,
    cheap: policy.cheapModel,
    strong: policy.strongModel,
    planner: policy.plannerModel,
    worker: policy.workerModel,
    verifier: policy.verifierModel,
    synthesizer: policy.synthesizerModel,
  })
  const providers = policy.allowedProviders?.length ? `providers=${policy.allowedProviders.join("|")}` : undefined
  return [`effort=${policy.effort ?? "normal"}`, models || "models=default", providers].filter(Boolean).join(", ")
}

function formatRunExecutionPolicy(detail: WorkflowRunDetail) {
  const budget = detail.spec.budget ?? detail.budget
  const permissions = detail.spec.permissions ?? {}
  return [
    `write=${permissions.writePolicy ?? "read-only"}`,
    `network=${permissions.networkPolicy ?? "inherit"}`,
    `escalation=${permissions.escalationPolicy ?? "inherit"}`,
    `maxParallel=${budget.maxConcurrentAgents ?? "-"}`,
    `maxAgents=${budget.maxTotalAgents ?? "-"}`,
  ].join(", ")
}

function totalArtifacts(run: WorkflowRunProjection) {
  return Object.values(run.artifactCounts).reduce((sum, value) => sum + value, 0)
}

function formatNamedModels(models: {
  default?: string
  cheap?: string
  strong?: string
  planner?: string
  worker?: string
  verifier?: string
  synthesizer?: string
}) {
  return [
    namedModel("default", models.default),
    namedModel("cheap", models.cheap),
    namedModel("strong", models.strong),
    namedModel("planner", models.planner),
    namedModel("worker", models.worker),
    namedModel("verifier", models.verifier),
    namedModel("synthesizer", models.synthesizer),
  ]
    .filter(Boolean)
    .join(", ")
}

function namedModel(label: string, value: string | undefined) {
  return value ? `${label}=${value}` : undefined
}

function truncate(input: string, maxLength: number) {
  if (input.length <= maxLength) return input
  return `${input.slice(0, Math.max(0, maxLength - 3))}...`
}

function formatPercent(value: number | null) {
  if (value === null) return "-"
  return `${Math.round(value * 100)}%`
}

function formatUsd(value: number | null) {
  if (value === null) return "-"
  return `$${value.toFixed(4)}`
}

function formatArtifactPayload(payload: unknown) {
  if (typeof payload === "string") return truncate(payload, 240)
  if (typeof payload === "number" || typeof payload === "boolean" || payload === null) return String(payload)
  try {
    return truncate(JSON.stringify(payload), 240)
  } catch {
    return truncate(String(payload), 240)
  }
}
