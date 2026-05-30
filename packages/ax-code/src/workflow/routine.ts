import z from "zod"
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
    securityGate: z.enum(["local-only", "required"]),
  })
  export type Info = z.infer<typeof Info>

  export const CreateInput = z
    .object({
      templateID: WorkflowTemplate.ID,
      scope: WorkflowTemplate.Source.exclude(["builtin"]),
      trust: WorkflowTemplate.Trust.default("candidate"),
      mode: z.enum(["api", "scheduled"]).default("api"),
      route: Route.optional(),
      schedule: Schedule.optional(),
      timezone: z.string().trim().min(1).max(120).optional(),
      enabled: z.boolean().default(false),
      securityGate: z.literal("local-only").default("local-only"),
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
    return templates
      .map(routineInfo)
      .filter((routine): routine is Info => !!routine)
      .sort((a, b) => a.route.localeCompare(b.route) || a.templateID.localeCompare(b.templateID))
  }

  export async function create(input: CreateInput): Promise<Info> {
    const parsed = CreateInput.parse(input)
    const template = await WorkflowTemplate.get(parsed.templateID)
    const route = parsed.route ?? `workflow/${template.spec.id}`
    const saved = await WorkflowTemplate.save({
      scope: parsed.scope,
      trust: parsed.trust,
      spec: {
        ...template.spec,
        trigger:
          parsed.mode === "scheduled"
            ? {
                kind: "scheduled",
                schedule: parsed.schedule!,
                timezone: parsed.timezone,
                enabled: parsed.enabled,
              }
            : {
                kind: "api",
                route,
                enabled: parsed.enabled,
              },
        routine: {
          ...(template.spec.routine ?? {}),
          enabled: parsed.enabled,
          mode: parsed.mode,
          apiRoute: route,
          schedule: parsed.mode === "scheduled" ? parsed.schedule : undefined,
          timezone: parsed.mode === "scheduled" ? parsed.timezone : undefined,
          securityGate: parsed.securityGate,
        },
      },
    })
    const routine = routineInfo(saved)
    if (!routine) throw new WorkflowRoutineNotFoundError(route)
    return routine
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

  function routineInfo(template: WorkflowTemplate.Info): Info | undefined {
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
      securityGate: routine.securityGate,
    })
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
