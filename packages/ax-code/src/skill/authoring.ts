import { existsSync } from "fs"
import os, { EOL } from "os"
import path from "path"
import matter from "gray-matter"
import z from "zod"
import { Filesystem } from "@/util/filesystem"
import { Instance } from "@/project/instance"
import { Skill } from "./index"

// Pure skill diagnostics + authoring helpers shared by the CLI (`ax-code skill ...`)
// and the HTTP server (`/skill/*` routes). Intentionally free of Effect and of any
// presentation concern so both surfaces can consume identical reports.

export const SkillValidationIssue = z.object({
  name: z.string(),
  location: z.string(),
  issues: z.array(z.string()),
})
export type SkillValidationIssue = z.infer<typeof SkillValidationIssue>

export const SkillValidationReport = z.object({
  total: z.number().int(),
  valid: z.number().int(),
  invalid: z.number().int(),
  issues: z.array(SkillValidationIssue),
})
export type SkillValidationReport = z.infer<typeof SkillValidationReport>

export const SkillDoctorReport = SkillValidationReport.extend({
  sources: z.record(z.string(), z.number().int()),
})
export type SkillDoctorReport = z.infer<typeof SkillDoctorReport>

export const SkillTriggerMatch = z.object({
  name: z.string(),
  description: z.string(),
  location: z.string(),
  sourceTool: Skill.Info.shape.sourceTool,
  scope: Skill.Info.shape.scope,
})
export type SkillTriggerMatch = z.infer<typeof SkillTriggerMatch>

export const SkillTriggerReport = z.object({
  files: z.array(z.string()),
  matched: z.array(SkillTriggerMatch),
})
export type SkillTriggerReport = z.infer<typeof SkillTriggerReport>

export const SkillTriggerRequest = z.object({
  files: z.array(z.string()).default([]),
})
export type SkillTriggerRequest = z.infer<typeof SkillTriggerRequest>

// Standard Agent Skill name: lowercase letters, numbers, single-hyphen separators.
// Enforcing it at the request boundary also blocks path traversal via the name
// (e.g. `../../etc`), since the name is joined into the on-disk skill path.
const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

export const SkillCreateRequest = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(SKILL_NAME_PATTERN, "name must use lowercase letters, numbers, and single hyphen separators"),
  description: z.string().min(1),
  path: z.string().optional(),
})
export type SkillCreateRequest = z.infer<typeof SkillCreateRequest>

export const SkillCreateResult = z.object({
  path: z.string(),
})
export type SkillCreateResult = z.infer<typeof SkillCreateResult>

export class SkillExistsError extends Error {
  constructor(public readonly path: string) {
    super(`Skill file already exists: ${path}`)
    this.name = "SkillExistsError"
  }
}

export class SkillPathError extends Error {
  constructor(public readonly path: string) {
    super(`Skill path must stay within the current worktree or home directory: ${path}`)
    this.name = "SkillPathError"
  }
}

export class SkillInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SkillInputError"
  }
}

function parseSkillCreateRequest(input: SkillCreateRequest) {
  const parsed = SkillCreateRequest.safeParse(input)
  if (parsed.success) return parsed.data

  const message = parsed.error.issues
    .map((issue) => {
      const field = issue.path.join(".")
      return field ? `${field}: ${issue.message}` : issue.message
    })
    .join("; ")
  throw new SkillInputError(message || "Invalid skill create request")
}

// Mirror the skill discovery containment policy (src/skill/index.ts): a skill may
// only live inside the worktree or the user's home directory. `path.resolve`
// normalizes `..` segments so a relative base path can't escape via traversal.
function assertContained(target: string) {
  const resolved = path.resolve(target)
  const worktree = path.resolve(Instance.worktree)
  const home = os.homedir()
  const within = (root: string) => resolved === root || resolved.startsWith(root + path.sep)
  if (!within(worktree) && !within(home)) throw new SkillPathError(resolved)
}

export function buildSkillValidationReport(skills: Skill.Info[]): SkillValidationReport {
  const issues = skills
    .filter((skill) => skill.standardIssues?.length)
    .map((skill) => ({
      name: skill.name,
      location: skill.location,
      issues: skill.standardIssues ?? [],
    }))

  return {
    total: skills.length,
    valid: skills.length - issues.length,
    invalid: issues.length,
    issues,
  }
}

export function buildSkillDoctorReport(skills: Skill.Info[]): SkillDoctorReport {
  const nameCounts = new Map<string, number>()
  for (const skill of skills) nameCounts.set(skill.name, (nameCounts.get(skill.name) ?? 0) + 1)

  const issues = skills
    .map((skill) => ({
      name: skill.name,
      location: skill.location,
      issues: skillDoctorIssues(skill, nameCounts),
    }))
    .filter((item) => item.issues.length > 0)

  const sources: Record<string, number> = {}
  for (const skill of skills) {
    const source = [skill.sourceTool ?? "unknown", skill.scope ?? "unknown"].join("/")
    sources[source] = (sources[source] ?? 0) + 1
  }
  return {
    total: skills.length,
    valid: skills.length - issues.length,
    invalid: issues.length,
    issues,
    sources,
  }
}

export function buildSkillTriggerReport(skills: Skill.Info[], files: string[]): SkillTriggerReport {
  return {
    files,
    matched: Skill.matchByPaths(skills, files).map((skill) => ({
      name: skill.name,
      description: skill.description,
      location: skill.location,
      sourceTool: skill.sourceTool,
      scope: skill.scope,
    })),
  }
}

export function skillCreateContent(input: { name: string; description: string }) {
  return matter.stringify(`# ${input.name}${EOL}${EOL}Add task-specific instructions here.${EOL}`, {
    name: input.name,
    description: input.description,
  })
}

export function skillCreatePath(input: { basePath: string; name: string }) {
  return path.join(input.basePath, input.name, "SKILL.md")
}

/**
 * Write a local Agent Skill skeleton. Defaults to `.ax-code/skill` in the current
 * worktree. Throws {@link SkillExistsError} when the target SKILL.md already exists.
 */
export async function createSkill(input: SkillCreateRequest): Promise<SkillCreateResult> {
  const request = parseSkillCreateRequest(input)
  const basePath = request.path ? path.resolve(request.path) : path.join(Instance.worktree, ".ax-code", "skill")
  const filePath = skillCreatePath({ basePath, name: request.name })
  assertContained(filePath)
  if (await Filesystem.exists(filePath)) throw new SkillExistsError(filePath)
  await Filesystem.write(filePath, skillCreateContent({ name: request.name, description: request.description }))
  return { path: filePath }
}

function skillDoctorIssues(skill: Skill.Info, nameCounts: Map<string, number>) {
  const issues = [...(skill.standardIssues ?? [])]
  const descriptionWords = skill.description.trim().split(/\s+/).filter(Boolean)
  if (skill.description.trim().length < 12 || descriptionWords.length < 3) issues.push("description is too vague")
  if (skill.content.length > 200_000) issues.push("SKILL.md exceeds 200KB")
  if ((skill.paths?.length ?? 0) > 20) issues.push("too many path globs")
  if ((nameCounts.get(skill.name) ?? 0) > 1) issues.push("duplicate skill name")

  const base = path.dirname(skill.location)
  for (const ref of relativeContentReferences(skill.content)) {
    if (!existsSync(path.resolve(base, ref))) issues.push(`referenced file is missing: ${ref}`)
  }

  return Array.from(new Set(issues))
}

function relativeContentReferences(content: string) {
  return Array.from(content.matchAll(/@(\.{1,2}\/[^\s`,)]+)/g)).map((match) => match[1])
}
