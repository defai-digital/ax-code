import z from "zod"
import { SessionID } from "../session/schema"
import { WorkflowScheduler } from "./scheduler"
import { WorkflowInputValues, WorkflowModelPolicyOverride } from "./spec"
import { WorkflowTemplate } from "./template"

export namespace WorkflowRoutineTrigger {
  export const Info = z.object({
    route: z.string().min(1),
    templateID: WorkflowTemplate.ID,
    templateName: z.string().min(1),
    source: WorkflowTemplate.Source,
    trust: WorkflowTemplate.Trust,
    enabled: z.boolean(),
    mode: z.enum(["manual", "scheduled", "api", "webhook"]),
    securityGate: z.enum(["local-only", "required"]),
  })
  export type Info = z.infer<typeof Info>

  export const CreateInput = z.object({
    templateID: WorkflowTemplate.ID,
    scope: WorkflowTemplate.Source.exclude(["builtin"]),
    trust: WorkflowTemplate.Trust.default("candidate"),
    route: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .regex(/^workflow\/[a-z][a-z0-9-/]*$/, "routine route must start with workflow/ and use kebab-case segments"),
    enabled: z.boolean().default(false),
    securityGate: z.literal("local-only").default("local-only"),
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
    const saved = await WorkflowTemplate.save({
      scope: parsed.scope,
      trust: parsed.trust,
      spec: {
        ...template.spec,
        routine: {
          ...(template.spec.routine ?? {}),
          enabled: parsed.enabled,
          mode: "api",
          apiRoute: parsed.route,
          securityGate: parsed.securityGate,
        },
      },
    })
    const routine = routineInfo(saved)
    if (!routine) throw new WorkflowRoutineNotFoundError(parsed.route)
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
    if (!routine?.apiRoute) return undefined
    return Info.parse({
      route: routine.apiRoute,
      templateID: template.id,
      templateName: template.name,
      source: template.source,
      trust: template.trust,
      enabled: routine.enabled,
      mode: routine.mode,
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
