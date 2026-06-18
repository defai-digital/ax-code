import z from "zod"
import { JsonBoolean } from "@/util/schema"
import { SessionID } from "../session/schema"
import { WorkflowScheduler } from "./scheduler"
import { WorkflowInputValues, WorkflowModelPolicyOverride } from "./spec"
import { WorkflowTemplate } from "./template"

export namespace WorkflowRoutineTrigger {
  const Route = z
    .string()
    .trim()
    .min(1)
    .max(160)
    .regex(/^workflow\/[a-z][a-z0-9-/]*$/, "routine route must start with workflow/ and use kebab-case segments")
  const Schedule = z.string().trim().min(1).max(160)
  const ScheduledTaskStatus = z.enum(["active", "paused", "disabled"])

  export const Info = z.object({
    route: z.string().min(1),
    templateID: WorkflowTemplate.ID,
    templateName: z.string().min(1),
    source: WorkflowTemplate.Source,
    trust: WorkflowTemplate.Trust,
    enabled: z.boolean(),
    mode: z.enum(["manual", "scheduled", "api", "webhook"]),
    schedule: z.string().min(1).optional(),
    timezone: z.string().min(1).optional(),
    webhookEvent: z.string().min(1).optional(),
    scheduledTaskID: z.string().min(1).optional(),
    scheduledTaskStatus: ScheduledTaskStatus.optional(),
    nextRunAt: z.number().int().positive().optional(),
    lastWorkflowRunID: z.string().min(1).optional(),
    securityGate: z.enum(["local-only", "required"]),
  })
  export type Info = z.infer<typeof Info>

