/**
 * Worktree implement-arena orchestration (ADR-049 Phase 3).
 * Creates isolated worktrees, runs one agent per contestant, verifies, ranks.
 */

import { createHash } from "crypto"
import fs from "node:fs/promises"
import path from "node:path"
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
import { Env } from "../util/env"
import { git } from "../util/git"
import { Log } from "../util/log"
import { toErrorMessage } from "../util/error-message"
import { withTimeout } from "../util/timeout"
import { FanOut } from "../util/fan-out"

const log = Log.create({ service: "tool.arena-implement" })

const IMPLEMENT_TIMEOUT_MS = 12 * 60 * 1000
const VERIFY_TIMEOUT_MS = 5 * 60 * 1000

export type ImplementMember = {
  providerID: ProviderID
  modelID: ModelID
  memberId: string
}

function fingerprintDiff(diff: string): string {
  return createHash("sha256").update(diff).digest("hex").slice(0, 16)
}

function gitError(result: Awaited<ReturnType<typeof git>>, fallback: string): Error {
  const detail = result.stderr.toString().trim() || result.stdout.toString().trim()
  return new Error(detail ? `${fallback}: ${detail}` : fallback)
}

async function gitText(cwd: string, args: string[], fallback: string): Promise<string> {
  const result = await git(args, { cwd })
  if (result.exitCode !== 0) throw gitError(result, fallback)
  return result.stdout.toString().trim()
}

function statusPaths(raw: string): string[] {
  const entries = raw.split("\0").filter(Boolean)
  const paths: string[] = []
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]!
    if (entry.length < 3 || entry[2] !== " ") {
      paths.push(entry)
      continue
    }
    const status = entry.slice(0, 2)
    paths.push(entry.slice(3))
    if (!/[RC]/.test(status)) continue
    const source = entries[index + 1]
    if (source) paths.push(source)
    index++
  }
  return paths
}

async function attachSnapshotBranch(cwd: string, branch: string, commit: string): Promise<void> {
  const valid = await git(["check-ref-format", "--branch", branch], { cwd })
  if (valid.exitCode !== 0) throw gitError(valid, "Invalid arena snapshot branch")

  const current = await git(["symbolic-ref", "--quiet", "--short", "HEAD"], { cwd })
  if (current.exitCode !== 0 && current.exitCode !== 1) {
    throw gitError(current, "Failed to inspect contestant branch")
  }
  const currentBranch = current.exitCode === 0 ? current.stdout.toString().trim() : undefined
  const attached = await git(
    currentBranch === branch ? ["reset", "--hard", commit] : ["checkout", "--force", "-B", branch, commit],
    { cwd },
  )
  if (attached.exitCode !== 0) throw gitError(attached, "Failed to attach contestant snapshot branch")
}

export async function linkPrimaryNodeModules(primaryWorktree: string, contestantWorktree: string): Promise<boolean> {
  const source = path.join(primaryWorktree, "node_modules")
  const destination = path.join(contestantWorktree, "node_modules")
  const sourceExists = await fs
    .stat(source)
    .then((entry) => entry.isDirectory())
    .catch(() => false)
  if (!sourceExists) return false

  const destinationExists = await fs
    .lstat(destination)
    .then(() => true)
    .catch(() => false)
  if (destinationExists) return false

  const ignored = await git(["check-ignore", "--quiet", "--", "node_modules"], { cwd: contestantWorktree })
  if (ignored.exitCode !== 0) return false

  await fs.symlink(source, destination, process.platform === "win32" ? "junction" : "dir")
  return true
}

export type ImplementArenaBasePreflight =
  | { ok: true; baseCommit: string }
  | {
      ok: false
      reason: "not_git" | "no_base_commit" | "dirty_worktree"
      message: string
      changes: string[]
    }

