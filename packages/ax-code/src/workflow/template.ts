import path from "path"
import fs from "fs/promises"
import { createHash } from "crypto"
import z from "zod"
import { Global } from "../global"
import { Instance } from "../project/instance"
import { SessionID } from "../session/schema"
import { Filesystem } from "../util/filesystem"
import { WorkflowFixtureSpecs } from "./fixtures"
import { WorkflowRun } from "./run"
import { WorkflowRunID } from "./state"
import {
  WorkflowInputValues,
  WorkflowModelPolicyOverride,
  WorkflowSpecV1,
  applyWorkflowModelPolicyOverride,
  parseWorkflowSpecV1,
} from "./spec"

export namespace WorkflowTemplate {
  export const Source = z.enum(["builtin", "user", "project"])
  export type Source = z.infer<typeof Source>

  export const Trust = z.enum(["candidate", "trusted"])
  export type Trust = z.infer<typeof Trust>

  export const ID = z
    .string()
    .min(1)
    .max(120)
    .regex(/^(builtin|user|project):[a-z][a-z0-9-]*$/)
  export type ID = z.infer<typeof ID>

  export const Stored = z.object({
    schemaVersion: z.literal(1),
    revision: z.number().int().positive().default(1),
    trust: Trust.default("candidate"),
    spec: WorkflowSpecV1,
    time: z.object({
      created: z.number(),
      updated: z.number(),
    }),
  })
  export type Stored = z.infer<typeof Stored>

  export const Info = z.object({
    id: ID,
    source: Source,
    trust: Trust,
    name: z.string().min(1),
    description: z.string().min(1),
    tags: z.array(z.string()),
    revision: z.number().int().positive(),
    specHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    spec: WorkflowSpecV1,
    path: z.string().optional(),
    time: z
      .object({
        created: z.number(),
        updated: z.number(),
      })
      .optional(),
  })
  export type Info = z.infer<typeof Info>

  export const CreateRunInput = z.object({
    templateID: ID,
    parentSessionID: SessionID.zod.optional(),
    sourceTaskID: z.string().trim().min(1).optional(),
    modelPolicy: WorkflowModelPolicyOverride.optional(),
    inputValues: WorkflowInputValues,
  })
  export type CreateRunInput = z.input<typeof CreateRunInput>

  export const SaveInput = z.object({
    scope: Source.exclude(["builtin"]),
    trust: Trust.default("candidate"),
    spec: WorkflowSpecV1,
  })
  export type SaveInput = z.input<typeof SaveInput>

  export const SaveFromRunInput = z.object({
    runID: WorkflowRunID.zod,
    scope: Source.exclude(["builtin"]),
  })
  export type SaveFromRunInput = z.input<typeof SaveFromRunInput>

  const builtins = Object.fromEntries(
    Object.entries(WorkflowFixtureSpecs).map(([key, value]) => {
      const spec = parseWorkflowSpecV1(value)
      return [
        `builtin:${spec.id}`,
        {
          id: `builtin:${spec.id}`,
          source: "builtin",
          trust: "trusted",
          name: spec.name,
          description: spec.description,
          tags: spec.tags,
          revision: 1,
          specHash: specHash(spec),
          spec,
        },
      ]
    }),
  ) as Record<ID, Info>

  export async function list(): Promise<Info[]> {
    const local = await Promise.all([readCatalog("user"), readCatalog("project")])
    return [...Object.values(builtins), ...local.flat()]
      .map((template) => Info.parse(template))
      .sort((a, b) => a.id.localeCompare(b.id))
  }

  export async function get(id: ID): Promise<Info> {
    const parsed = ID.parse(id)
    const { source } = splitID(parsed)
    if (source === "builtin") {
      const template = builtins[parsed]
      if (!template) throw new WorkflowTemplateNotFoundError(parsed)
      return Info.parse(template)
    }

    const template = await readTemplate(source, parsed)
    if (!template) throw new WorkflowTemplateNotFoundError(parsed)
    return Info.parse(template)
  }

  export async function save(input: SaveInput): Promise<Info> {
    const parsed = SaveInput.parse(input)
    const file = templatePath(parsed.scope, parsed.spec.id)
    const existing = await Filesystem.readJson<unknown>(file).catch(() => undefined)
    const now = Date.now()
    const current = existing ? Stored.safeParse(existing) : undefined
    const stored = Stored.parse({
      schemaVersion: 1,
      revision: current?.success ? current.data.revision + 1 : 1,
      trust: parsed.trust,
      spec: parsed.spec,
      time: {
        created: current?.success ? current.data.time.created : now,
        updated: now,
      },
    })
    await Filesystem.writeJson(file, stored, 0o600)
    const template = toInfo(parsed.scope, stored, file)
    return Info.parse(template)
  }