  export const CreateInput = z
    .object({
      templateID: WorkflowTemplate.ID,
      scope: WorkflowTemplate.Source.exclude(["builtin"]),
      trust: WorkflowTemplate.Trust.default("candidate"),
      mode: z.enum(["api", "scheduled", "webhook"]).default("api"),
      route: Route.optional(),
      schedule: Schedule.optional(),
      timezone: z.string().trim().min(1).max(120).optional(),
      webhookEvent: z.string().trim().min(1).max(160).optional(),
      enabled: JsonBoolean.default(false),
      securityGate: z.enum(["local-only", "required"]).optional(),
    })
    .superRefine((input, ctx) => {
      if (input.mode === "api" && !input.route) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "api routines must declare a route",
          path: ["route"],
        })
      }
      if (input.mode === "scheduled" && !input.schedule) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "scheduled routines must declare a schedule",
          path: ["schedule"],
        })
      }
      if (input.mode === "webhook" && !input.webhookEvent) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "webhook routines must declare an event",
          path: ["webhookEvent"],
        })
      }
      if (input.mode === "webhook" && input.enabled) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "webhook routines must remain disabled until remote security gates ship",
          path: ["enabled"],
        })
      }
      if (input.mode !== "webhook" && input.securityGate === "required") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "api and scheduled routines must use local-only security gates in workflow runtime preview",
          path: ["securityGate"],
        })
      }
    })
  export type CreateInput = z.input<typeof CreateInput>

  export const RunInput = z.object({
    route: z.string().trim().min(1),
    parentSessionID: SessionID.zod.optional(),
    modelPolicy: WorkflowModelPolicyOverride.optional(),
    inputValues: WorkflowInputValues,
    startOptions: WorkflowScheduler.StartOptions.partial().optional(),
  })
  export type RunInput = z.input<typeof RunInput>

  export async function list(): Promise<Info[]> {
    const templates = await WorkflowTemplate.list()
    const scheduledTasks = await scheduledTasksByTemplateID()
    return templates
      .map((template) => routineInfo(template, scheduledTasks.get(template.id)))
      .filter((routine): routine is Info => !!routine)
      .sort((a, b) => a.route.localeCompare(b.route) || a.templateID.localeCompare(b.templateID))
  }

  export async function create(input: CreateInput): Promise<Info> {
    const parsed = CreateInput.parse(input)
    const template = await WorkflowTemplate.get(parsed.templateID)
    const route = parsed.route ?? `workflow/${template.spec.id}`
    const securityGate = parsed.mode === "webhook" ? "required" : "local-only"
    const saved = await WorkflowTemplate.save({
      scope: parsed.scope,
      trust: parsed.trust,
      spec: {
        ...template.spec,
        trigger: triggerForCreateInput({ ...parsed, route, securityGate }),
        routine: {
          ...(template.spec.routine ?? {}),
          enabled: parsed.enabled,
          mode: parsed.mode,
          apiRoute: parsed.mode === "webhook" ? undefined : route,
          schedule: parsed.mode === "scheduled" ? parsed.schedule : undefined,
          timezone: parsed.mode === "scheduled" ? parsed.timezone : undefined,
          webhookEvent: parsed.mode === "webhook" ? parsed.webhookEvent : undefined,
          securityGate,
        },
      },
    })
    const scheduledTask = await maybeSyncScheduledTask({
      template: saved,
      route,
      schedule: parsed.schedule,
      timezone: parsed.timezone,
      enabled: parsed.enabled,
    })
    const routine = routineInfo(saved, scheduledTask)
    if (!routine) throw new WorkflowRoutineNotFoundError(route)
    return routine
  }

  function triggerForCreateInput(
    input: z.output<typeof CreateInput> & { route: string; securityGate: "local-only" | "required" },
  ) {
    if (input.mode === "scheduled") {
      return {
        kind: "scheduled" as const,
        schedule: input.schedule!,
        timezone: input.timezone,
        enabled: input.enabled,
      }
    }
    if (input.mode === "webhook") {
      return {
        kind: "webhook" as const,
        event: input.webhookEvent!,
        enabled: false as const,
        securityGate: input.securityGate as "required",
      }
    }
    return {
      kind: "api" as const,
      route: input.route,
      enabled: input.enabled,
    }
  }

  export async function run(input: RunInput) {
    const parsed = RunInput.parse(input)
    const template = await findApiRoutineTemplate(parsed.route)
    const run = await WorkflowTemplate.createRun({
      templateID: template.id,
      parentSessionID: parsed.parentSessionID,
      modelPolicy: parsed.modelPolicy,
      inputValues: parsed.inputValues,
    })
    const detail = await WorkflowScheduler.start(run.id, parsed.startOptions ?? {})
    const routine = routineInfo(template)
    if (!routine) throw new WorkflowRoutineNotFoundError(parsed.route)
    return { routine, template, run: detail }
  }

  async function findApiRoutineTemplate(route: string): Promise<WorkflowTemplate.Info> {
    const templates = await WorkflowTemplate.list()
    const matching = templates.filter(
      (template) => template.spec.routine?.mode === "api" && template.spec.routine.apiRoute === route,
    )
    const enabled = matching.find(
      (template) =>
        template.spec.routine?.enabled === true &&
        template.spec.routine.securityGate === "local-only" &&
        template.trust === "trusted",
    )
    if (enabled) return enabled
    if (matching.length > 0) throw new WorkflowRoutineDisabledError(route)
    throw new WorkflowRoutineNotFoundError(route)
  }

  function routineInfo(template: WorkflowTemplate.Info, scheduledTask?: ScheduledTaskInfo): Info | undefined {
    const routine = template.spec.routine
    if (!routine || routine.mode === "manual") return undefined
    const route = routine.apiRoute ?? `workflow/${template.spec.id}`
    return Info.parse({
      route,
      templateID: template.id,
      templateName: template.name,
      source: template.source,
      trust: template.trust,
      enabled: routine.enabled,
      mode: routine.mode,
      schedule: routine.schedule,
      timezone: routine.timezone,
      webhookEvent: routine.webhookEvent,
      scheduledTaskID: scheduledTask?.id,
      scheduledTaskStatus: scheduledTask?.status,
      nextRunAt: scheduledTask?.nextRunAt,
      lastWorkflowRunID: scheduledTask?.lastWorkflowRunID,
      securityGate: routine.securityGate,
    })
  }

  type ScheduledTaskInfo = {
    id: string
    workflowTemplateID?: string
    status: z.infer<typeof ScheduledTaskStatus>
    nextRunAt?: number
    lastWorkflowRunID?: string
  }

  async function maybeSyncScheduledTask(input: {
    template: WorkflowTemplate.Info
    route: string
    schedule?: string
    timezone?: string
    enabled: boolean
  }): Promise<ScheduledTaskInfo | undefined> {
    if (input.template.spec.routine?.mode !== "scheduled") return undefined
    const { ScheduledTask } = await import("../session/scheduled-task")
    const schedule = ScheduledTask.Schedule.parse({
      type: "cron",
      expression: input.schedule,
      timezone: input.timezone,
    })
    if (ScheduledTask.nextRunAt(schedule) === undefined) throw new WorkflowRoutineScheduleError(input.route)
    const active = input.enabled && input.template.trust === "trusted"
    const existing = (await ScheduledTask.list()).find((task) => task.workflowTemplateID === input.template.id)
    if (existing) {
      return ScheduledTask.update({
        id: existing.id,
        title: `Workflow: ${input.template.name}`,
        prompt: `Run scheduled workflow routine ${input.route}.`,
        schedule,
        status: active ? "active" : "paused",
        workflowTemplateID: input.template.id,
        workflowStartOptions: {
          durableChildren: true,
          enqueueChildren: true,
        },
      })
    }
    if (!active) return undefined
    return ScheduledTask.create({
      title: `Workflow: ${input.template.name}`,
      prompt: `Run scheduled workflow routine ${input.route}.`,
      schedule,
      workflowTemplateID: input.template.id,
      workflowStartOptions: {
        durableChildren: true,
        enqueueChildren: true,
      },
    })
  }

  async function scheduledTasksByTemplateID(): Promise<Map<WorkflowTemplate.ID, ScheduledTaskInfo>> {
    const { ScheduledTask } = await import("../session/scheduled-task")
    const tasks = await ScheduledTask.list()
    const result = new Map<WorkflowTemplate.ID, ScheduledTaskInfo>()
    for (const task of tasks) {
      if (!task.workflowTemplateID || result.has(task.workflowTemplateID as WorkflowTemplate.ID)) continue
      result.set(task.workflowTemplateID as WorkflowTemplate.ID, task)
    }
    return result
  }
}

export class WorkflowRoutineNotFoundError extends Error {
  constructor(route: string) {
    super(`Workflow routine not found: ${route}`)
    this.name = "WorkflowRoutineNotFoundError"
  }
}

export class WorkflowRoutineDisabledError extends Error {
  constructor(route: string) {
    super(`Workflow routine is not enabled as a trusted local API routine: ${route}`)
    this.name = "WorkflowRoutineDisabledError"
  }
}

export class WorkflowRoutineScheduleError extends Error {
  constructor(route: string) {
    super(`Workflow routine schedule cannot produce a next run time: ${route}`)
    this.name = "WorkflowRoutineScheduleError"
  }
}
