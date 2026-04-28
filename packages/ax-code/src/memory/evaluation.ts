import fs from "fs/promises"
import z from "zod"
import { recall, type RecallQuery } from "./recall"
import type { MemoryEntryKind } from "./types"

const MemoryEntryKindSchema = z.enum(["userPrefs", "feedback", "decisions", "reference"])
const ScopeSchema = z.enum(["project", "global", "all"])

const EvaluationCaseSchema = z.object({
  name: z.string().optional(),
  query: z.string().optional(),
  expected: z.array(z.string()).min(1),
  kind: z.union([MemoryEntryKindSchema, z.array(MemoryEntryKindSchema)]).optional(),
  agent: z.string().optional(),
  tags: z.union([z.string(), z.array(z.string())]).optional(),
  path: z.string().optional(),
  includeExpired: z.boolean().optional(),
  scope: ScopeSchema.optional(),
  limit: z.number().int().positive().optional(),
})

const EvaluationFileSchema = z.object({
  cases: z.array(EvaluationCaseSchema).min(1),
})

export type MemoryEvaluationCase = z.infer<typeof EvaluationCaseSchema>
export type MemoryEvaluationFile = z.infer<typeof EvaluationFileSchema>

export interface MemoryEvaluationOptions {
  casesPath: string
  limit?: number
  scope?: RecallQuery["scope"]
}

export interface MemoryEvaluationCaseResult {
  name: string
  query: string
  expected: string[]
  returned: string[]
  hit: boolean
  missing: string[]
  limit: number
  scope: RecallQuery["scope"]
}

export interface MemoryEvaluationReport {
  casesPath: string
  total: number
  passed: number
  recallAtK: number
  limit: number
  scope: RecallQuery["scope"]
  cases: MemoryEvaluationCaseResult[]
}

const DEFAULT_LIMIT = 5

export async function evaluate(projectRoot: string, opts: MemoryEvaluationOptions): Promise<MemoryEvaluationReport> {
  const text = await fs.readFile(opts.casesPath, "utf-8")
  const file = EvaluationFileSchema.parse(JSON.parse(text))
  const defaultLimit = opts.limit ?? DEFAULT_LIMIT
  const defaultScope = opts.scope ?? "project"

  const cases: MemoryEvaluationCaseResult[] = []
  for (const [index, item] of file.cases.entries()) {
    const limit = item.limit ?? defaultLimit
    const scope = item.scope ?? defaultScope
    const query: RecallQuery = {
      query: item.query,
      kind: item.kind as MemoryEntryKind | MemoryEntryKind[] | undefined,
      agent: item.agent,
      tags: item.tags,
      path: item.path,
      includeExpired: item.includeExpired,
      limit,
      scope,
    }
    const results = await recall(projectRoot, query)
    const returned = results.map((result) => result.entry.name)
    const returnedSet = new Set(returned)
    const missing = item.expected.filter((expected) => !returnedSet.has(expected))
    cases.push({
      name: item.name ?? `case-${index + 1}`,
      query: item.query ?? "",
      expected: item.expected,
      returned,
      hit: missing.length === 0,
      missing,
      limit,
      scope,
    })
  }

  const passed = cases.filter((item) => item.hit).length
  return {
    casesPath: opts.casesPath,
    total: cases.length,
    passed,
    recallAtK: cases.length === 0 ? 0 : passed / cases.length,
    limit: defaultLimit,
    scope: defaultScope,
    cases,
  }
}