  export async function promote(id: ID): Promise<Info> {
    const parsed = ID.parse(id)
    const { source } = splitID(parsed)
    if (source === "builtin")
      throw new WorkflowTemplatePromotionError(parsed, "Built-in templates are already trusted.")

    const file = templatePath(source, splitID(parsed).specID)
    const stored = await readStoredTemplate(file)
    if (!stored) throw new WorkflowTemplateNotFoundError(parsed)
    const promoted = Stored.parse({
      ...stored,
      revision: stored.revision + 1,
      trust: "trusted",
      time: {
        ...stored.time,
        updated: Date.now(),
      },
    })
    await Filesystem.writeJson(file, promoted, 0o600)
    return Info.parse(toInfo(source, promoted, file))
  }

  export async function saveFromRun(input: SaveFromRunInput): Promise<Info> {
    const parsed = SaveFromRunInput.parse(input)
    const run = await WorkflowRun.getDetail(parsed.runID)
    return save({
      scope: parsed.scope,
      trust: "candidate",
      spec: run.spec,
    })
  }

  export async function createRun(input: CreateRunInput): Promise<WorkflowRun.Info> {
    const parsed = CreateRunInput.parse(input)
    const template = await get(parsed.templateID)
    if (template.trust !== "trusted") throw new WorkflowTemplateUntrustedError(template.id)
    return WorkflowRun.create({
      parentSessionID: parsed.parentSessionID,
      sourceTemplateID: template.id,
      sourceTaskID: parsed.sourceTaskID,
      spec: applyWorkflowModelPolicyOverride(template.spec, parsed.modelPolicy),
      inputValues: parsed.inputValues,
    })
  }

  async function readCatalog(source: Exclude<Source, "builtin">): Promise<Info[]> {
    const dir = safeTemplateDir(source)
    if (!dir) return []
    const files = await fs.readdir(dir).catch(() => [])

    const templates = await Promise.all(
      files
        .filter((file) => file.endsWith(".json"))
        .map(async (file) => readTemplateFromPath(source, path.join(dir, file))),
    )
    return templates.filter((template): template is Info => !!template)
  }

  async function readTemplate(source: Exclude<Source, "builtin">, id: ID): Promise<Info | undefined> {
    const { specID } = splitID(id)
    return readTemplateFromPath(source, templatePath(source, specID))
  }

  async function readTemplateFromPath(source: Exclude<Source, "builtin">, file: string): Promise<Info | undefined> {
    const stored = await readStoredTemplate(file)
    if (!stored) return undefined
    return Info.parse(toInfo(source, stored, file))
  }

  async function readStoredTemplate(file: string): Promise<Stored | undefined> {
    return Filesystem.readJson<unknown>(file)
      .then((value) => Stored.parse(value))
      .catch(() => undefined)
  }

  function toInfo(source: Exclude<Source, "builtin">, stored: Stored, file: string): Info {
    return {
      id: `${source}:${stored.spec.id}` as ID,
      source,
      trust: stored.trust,
      name: stored.spec.name,
      description: stored.spec.description,
      tags: stored.spec.tags,
      revision: stored.revision,
      specHash: specHash(stored.spec),
      spec: stored.spec,
      path: file,
      time: stored.time,
    }
  }

  function splitID(id: ID): { source: Source; specID: string } {
    const [source, specID] = id.split(":", 2)
    const parsedSource = Source.parse(source)
    if (!specID) throw new WorkflowTemplateNotFoundError(id)
    return { source: parsedSource, specID }
  }

  function templateDir(source: Exclude<Source, "builtin">) {
    if (source === "user") return path.join(Global.Path.config, "workflow-template")
    return path.join(Instance.worktree, ".ax-code", "workflow-template")
  }

  function safeTemplateDir(source: Exclude<Source, "builtin">) {
    try {
      return templateDir(source)
    } catch {
      return undefined
    }
  }

  function templatePath(source: Exclude<Source, "builtin">, specID: string) {
    return path.join(templateDir(source), `${specID}.json`)
  }

  export function specHash(spec: WorkflowSpecV1): string {
    return `sha256:${createHash("sha256")
      .update(JSON.stringify(canonical(spec)))
      .digest("hex")}`
  }

  function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical)
    if (!value || typeof value !== "object") return value
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, val]) => [key, canonical(val)]),
    )
  }
}

export class WorkflowTemplateNotFoundError extends Error {
  constructor(id: WorkflowTemplate.ID) {
    super(`Workflow template not found: ${id}`)
    this.name = "WorkflowTemplateNotFoundError"
  }
}

export class WorkflowTemplateUntrustedError extends Error {
  constructor(id: WorkflowTemplate.ID) {
    super(`Workflow template is a candidate and must be promoted before execution: ${id}`)
    this.name = "WorkflowTemplateUntrustedError"
  }
}

export class WorkflowTemplatePromotionError extends Error {
  constructor(id: WorkflowTemplate.ID, reason: string) {
    super(`Workflow template cannot be promoted: ${id}. ${reason}`)
    this.name = "WorkflowTemplatePromotionError"
  }
}
