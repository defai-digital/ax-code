/**
 * Worktree implement-arena orchestration (ADR-049 Phase 3).
 * Creates isolated worktrees, runs one agent per contestant, verifies, ranks.
 */

import { createHash } from "crypto"
import { Agent } from "../agent/agent"
import { Instance } from "../project/instance"
import { InstanceBootstrap } from "../project/bootstrap"
import { ImplementArena } from "../mode/implement-arena"
import type { Arena } from "../mode/arena"
import { VerificationPolicy } from "../session/verification-policy"
import { Session } from "../session"
import { SessionPrompt } from "../session/prompt"
import { MessageID, SessionID } from "../session/schema"
import { resolvePromptParts } from "../session/prompt-helpers"
import { Worktree } from "../worktree"
import { ModelID, ProviderID } from "../provider/schema"
import { Process } from "../util/process"
import { git } from "../util/git"
import { Log } from "../util/log"
import { toErrorMessage } from "../util/error-message"
import { withTimeout } from "../util/timeout"

const log = Log.create({ service: "tool.arena-implement" })

const IMPLEMENT_TIMEOUT_MS = 12 * 60 * 1000
const VERIFY_TIMEOUT_MS = 5 * 60 * 1000

export type ImplementMember = {
  providerID: ProviderID
  modelID: ModelID
  memberId: string
}

function fingerprintDiff(diff: string): string {
  const normalized = diff.replace(/\s+/g, " ").trim().slice(0, 50_000)
  if (!normalized) return "empty"
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16)
}

async function gitDiff(cwd: string): Promise<{ fingerprint: string; stat: string; linesChanged: number }> {
  const diff = await git(["diff", "HEAD"], { cwd })
  const stat = await git(["diff", "--stat", "HEAD"], { cwd })
  const text = (diff.stdout?.toString() ?? "").toString()
  const statText = (stat.stdout?.toString() ?? "").toString().trim()
  const linesChanged = text.split("\n").filter((l) => l.startsWith("+") || l.startsWith("-")).length
  return {
    fingerprint: fingerprintDiff(text),
    stat: statText || "(no diff)",
    linesChanged,
  }
}

async function runVerification(cwd: string): Promise<{
  verification: Arena.Verification
  detail: string
}> {
  try {
    const preferred = await VerificationPolicy.resolvePreferredCommands(cwd)
    const commands = preferred.preferred.slice(0, 3)
    if (!commands.length) {
      // Fall back: typecheck/test if present
      const fallback = [preferred.typecheck, preferred.test, preferred.lint].filter(Boolean) as string[]
      if (!fallback.length) {
        return { verification: "unknown", detail: "no project verification commands detected" }
      }
      commands.push(...fallback.slice(0, 2))
    }

    const details: string[] = []
    let anyFail = false
    let anyPass = false
    for (const cmd of commands) {
      const ran = await Process.run(
        process.platform === "win32" ? ["cmd", "/c", cmd] : ["bash", "-lc", cmd],
        {
          cwd,
          nothrow: true,
          timeout: VERIFY_TIMEOUT_MS,
        },
      ).catch(() => ({ code: 1 as number, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }))
      const code = typeof ran.code === "number" ? ran.code : 1
      const ok = code === 0
      if (ok) anyPass = true
      else anyFail = true
      details.push(`${ok ? "pass" : "fail"}: ${cmd}`)
    }
    if (anyPass && !anyFail) return { verification: "pass", detail: details.join("; ") }
    if (anyFail && !anyPass) return { verification: "fail", detail: details.join("; ") }
    if (anyPass && anyFail) return { verification: "fail", detail: details.join("; ") }
    return { verification: "unknown", detail: details.join("; ") || "no checks run" }
  } catch (err) {
    return { verification: "unknown", detail: `verify error: ${toErrorMessage(err)}` }
  }
}

function assistantText(result: Awaited<ReturnType<typeof SessionPrompt.prompt>>): string {
  return result.parts.findLast((x) => x.type === "text")?.text ?? ""
}

function assistantFailed(result: Awaited<ReturnType<typeof SessionPrompt.prompt>>): string | undefined {
  if (result.info.role !== "assistant") return undefined
  const err = result.info.error
  if (!err) return undefined
  const data = err.data as { message?: unknown } | undefined
  return typeof data?.message === "string" ? data.message : err.name
}

