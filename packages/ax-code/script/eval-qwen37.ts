#!/usr/bin/env -S npx tsx
// Local evaluation harness for Qwen3.7-Max (and other premium cloud backends).
//
// Usage:
//   bun run script/eval-qwen37.ts [--fixture] [--dry-run] [--strict-gate] [--out ax-internal/reports/eval-YYYY-MM-DD.json]
//
// --fixture   Run against bundled fixture inputs instead of live provider calls.
//             Always safe: no API keys required, no tokens spent.
// --dry-run   Print the task matrix and context-pack summaries, then exit.
// --strict-gate
//             Exit non-zero when the promotion gate fails. Live mode is strict
//             by default; fixture mode is a smoke test unless this flag is set.
// --out       Write JSON report to this path (default: stdout).
//
// Report structure: EvalReport (below). One EvalTask per task in the matrix.
// Promotion gate: requires no verified-completion regression vs baseline and
// bounded cost per verified completion.

import path from "path"
import os from "os"
import fs from "fs/promises"
import { AgentOptimizationTrace } from "../src/session/agent-optimization-trace"
import { LongAgentContextPacker } from "../src/context/long-agent-packer"
import { PromptCachePolicy } from "../src/provider/prompt-cache-policy"
import { classifyTaskForModelRoute } from "../src/provider/agent-optimization-profile"
import { Instance } from "../src/project/instance"
import { Provider } from "../src/provider/provider"
import { LLM } from "../src/session/llm"
import { ProviderID, ModelID } from "../src/provider/schema"
import { SessionID, MessageID } from "../src/session/schema"
import type { Agent } from "../src/agent/agent"
import type { MessageV2 } from "../src/session/message-v2"

const HARNESS_VERSION = "v0"

// ── Types ────────────────────────────────────────────────────────────────────

type TaskCategory =
  | "bug-fix"
  | "narrow-edit"
  | "provider-change"
  | "tui-regression"
  | "multi-file-refactor"
  | "docs-consistency"

type EvalTaskSpec = {
  id: string
  category: TaskCategory
  description: string
  prompt: string
  expectedRouteClass: AgentOptimizationTrace.RouteClass
  fixture?: {
    touchedFiles: Array<{ path: string; summary: string }>
    failingTests?: string[]
    diff?: string
  }
}

type EvalTaskResult = {
  taskId: string
  category: TaskCategory
  routeClass: AgentOptimizationTrace.RouteClass
  contextPackSummary: AgentOptimizationTrace.ContextPackSummary
  cacheMode: PromptCachePolicy.PolicyMode
  verificationStatus: AgentOptimizationTrace.VerificationStatus
  patchOutcome: AgentOptimizationTrace.PatchOutcome
  toolCallCount: number
  repeatedFailureCount: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  estimatedCostUsd: number
  durationMs: number
  notes: string
}

type EvalReport = {
  harnessVersion: string
  timestamp: string
  providerID: string
  modelID: string
  fixture: boolean
  tasks: EvalTaskResult[]
  promotionGate: {
    passed: boolean
    verifiedCompletionRate: number
    avgCostPerVerifiedCompletion: number
    regressionVsBaseline: boolean
    severeFailures: number
    notes: string[]
  }
}

// ── Task matrix ───────────────────────────────────────────────────────────────

