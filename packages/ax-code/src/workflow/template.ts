import z from "zod"
import { SessionID } from "../session/schema"
import { WorkflowFixtureSpecs } from "./fixtures"
import { WorkflowRun } from "./run"
import { WorkflowSpecV1, parseWorkflowSpecV1 } from "./spec"

export namespace WorkflowTemplate {
  export const Source = z.enum(["builtin"])
  export type Source = z.infer<typeof Source>

  export const ID = z.string().min(1).max(120).regex(/^builtin:[a-z][a-z0-9-]*$/)
  export type ID = z.infer<typeof ID>

  export const Info = z.object({
    id: ID,
    source: Source,
    name: z.string().min(1),
    description: z.string().min(1),
    tags: z.array(z.string()),
    spec: WorkflowSpecV1,
  })
  export type Info = z.infer<typeof Info>

  export const CreateRunInput = z.object({
    templateID: ID,
    parentSessionID: SessionID.zod.optional(),
  })
  export type CreateRunInput = z.infer<typeof CreateRunInput>

  const builtins = Object.fromEntries(
    Object.entries(WorkflowFixtureSpecs).map(([key, value]) => {
      const spec = parseWorkflowSpecV1(value)
      return [
        `builtin:${spec.id}`,
        {
          id: `builtin:${spec.id}`,
          source: "builtin",
          name: spec.name,
          description: spec.description,
          tags: spec.tags,
          spec,
        },
      ]
    }),
  ) as Record<ID, Info>

  export function list(): Info[] {
    return Object.values(builtins).map((template) => Info.parse(template))
  }

  export function get(id: ID): Info {
    const parsed = ID.parse(id)
    const template = builtins[parsed]
    if (!template) throw new WorkflowTemplateNotFoundError(parsed)
    return Info.parse(template)
  }

  export async function createRun(input: CreateRunInput): Promise<WorkflowRun.Info> {
    const parsed = CreateRunInput.parse(input)
    const template = get(parsed.templateID)
    return WorkflowRun.create({
      parentSessionID: parsed.parentSessionID,
      sourceTemplateID: template.id,
      spec: template.spec,
    })
  }
}

export class WorkflowTemplateNotFoundError extends Error {
  constructor(id: WorkflowTemplate.ID) {
    super(`Workflow template not found: ${id}`)
    this.name = "WorkflowTemplateNotFoundError"
  }
}