export async function runImplementContestant(input: {
  member: ImplementMember
  task: string
  context?: string
  parentSessionID: SessionID
  parentMessageID: MessageID
  agentName: string
  abort: AbortSignal
  timeoutMs?: number
}): Promise<ImplementArena.ContestantResult> {
  const timeoutMs = input.timeoutMs ?? IMPLEMENT_TIMEOUT_MS
  const started = Date.now()
  let worktree: Awaited<ReturnType<typeof Worktree.create>> | undefined

  try {
    if (Instance.project.vcs !== "git") {
      return {
        id: input.member.memberId,
        providerID: String(input.member.providerID),
        modelID: String(input.member.modelID),
        completed: false,
        verification: "fail",
        error: "Implement arena requires a git project (worktrees)",
      }
    }

    const slug = input.member.memberId.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 40)
    worktree = await Worktree.create({ name: `arena-${slug}-${Date.now().toString(36)}` })

    // Wait briefly for worktree populate (create schedules async bootstrap)
    await new Promise((r) => setTimeout(r, 50))
    const hard = await git(["reset", "--hard"], { cwd: worktree.directory })
    if (hard.exitCode !== 0) {
      return {
        id: input.member.memberId,
        providerID: String(input.member.providerID),
        modelID: String(input.member.modelID),
        worktreeDirectory: worktree.directory,
        worktreeBranch: worktree.branch,
        completed: false,
        verification: "fail",
        error: "Failed to populate worktree (git reset --hard)",
      }
    }

    const result = await Instance.provide({
      directory: worktree.directory,
      init: InstanceBootstrap,
      fn: async () => {
        const agent = await Agent.get(input.agentName).catch(() => undefined)
        const session = await Session.create({
          parentID: input.parentSessionID,
          title: `arena implement ${input.member.memberId}`,
          permission: [
            { permission: "task", pattern: "*", action: "deny" },
            { permission: "task_parallel", pattern: "*", action: "deny" },
            { permission: "arena", pattern: "*", action: "deny" },
            { permission: "council", pattern: "*", action: "deny" },
            { permission: "todowrite", pattern: "*", action: "deny" },
          ],
        })

        const prompt = [
          `You are a contestant in an implement arena. Work only in this worktree.`,
          `Implement the task completely. Prefer minimal correct changes.`,
          `Do not create nested subagents. Do not call arena/council.`,
          `After edits, leave the tree in a state that typecheck/tests can validate.`,
          "",
          `Task: ${input.task}`,
          input.context ? `\nContext:\n${input.context.slice(0, 16_000)}` : "",
        ]
          .filter(Boolean)
          .join("\n")

        const parts = await resolvePromptParts(prompt)
        const messageID = MessageID.ascending()
        const promptResult = await withTimeout(
          SessionPrompt.prompt({
            messageID,
            sessionID: session.id,
            model: {
              modelID: input.member.modelID,
              providerID: input.member.providerID,
            },
            agent: agent?.name ?? "build",
            tools: {
              task: false,
              task_parallel: false,
              arena: false,
              council: false,
              todowrite: false,
              todoread: false,
            },
            parts,
          }),
          timeoutMs,
          `Arena contestant timed out after ${timeoutMs / 60_000} minutes`,
        )

        return { sessionID: session.id, promptResult }
      },
    })

    if (input.abort.aborted) {
      return {
        id: input.member.memberId,
        providerID: String(input.member.providerID),
        modelID: String(input.member.modelID),
        worktreeDirectory: worktree.directory,
        worktreeBranch: worktree.branch,
        sessionID: result.sessionID,
        completed: false,
        verification: "fail",
        error: "aborted",
      }
    }

    const failMsg = assistantFailed(result.promptResult)
    const text = assistantText(result.promptResult)
    const diff = await gitDiff(worktree.directory)
    const verify = await runVerification(worktree.directory)
    // Empty patch with pass is suspicious — treat as unknown risk high
    const riskScore = Math.min(20, Math.max(1, Math.round(diff.linesChanged / 20)))

    log.info("arena implement contestant done", {
      toolName: "arena",
      memberId: input.member.memberId,
      durationMs: Date.now() - started,
      status: failMsg ? "error" : "ok",
      verification: verify.verification,
    })

    return {
      id: input.member.memberId,
      providerID: String(input.member.providerID),
      modelID: String(input.member.modelID),
      worktreeDirectory: worktree.directory,
      worktreeBranch: worktree.branch,
      sessionID: result.sessionID,
      completed: !failMsg,
      verification: failMsg ? "fail" : verify.verification,
      verifyDetail: failMsg ? failMsg : `${verify.detail}; diff: ${diff.stat}`,
      riskScore,
      patchFingerprint: diff.fingerprint,
      summary: text.slice(0, 500) || diff.stat,
      error: failMsg,
    }
  } catch (err) {
    log.warn("arena implement contestant failed", {
      toolName: "arena",
      memberId: input.member.memberId,
      durationMs: Date.now() - started,
      status: "error",
      errorCode: err instanceof Error ? err.name : "Unknown",
    })
    return {
      id: input.member.memberId,
      providerID: String(input.member.providerID),
      modelID: String(input.member.modelID),
      worktreeDirectory: worktree?.directory,
      worktreeBranch: worktree?.branch,
      completed: false,
      verification: "fail",
      error: toErrorMessage(err),
    }
  }
}

export async function runImplementArena(input: {
  members: ImplementMember[]
  task: string
  context?: string
  parentSessionID: SessionID
  parentMessageID: MessageID
  agentName: string
  strategy: Arena.Strategy
  abort: AbortSignal
  timeoutMs?: number
}): Promise<{
  ranked: ImplementArena.RankedImplement[]
  results: ImplementArena.ContestantResult[]
  markdown: string
}> {
  // Parallel contestants — each isolated in its own worktree + Instance context
  const settled = await Promise.all(
    input.members.map((member) =>
      runImplementContestant({
        member,
        task: input.task,
        context: input.context,
        parentSessionID: input.parentSessionID,
        parentMessageID: input.parentMessageID,
        agentName: input.agentName,
        abort: input.abort,
        timeoutMs: input.timeoutMs,
      }),
    ),
  )

  const ranked = ImplementArena.rank(settled, input.strategy)
  const markdown = ImplementArena.renderMarkdown({
    task: input.task,
    ranked,
    strategy: input.strategy,
  })
  return { ranked, results: settled, markdown }
}