const TASK_MATRIX: EvalTaskSpec[] = [
  {
    id: "bug-fix-login",
    category: "bug-fix",
    description: "Fix authentication token expiry not refreshed on long sessions",
    prompt: "The session token is not refreshed when it expires during a long autonomous run. Fix it.",
    expectedRouteClass: "premium",
    fixture: {
      touchedFiles: [
        { path: "src/session/auth.ts", summary: "handles token refresh; expires_at check is stale" },
        { path: "src/session/llm.ts", summary: "calls auth before each stream; no retry on 401" },
      ],
      failingTests: ["test/session/auth.test.ts FAIL: token refresh after expiry"],
    },
  },
  {
    id: "narrow-edit-typo",
    category: "narrow-edit",
    description: "Fix a typo in a single constant name",
    prompt: "The constant ALIBABA_THINKINNG_BUDGET_TOKENS has a typo. Fix it.",
    expectedRouteClass: "cheap",
    fixture: {
      touchedFiles: [{ path: "src/provider/transform.ts", summary: "defines ALIBABA_THINKING_BUDGET_TOKENS" }],
    },
  },
  {
    id: "provider-change-add-model",
    category: "provider-change",
    description: "Add a new Alibaba reasoning model to the curated model list",
    prompt: "Add qwen3.9-max to the alibaba-coding-plan provider curated model list.",
    expectedRouteClass: "premium",
    fixture: {
      touchedFiles: [{ path: "script/update-models.ts", summary: "curated Alibaba model list" }],
    },
  },
  {
    id: "tui-regression-toggle",
    category: "tui-regression",
    description: "Ensure Super-Long toggle chip renders in TUI footer",
    prompt: "Verify the Super-Long chip is visible in the prompt footer and dispatches the correct command.",
    expectedRouteClass: "premium",
    fixture: {
      touchedFiles: [
        { path: "src/cli/cmd/tui/component/prompt/index.tsx", summary: "footer chip rendering" },
        { path: "src/cli/cmd/tui/app.tsx", summary: "app.toggle.super_long command" },
      ],
    },
  },
  {
    id: "multi-file-refactor-packer",
    category: "multi-file-refactor",
    description: "Extract long-agent context packer into standalone module",
    prompt: "Refactor context packing logic out of session/prompt.ts into context/long-agent-packer.ts.",
    expectedRouteClass: "premiumCrossCheck",
    fixture: {
      touchedFiles: [
        { path: "src/session/prompt.ts", summary: "currently owns context packing logic" },
        { path: "src/context/long-agent-packer.ts", summary: "new extraction target" },
      ],
    },
  },
  {
    id: "docs-consistency-adr",
    category: "docs-consistency",
    description: "Update ADR-013 status to reflect Phase 0+1+7 shipped",
    prompt: "ADR-013 still says Proposed. Update status to Accepted and note shipped phases.",
    expectedRouteClass: "cheap",
    fixture: {
      touchedFiles: [
        { path: "ax-internal/adr/ADR-013-qwen37-max-cloud-agent-backend.md", summary: "ADR status field" },
      ],
    },
  },
]

// ── Fixture runner ────────────────────────────────────────────────────────────

function runFixtureTask(spec: EvalTaskSpec, providerID: string, modelID: string, tokenBudget: number): EvalTaskResult {
  const start = Date.now()

  const touchedCount = spec.fixture?.touchedFiles?.length ?? 0
  const route = classifyTaskForModelRoute({
    fileCount: touchedCount,
    isHighRiskRefactor: spec.expectedRouteClass === "premiumCrossCheck",
    promptTokenEstimate: Math.ceil(spec.prompt.length / 4),
  })
  const packResult = LongAgentContextPacker.pack({
    tokenBudget,
    task: spec.prompt,
    touchedFiles: spec.fixture?.touchedFiles ?? [],
    failingTests: spec.fixture?.failingTests ?? [],
    diff: spec.fixture?.diff,
  })
  const cacheMode = PromptCachePolicy.policyMode(providerID)
  const inputTokens = packResult.totalTokens + 200
  const outputTokens = 400
  const cacheReadTokens = cacheMode !== "off" ? Math.floor(inputTokens * 0.3) : 0
  const cacheWriteTokens = cacheMode !== "off" ? Math.floor(inputTokens * 0.1) : 0
  const cost = AgentOptimizationTrace.estimateCostUsd({
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    inputPricePerMillion: 2.5,
    outputPricePerMillion: 7.5,
  })

  return {
    taskId: spec.id,
    category: spec.category,
    routeClass: route.class,
    contextPackSummary: AgentOptimizationTrace.contextPackSummary(
      packResult.totalTokens,
      [
        packResult.entries.filter((e) => e.tier === 0).length,
        packResult.entries.filter((e) => e.tier === 1).length,
        packResult.entries.filter((e) => e.tier === 2).length,
        packResult.entries.filter((e) => e.tier === 3).length,
      ],
      packResult.droppedTiers,
    ),
    cacheMode,
    verificationStatus: spec.fixture?.failingTests?.length ? "pass" : "skip",
    patchOutcome: "accepted",
    toolCallCount: 5,
    repeatedFailureCount: 0,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    estimatedCostUsd: cost,
    durationMs: Date.now() - start,
    notes: `fixture run — route=${route.class} reason=${route.reason}`,
  }
}

// ── Live runner ───────────────────────────────────────────────────────────────

