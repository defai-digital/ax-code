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
  minRecall?: number
}

export interface MemoryEvaluationCaseResult {
  name: string
  query: string
  expected: string[]
  returned: string[]
  expectedRanks: Array<{ name: string; rank: number | null }>
  firstHitRank: number | null
  reciprocalRank: number
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
  meanReciprocalRank: number
  minRecall?: number
  passedThreshold: boolean
  limit: number
  scope: RecallQuery["scope"]
  cases: MemoryEvaluationCaseResult[]
}

const DEFAULT_LIMIT = 5

export async function evaluate(projectRoot: string, opts: MemoryEvaluationOptions): Promise<MemoryEvaluationReport> {
  if (opts.minRecall !== undefined && (!Number.isFinite(opts.minRecall) || opts.minRecall < 0 || opts.minRecall > 1)) {
    throw new Error("minRecall must be a finite number between 0 and 1")
  }

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
    const returnedRanks = new Map(returned.map((name, resultIndex) => [name, resultIndex + 1]))
    const expectedRanks = item.expected.map((expected) => ({
      name: expected,
      rank: returnedRanks.get(expected) ?? null,
    }))
    const foundRanks = expectedRanks
      .map((expected) => expected.rank)
      .filter((rank): rank is number => rank !== null)
    const firstHitRank = foundRanks.length > 0 ? Math.min(...foundRanks) : null
    const missing = expectedRanks.filter((expected) => expected.rank === null).map((expected) => expected.name)
    cases.push({
      name: item.name ?? `case-${index + 1}`,
      query: item.query ?? "",
      expected: item.expected,
      returned,
      expectedRanks,
      firstHitRank,
      reciprocalRank: firstHitRank === null ? 0 : 1 / firstHitRank,
      hit: missing.length === 0,
      missing,
      limit,
      scope,
    })
  }

  const passed = cases.filter((item) => item.hit).length
  const recallAtK = cases.length === 0 ? 0 : passed / cases.length
  const meanReciprocalRank =
    cases.length === 0 ? 0 : cases.reduce((sum, item) => sum + item.reciprocalRank, 0) / cases.length
  return {
    casesPath: opts.casesPath,
    total: cases.length,
    passed,
    recallAtK,
    meanReciprocalRank,
    minRecall: opts.minRecall,
    passedThreshold: opts.minRecall === undefined || recallAtK >= opts.minRecall,
    limit: defaultLimit,
    scope: defaultScope,
    cases,
  }
}