export async function inspectImplementArenaBase(cwd: string): Promise<ImplementArenaBasePreflight> {
  const root = await git(["rev-parse", "--show-toplevel"], { cwd })
  if (root.exitCode !== 0) {
    return {
      ok: false,
      reason: "not_git",
      message: "Implement arena requires a git project.",
      changes: [],
    }
  }

  const head = await git(["rev-parse", "--verify", "HEAD"], { cwd })
  if (head.exitCode !== 0) {
    return {
      ok: false,
      reason: "no_base_commit",
      message: "Implement arena requires at least one git commit as a stable contestant base.",
      changes: [],
    }
  }
  const baseCommit = head.stdout.toString().trim()
  const status = await git(["status", "--porcelain=v1", "-z", "--untracked-files=all"], { cwd })
  if (status.exitCode !== 0) throw gitError(status, "Failed to inspect the primary worktree")
  const changes = statusPaths(status.stdout.toString())
  if (changes.length) {
    return {
      ok: false,
      reason: "dirty_worktree",
      message:
        "Implement arena requires a clean primary worktree because contestant worktrees start from a commit and cannot inherit uncommitted changes.",
      changes,
    }
  }
  return { ok: true, baseCommit }
}

export type ContestantPatchSnapshot = {
  hasChanges: boolean
  baseCommit: string
  commit?: string
  fingerprint?: string
  stat: string
  linesChanged: number
  changedFiles: number
}

export async function snapshotContestantPatch(input: {
  cwd: string
  baseCommit: string
  memberId: string
  targetBranch?: string
}): Promise<ContestantPatchSnapshot> {
  await gitText(
    input.cwd,
    ["cat-file", "-e", `${input.baseCommit}^{commit}`],
    "Arena base commit is no longer available",
  )

  const subject =
    input.memberId
      .replace(/[\r\n]+/g, " ")
      .trim()
      .slice(0, 72) || "contestant"
  const message = `chore(arena): snapshot ${subject}`
  const status = await git(["status", "--porcelain=v1", "-z", "--untracked-files=all"], { cwd: input.cwd })
  if (status.exitCode !== 0) throw gitError(status, "Failed to inspect contestant changes")
  if (status.stdout.length) {
    const added = await git(["add", "--all"], { cwd: input.cwd })
    if (added.exitCode !== 0) throw gitError(added, "Failed to stage contestant changes")

    const staged = await git(["diff", "--cached", "--quiet", "--exit-code"], { cwd: input.cwd })
    if (staged.exitCode === 1) {
      const committed = await git(
        [
          "-c",
          "user.name=AX Code Arena",
          "-c",
          "user.email=arena@ax-code.local",
          "-c",
          "commit.gpgSign=false",
          "commit",
          "--no-verify",
          "-m",
          message,
        ],
        { cwd: input.cwd },
      )
      if (committed.exitCode !== 0) throw gitError(committed, "Failed to commit contestant snapshot")
    } else if (staged.exitCode !== 0) {
      throw gitError(staged, "Failed to inspect staged contestant changes")
    }
  }

  const remaining = await git(["status", "--porcelain=v1", "-z", "--untracked-files=all"], { cwd: input.cwd })
  if (remaining.exitCode !== 0) throw gitError(remaining, "Failed to verify contestant snapshot")
  if (remaining.stdout.length) {
    throw new Error("Contestant snapshot left uncommitted changes in its worktree")
  }

  let commit = await gitText(input.cwd, ["rev-parse", "--verify", "HEAD"], "Failed to resolve snapshot commit")
  const diff = await git(["diff", "--binary", "--no-ext-diff", input.baseCommit, commit, "--"], { cwd: input.cwd })
  if (diff.exitCode !== 0) throw gitError(diff, "Failed to read contestant patch")
  const text = diff.stdout.toString()
  if (!text) {
    if (input.targetBranch) await attachSnapshotBranch(input.cwd, input.targetBranch, input.baseCommit)
    return {
      hasChanges: false,
      baseCommit: input.baseCommit,
      stat: "(no diff)",
      linesChanged: 0,
      changedFiles: 0,
    }
  }

  const descendant = await git(["merge-base", "--is-ancestor", input.baseCommit, commit], { cwd: input.cwd })
  if (descendant.exitCode !== 0 && descendant.exitCode !== 1) {
    throw gitError(descendant, "Failed to inspect contestant commit ancestry")
  }
  if (descendant.exitCode === 1) {
    const tree = await gitText(input.cwd, ["rev-parse", `${commit}^{tree}`], "Failed to resolve contestant tree")
    commit = await gitText(
      input.cwd,
      [
        "-c",
        "user.name=AX Code Arena",
        "-c",
        "user.email=arena@ax-code.local",
        "-c",
        "commit.gpgSign=false",
        "commit-tree",
        tree,
        "-p",
        input.baseCommit,
        "-m",
        message,
      ],
      "Failed to create a base-anchored contestant snapshot",
    )
  }
  if (input.targetBranch) await attachSnapshotBranch(input.cwd, input.targetBranch, commit)

  const [stat, numstat, names] = await Promise.all([
    git(["diff", "--stat", input.baseCommit, commit, "--"], { cwd: input.cwd }),
    git(["diff", "--numstat", "-z", input.baseCommit, commit, "--"], { cwd: input.cwd }),
    git(["diff", "--name-only", "-z", input.baseCommit, commit, "--"], { cwd: input.cwd }),
  ])
  if (stat.exitCode !== 0) throw gitError(stat, "Failed to summarize contestant patch")
  if (numstat.exitCode !== 0) throw gitError(numstat, "Failed to count contestant patch lines")
  if (names.exitCode !== 0) throw gitError(names, "Failed to list contestant patch files")

  const linesChanged = numstat.stdout
    .toString()
    .split("\0")
    .filter(Boolean)
    .reduce((total, row) => {
      const [added, removed] = row.split("\t")
      const addCount = added === "-" ? 200 : Number.parseInt(added ?? "0", 10) || 0
      const removeCount = removed === "-" ? 200 : Number.parseInt(removed ?? "0", 10) || 0
      return total + addCount + removeCount
    }, 0)

  return {
    hasChanges: true,
    baseCommit: input.baseCommit,
    commit,
    fingerprint: fingerprintDiff(text),
    stat: stat.stdout.toString().trim() || "(no diff)",
    linesChanged,
    changedFiles: names.stdout.toString().split("\0").filter(Boolean).length,
  }
}