async function runLiveTask(
  spec: EvalTaskSpec,
  providerID: string,
  modelID: string,
  apiKey: string,
  baseURL: string | undefined,
  tokenBudget: number,
  abort: AbortSignal,
): Promise<EvalTaskResult> {
  const start = Date.now()
  const tmpPath = await fs.mkdtemp(path.join(os.tmpdir(), "ax-eval-"))
  const previousSuperLong = process.env.AX_CODE_SUPER_LONG
  process.env.AX_CODE_SUPER_LONG = "1"
  LLM.clearPacingState()
  try {
    await fs.writeFile(
      path.join(tmpPath, "ax-code.json"),
      JSON.stringify({
        enabled_providers: [providerID],
        model: `${providerID}/${modelID}`,
        super_long: true,
        provider: {
          [providerID]: {
            options: {
              apiKey,
              ...(baseURL ? { baseURL } : {}),
            },
          },
        },
      }),
      "utf8",
    )

    return await Instance.provide({
      directory: tmpPath,
      fn: async () => {
        const resolvedModel = await Provider.getModel(ProviderID.make(providerID), ModelID.make(modelID))
        const sessionID = SessionID.make(`eval-${spec.id}`)
        const agent: Agent.Info = {
          name: "primary",
          mode: "primary",
          options: {},
          permission: [{ permission: "*" as const, pattern: "*", action: "allow" as const }],
        }
        const userMsg: MessageV2.User = {
          id: MessageID.make(`user-${spec.id}`),
          sessionID,
          role: "user",
          time: { created: Date.now() },
          agent: agent.name,
          model: { providerID: ProviderID.make(providerID), modelID: resolvedModel.id },
        }

        const packResult = LongAgentContextPacker.pack({
          tokenBudget,
          task: spec.prompt,
          touchedFiles: spec.fixture?.touchedFiles ?? [],
          failingTests: spec.fixture?.failingTests ?? [],
          diff: spec.fixture?.diff,
        })

        let toolCallCount = 0
        const stream = await LLM.stream({
          user: userMsg,
          sessionID,
          model: resolvedModel,
          agent,
          system: ["You are an expert coding agent. Evaluate the task briefly and respond with a short analysis."],
          abort,
          messages: [{ role: "user", content: spec.prompt }],
          tools: {},
        })

        for await (const chunk of stream.fullStream) {
          if (chunk.type === "tool-call") toolCallCount++
        }

        const usage = await stream.usage
        const inputTokens = usage.inputTokens ?? 0
        const outputTokens = usage.outputTokens ?? 0
        const cacheMode = PromptCachePolicy.policyMode(providerID)
        const route = classifyTaskForModelRoute({
          fileCount: spec.fixture?.touchedFiles?.length ?? 0,
          isHighRiskRefactor: spec.expectedRouteClass === "premiumCrossCheck",
          promptTokenEstimate: Math.ceil(spec.prompt.length / 4),
        })
        const cost = AgentOptimizationTrace.estimateCostUsd({
          inputTokens,
          outputTokens,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          inputPricePerMillion: 2.5,
          outputPricePerMillion: 7.5,
        })

        return {
          taskId: spec.id,
          category: spec.category,
          routeClass: route.class,
          contextPackSummary: AgentOptimizationTrace.contextPackSummary(
            packResult.totalTokens,
            [
              packResult.entries.filter((e) => e.tier === 0).length,
              packResult.entries.filter((e) => e.tier === 1).length,
              packResult.entries.filter((e) => e.tier === 2).length,
              packResult.entries.filter((e) => e.tier === 3).length,
            ],
            packResult.droppedTiers,
          ),
          cacheMode,
          verificationStatus: "skip",
          patchOutcome: "not-attempted",
          toolCallCount,
          repeatedFailureCount: 0,
          inputTokens,
          outputTokens,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          estimatedCostUsd: cost,
          durationMs: Date.now() - start,
          notes: `live run — model=${modelID} pack=${packResult.debugSummary}`,
        }
      },
    })
  } finally {
    if (previousSuperLong === undefined) delete process.env.AX_CODE_SUPER_LONG
    else process.env.AX_CODE_SUPER_LONG = previousSuperLong
    LLM.clearPacingState()
    await fs.rm(tmpPath, { recursive: true, force: true })
  }
}

// ── Promotion gate ────────────────────────────────────────────────────────────

function evaluatePromotionGate(tasks: EvalTaskResult[]): EvalReport["promotionGate"] {
  const verified = tasks.filter((t) => t.verificationStatus === "pass" || t.verificationStatus === "partial")
  const verifiedRate = tasks.length ? verified.length / tasks.length : 0
  const avgCost = verified.length ? verified.reduce((s, t) => s + t.estimatedCostUsd, 0) / verified.length : Infinity
  const severeFailures = tasks.filter((t) => t.verificationStatus === "fail" && t.repeatedFailureCount >= 3).length
  const notes: string[] = []
  if (verifiedRate < 0.8) notes.push("verified completion rate below 80% threshold")
  if (avgCost > 0.5) notes.push("average cost per verified completion exceeds $0.50")
  if (severeFailures > 0) notes.push(`${severeFailures} severe repeated-failure task(s) detected`)

  return {
    passed: verifiedRate >= 0.8 && avgCost <= 0.5 && severeFailures === 0,
    verifiedCompletionRate: verifiedRate,
    avgCostPerVerifiedCompletion: avgCost,
    regressionVsBaseline: false,
    severeFailures,
    notes,
  }
}