function throwIfAborted(abort: AbortSignal): void {
  if (!abort.aborted) return
  if (abort.reason instanceof Error) throw abort.reason
  throw new DOMException("Aborted", "AbortError")
}

async function runVerification(
  cwd: string,
  abort: AbortSignal,
): Promise<{
  verification: Arena.Verification
  detail: string
}> {
  try {
    throwIfAborted(abort)
    const preferred = await VerificationPolicy.resolvePreferredCommands(cwd)
    throwIfAborted(abort)
    const commands = [...new Set(preferred.preferred)]
    if (!commands.length) {
      // Fall back: typecheck/test if present
      const fallback = [preferred.typecheck, preferred.test, preferred.lint].filter(Boolean) as string[]
      if (!fallback.length) {
        return { verification: "unknown", detail: "no project verification commands detected" }
      }
      commands.push(...new Set(fallback))
    }

    const details: string[] = []
    let anyFail = false
    let anyPass = false
    for (const cmd of commands) {
      throwIfAborted(abort)
      const ran = await Process.run(process.platform === "win32" ? ["cmd", "/c", cmd] : ["bash", "-lc", cmd], {
        cwd,
        abort,
        env: Env.sanitize(),
        nothrow: true,
        timeout: VERIFY_TIMEOUT_MS,
      }).catch(() => ({ code: 1 as number, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }))
      const code = typeof ran.code === "number" ? ran.code : 1
      const ok = code === 0
      if (ok) anyPass = true
      else anyFail = true
      const diagnostic = (ran.stderr.length ? ran.stderr : ran.stdout)
        .toString()
        .trim()
        .split("\n")
        .find(Boolean)
        ?.replace(/[\r\0]/g, " ")
        .slice(0, 300)
      details.push(`${ok ? "pass" : "fail"}: ${cmd} (exit ${code})${diagnostic ? ` — ${diagnostic}` : ""}`)
    }
    throwIfAborted(abort)
    if (anyPass && !anyFail) return { verification: "pass", detail: details.join("; ") }
    if (anyFail && !anyPass) return { verification: "fail", detail: details.join("; ") }
    if (anyPass && anyFail) return { verification: "fail", detail: details.join("; ") }
    return { verification: "unknown", detail: details.join("; ") || "no checks run" }
  } catch (err) {
    if (abort.aborted) throw err
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
  baseCommit: string
  agentName: string
  abort: AbortSignal
  timeoutMs?: number
}): Promise<ImplementArena.ContestantResult> {
  const timeoutMs = input.timeoutMs ?? IMPLEMENT_TIMEOUT_MS
  const started = Date.now()
  const primaryWorktree = Instance.worktree
  let worktree: Awaited<ReturnType<typeof Worktree.createReady>> | undefined
  let contestantSessionID: SessionID | undefined

  try {
    throwIfAborted(input.abort)
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
    worktree = await Worktree.createReady({
      name: `arena-${slug}-${Date.now().toString(36)}`,
      startPoint: input.baseCommit,
    })
    throwIfAborted(input.abort)

    const actualBase = await gitText(
      worktree.directory,
      ["rev-parse", "--verify", "HEAD"],
      "Failed to resolve contestant base commit",
    )
    if (actualBase !== input.baseCommit) {
      throw new Error(`Contestant worktree started from ${actualBase}, expected ${input.baseCommit}`)
    }
    const readyStatus = await git(["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
      cwd: worktree.directory,
    })
    if (readyStatus.exitCode !== 0) throw gitError(readyStatus, "Failed to inspect ready contestant worktree")
    if (readyStatus.stdout.length) {
      throw new Error("Worktree start scripts left uncommitted changes before the contestant began")
    }
    await linkPrimaryNodeModules(primaryWorktree, worktree.directory).catch((error) => {
      log.warn("failed to link primary node_modules into arena worktree", {
        directory: worktree?.directory,
        error: toErrorMessage(error),
      })
    })

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
            { permission: "question", pattern: "*", action: "deny" },
            { permission: "external_directory", pattern: "*", action: "deny" },
          ],
        })
        contestantSessionID = session.id

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
        const cancel = () => SessionPrompt.cancel(session.id)
        const onAbort = () => void cancel().catch(() => undefined)
        input.abort.addEventListener("abort", onAbort, { once: true })
        try {
          throwIfAborted(input.abort)
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
                question: false,
                create_goal: false,
                update_goal: false,
                memory_save: false,
                register_finding: false,
              },
              parts,
            }),
            timeoutMs,
            `Arena contestant timed out after ${timeoutMs / 60_000} minutes`,
          )
          return { sessionID: session.id, promptResult }
        } catch (error) {
          await cancel().catch((cancelError) => {
            log.warn("failed to cancel arena contestant", {
              memberId: input.member.memberId,
              sessionID: session.id,
              error: toErrorMessage(cancelError),
            })
          })
          throw error
        } finally {
          input.abort.removeEventListener("abort", onAbort)
        }
      },
    })

    throwIfAborted(input.abort)

    const failMsg = assistantFailed(result.promptResult)
    const text = assistantText(result.promptResult)
    let snapshot = await snapshotContestantPatch({
      cwd: worktree.directory,
      baseCommit: input.baseCommit,
      memberId: input.member.memberId,
      targetBranch: worktree.branch,
    })
    const noPatch = snapshot.hasChanges ? undefined : "Contestant completed without producing a patch"
    const verify = snapshot.hasChanges
      ? await runVerification(worktree.directory, input.abort)
      : { verification: "fail" as const, detail: "verification skipped because no patch was produced" }
    const verifiedFingerprint = snapshot.fingerprint
    if (snapshot.hasChanges) {
      snapshot = await snapshotContestantPatch({
        cwd: worktree.directory,
        baseCommit: input.baseCommit,
        memberId: input.member.memberId,
        targetBranch: worktree.branch,
      })
    }
    const verificationMutation =
      verifiedFingerprint && snapshot.fingerprint !== verifiedFingerprint
        ? "Verification commands modified the contestant worktree; the resulting patch is not verified"
        : undefined
    const error = failMsg ?? noPatch ?? verificationMutation
    const verification: Arena.Verification = error ? "fail" : verify.verification
    const riskScore = snapshot.hasChanges ? Math.min(20, Math.max(1, Math.round(snapshot.linesChanged / 20))) : 20

    log.info("arena implement contestant done", {
      toolName: "arena",
      memberId: input.member.memberId,
      durationMs: Date.now() - started,
      status: error ? "error" : "ok",
      verification,
    })

    return {
      id: input.member.memberId,
      providerID: String(input.member.providerID),
      modelID: String(input.member.modelID),
      worktreeDirectory: worktree.directory,
      worktreeBranch: worktree.branch,
      sessionID: result.sessionID,
      completed: !error,
      verification,
      verifyDetail: error
        ? `${error}; ${verify.detail}; diff: ${snapshot.stat}`
        : `${verify.detail}; diff: ${snapshot.stat}`,
      riskScore,
      changedFiles: snapshot.changedFiles,
      patchFingerprint: snapshot.fingerprint,
      baseCommit: snapshot.baseCommit,
      commit: snapshot.commit,
      summary: text.slice(0, 500) || snapshot.stat,
      error,
    }
  } catch (err) {
    let partial: ContestantPatchSnapshot | undefined
    if (input.abort.aborted && worktree) {
      const directory = worktree.directory
      const removed = await Worktree.remove({ directory })
        .then(() => true)
        .catch((cleanupError) => {
          log.warn("failed to remove aborted arena contestant worktree", {
            directory,
            error: toErrorMessage(cleanupError),
          })
          return false
        })
      if (removed) worktree = undefined
      if (contestantSessionID) {
        await Session.remove(contestantSessionID).catch((cleanupError) => {
          log.warn("failed to remove aborted arena contestant session", {
            sessionID: contestantSessionID,
            error: toErrorMessage(cleanupError),
          })
        })
        contestantSessionID = undefined
      }
    } else if (worktree) {
      partial = await snapshotContestantPatch({
        cwd: worktree.directory,
        baseCommit: input.baseCommit,
        memberId: input.member.memberId,
        targetBranch: worktree.branch,
      }).catch((snapshotError) => {
        log.warn("failed to preserve partial arena contestant patch", {
          directory: worktree?.directory,
          error: toErrorMessage(snapshotError),
        })
        return undefined
      })
    }
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
      sessionID: contestantSessionID,
      completed: false,
      verification: "fail",
      verifyDetail: "Contestant stopped before verification completed",
      riskScore: partial?.hasChanges ? Math.min(20, Math.max(1, Math.round(partial.linesChanged / 20))) : 20,
      changedFiles: partial?.changedFiles,
      patchFingerprint: partial?.fingerprint,
      baseCommit: partial?.baseCommit ?? input.baseCommit,
      commit: partial?.commit,
      error: toErrorMessage(err),
    }
  }
}

export async function runImplementArena(input: {
  members: ImplementMember[]
  task: string
  context?: string
  parentSessionID: SessionID
  baseCommit: string
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
  // Concurrency capped at 2 to reduce disk/memory pressure from parallel worktree operations.
  const fanOutResults = await FanOut.run({
    members: input.members,
    concurrency: 2,
    timeoutMs: (input.timeoutMs ?? IMPLEMENT_TIMEOUT_MS) + 60_000,
    abort: input.abort,
    execute: async (member, signal) => {
      return runImplementContestant({
        member,
        task: input.task,
        context: input.context,
        parentSessionID: input.parentSessionID,
        baseCommit: input.baseCommit,
        agentName: input.agentName,
        abort: signal,
        timeoutMs: input.timeoutMs,
      })
    },
  })
  const settled = fanOutResults.map((r, i) => {
    if (r.result) return r.result
    // FanOut caught an error — synthesise a failed ContestantResult so ranking
    // never receives `undefined` (which would crash ImplementArena.rank).
    const member = input.members[i]!
    return {
      id: member.memberId,
      providerID: String(member.providerID),
      modelID: String(member.modelID),
      completed: false,
      verification: "fail" as const,
      error: r.error ?? "Contestant failed",
      summary: r.error ?? "Contestant failed",
      baseCommit: input.baseCommit,
    } satisfies ImplementArena.ContestantResult
  })
  throwIfAborted(input.abort)

  const ranked = ImplementArena.rank(settled, input.strategy)
  const markdown = ImplementArena.renderMarkdown({
    task: input.task,
    ranked,
    strategy: input.strategy,
  })
  return { ranked, results: settled, markdown }
}