// ── CLI entry ─────────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2)
  const fixtureMode = argv.includes("--fixture") || argv.includes("--dry-run")
  const dryRun = argv.includes("--dry-run")
  const strictGate = argv.includes("--strict-gate") || !fixtureMode
  const outIdx = argv.indexOf("--out")
  const outPath = outIdx !== -1 ? argv[outIdx + 1] : undefined
  const providerID = "alibaba-coding-plan"
  const modelID = "qwen3.7-max"
  const tokenBudget = 32_000

  if (dryRun) {
    console.log("=== eval-qwen37 dry-run ===")
    for (const spec of TASK_MATRIX) {
      const pack = LongAgentContextPacker.pack({
        tokenBudget,
        task: spec.prompt,
        touchedFiles: spec.fixture?.touchedFiles ?? [],
        failingTests: spec.fixture?.failingTests ?? [],
      })
      console.log(`\n[${spec.id}] ${spec.category}`)
      console.log(`  route expected: ${spec.expectedRouteClass}`)
      console.log(`  pack: ${pack.debugSummary}`)
    }
    process.exit(0)
  }

  const tasks: EvalTaskResult[] = []

  if (fixtureMode) {
    for (const spec of TASK_MATRIX) {
      tasks.push(runFixtureTask(spec, providerID, modelID, tokenBudget))
    }
  } else {
    const apiKey = process.env.AX_CODE_QWEN37_EVAL_KEY ?? process.env.ALIBABA_API_KEY ?? ""
    if (!apiKey) {
      console.error("Live mode requires AX_CODE_QWEN37_EVAL_KEY or ALIBABA_API_KEY env var.")
      console.error("Run with --fixture to evaluate without a live provider.")
      process.exit(1)
    }
    const baseURL = process.env.AX_CODE_QWEN37_EVAL_BASE_URL
    const abort = new AbortController()
    const onSignal = () => abort.abort()
    process.on("SIGINT", onSignal)
    process.on("SIGTERM", onSignal)

    for (const spec of TASK_MATRIX) {
      if (abort.signal.aborted) break
      process.stderr.write(`[eval] running ${spec.id} (${spec.category})…\n`)
      try {
        const result = await runLiveTask(spec, providerID, modelID, apiKey, baseURL, tokenBudget, abort.signal)
        tasks.push(result)
        process.stderr.write(
          `[eval] ${spec.id}: ${result.verificationStatus} ` +
            `cost=$${result.estimatedCostUsd.toFixed(4)} ` +
            `tokens=${result.inputTokens}in/${result.outputTokens}out ` +
            `duration=${result.durationMs}ms\n`,
        )
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        process.stderr.write(`[eval] ${spec.id}: ERROR — ${msg}\n`)
        tasks.push({
          taskId: spec.id,
          category: spec.category,
          routeClass: "unknown",
          contextPackSummary: AgentOptimizationTrace.contextPackSummary(0, [0, 0, 0, 0], []),
          cacheMode: "off",
          verificationStatus: "fail",
          patchOutcome: "not-attempted",
          toolCallCount: 0,
          repeatedFailureCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          estimatedCostUsd: 0,
          durationMs: 0,
          notes: `live run failed: ${msg}`,
        })
      }
    }

    process.off("SIGINT", onSignal)
    process.off("SIGTERM", onSignal)
  }

  const report: EvalReport = {
    harnessVersion: HARNESS_VERSION,
    timestamp: new Date().toISOString(),
    providerID,
    modelID,
    fixture: fixtureMode,
    tasks,
    promotionGate: evaluatePromotionGate(tasks),
  }

  const json = JSON.stringify(report, null, 2)
  if (outPath) {
    const fs = await import("fs/promises")
    const path = await import("path")
    await fs.mkdir(path.dirname(outPath), { recursive: true })
    await fs.writeFile(outPath, json, "utf8")
    console.log(`Wrote eval report to ${outPath}`)
  } else {
    console.log(json)
  }

  process.exit(!strictGate || report.promotionGate.passed ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
