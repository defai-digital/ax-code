import fs from "fs/promises"
import path from "path"
import z from "zod"
import { NamedError } from "@ax-code/util/error"
import { Global } from "../global"
import { Instance } from "../project/instance"
import { InstanceBootstrap } from "../project/bootstrap"
import { Project } from "../project/project"
import type { ProjectID } from "../project/schema"
import { fn } from "../util/fn"
import { Log } from "../util/log"
import { Process } from "../util/process"
import { git } from "../util/git"
import { Filesystem } from "../util/filesystem"
import { toErrorMessage } from "../util/error-message"
import { BusEvent } from "@/bus/bus-event"
import { GlobalBus } from "@/bus/global"

export namespace Worktree {
  const log = Log.create({ service: "worktree" })

  export const Event = {
    Ready: BusEvent.define(
      "worktree.ready",
      z.object({
        name: z.string(),
        branch: z.string(),
      }),
    ),
    Failed: BusEvent.define(
      "worktree.failed",
      z.object({
        message: z.string(),
      }),
    ),
  }

  export const Info = z
    .object({
      name: z.string(),
      branch: z.string(),
      directory: z.string(),
    })
    .meta({
      ref: "Worktree",
    })

  export type Info = z.infer<typeof Info>

  export const ListItem = z
    .object({
      name: z.string(),
      directory: z.string(),
      branch: z.string().optional(),
    })
    .meta({
      ref: "WorktreeListItem",
    })

  export type ListItem = z.infer<typeof ListItem>

  const StartPoint = z
    .string()
    .min(1)
    .max(1024)
    .refine((value) => !value.startsWith("-"), "Git revision cannot start with '-'")

  const BranchName = z
    .string()
    .min(1)
    .max(255)
    .refine((value) => !value.startsWith("-"), "Branch name cannot start with '-'")

  // ADR-260: clients choose the branch, its start point, or an existing branch
  // to borrow, and can retry a create safely with an operation ID.
  export const CreateInput = z
    .object({
      name: z.string().optional(),
      startCommand: z
        .string()
        .optional()
        .describe("Additional startup script to run after the project's start command"),
      branch: BranchName.optional().describe("Name of the new branch. Defaults to ax-code/<name>."),
      startRef: StartPoint.optional().describe("Start point of the new branch. Defaults to HEAD."),
      existingBranch: BranchName.optional().describe(
        "Check out this existing local branch instead of creating one. AX Code never deletes or resets it.",
      ),
      operationId: z
        .string()
        .min(1)
        .max(128)
        .optional()
        .describe("Idempotency key: repeating a create with the same ID returns the first result."),
    })
    .meta({
      ref: "WorktreeCreateInput",
    })

  export type CreateInput = z.infer<typeof CreateInput>

  const CreateReadyInput = CreateInput.extend({
    startPoint: StartPoint.optional(),
  })

  export const RemoveInput = z
    .object({
      directory: z.string(),
    })
    .meta({
      ref: "WorktreeRemoveInput",
    })

  export type RemoveInput = z.infer<typeof RemoveInput>

  export const ResetInput = z
    .object({
      directory: z.string(),
    })
    .meta({
      ref: "WorktreeResetInput",
    })

  export type ResetInput = z.infer<typeof ResetInput>

  export const NotGitError = NamedError.create(
    "WorktreeNotGitError",
    z.object({
      message: z.string(),
    }),
  )

  export const NameGenerationFailedError = NamedError.create(
    "WorktreeNameGenerationFailedError",
    z.object({
      message: z.string(),
    }),
  )

  export const CreateFailedError = NamedError.create(
    "WorktreeCreateFailedError",
    z.object({
      message: z.string(),
    }),
  )

  export const StartCommandFailedError = NamedError.create(
    "WorktreeStartCommandFailedError",
    z.object({
      message: z.string(),
    }),
  )

  export const RemoveFailedError = NamedError.create(
    "WorktreeRemoveFailedError",
    z.object({
      message: z.string(),
    }),
  )

  export const ResetFailedError = NamedError.create(
    "WorktreeResetFailedError",
    z.object({
      message: z.string(),
    }),
  )

  const ADJECTIVES = [
    "brave",
    "calm",
    "clever",
    "cosmic",
    "crisp",
    "curious",
    "eager",
    "gentle",
    "glowing",
    "happy",
    "hidden",
    "jolly",
    "kind",
    "lucky",
    "mighty",
    "misty",
    "neon",
    "nimble",
    "playful",
    "proud",
    "quick",
    "quiet",
    "shiny",
    "silent",
    "stellar",
    "sunny",
    "swift",
    "tidy",
    "witty",
  ] as const

  const NOUNS = [
    "cabin",
    "cactus",
    "canyon",
    "circuit",
    "comet",
    "eagle",
    "engine",
    "falcon",
    "forest",
    "garden",
    "harbor",
    "island",
    "knight",
    "lagoon",
    "meadow",
    "moon",
    "mountain",
    "nebula",
    "orchid",
    "otter",
    "panda",
    "pixel",
    "planet",
    "river",
    "rocket",
    "sailor",
    "squid",
    "star",
    "tiger",
    "wizard",
    "wolf",
  ] as const

  function pick<const T extends readonly string[]>(list: T) {
    return list[Math.floor(Math.random() * list.length)]
  }

  function slug(input: string) {
    return input
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+/, "")
      .replace(/-+$/, "")
  }

  function randomName() {
    return `${pick(ADJECTIVES)}-${pick(NOUNS)}`
  }

  async function exists(target: string) {
    return fs
      .stat(target)
      .then(() => true)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return false
        throw error
      })
  }

  function outputText(input: Uint8Array | undefined) {
    if (!input?.length) return ""
    return new TextDecoder().decode(input).trim()
  }

  function errorText(result: { stdout?: Uint8Array; stderr?: Uint8Array }) {
    return [outputText(result.stderr), outputText(result.stdout)].filter(Boolean).join("\n")
  }

  function failed(result: { stdout?: Uint8Array; stderr?: Uint8Array }) {
    return [outputText(result.stderr), outputText(result.stdout)].filter(Boolean).flatMap((chunk) =>
      chunk
        .split("\n")
        .map((line) => line.trim())
        .flatMap((line) => {
          const match = line.match(/^warning:\s+failed to remove\s+(.+):\s+/i)
          if (!match) return []
          const value = match[1]?.trim().replace(/^['"]|['"]$/g, "")
          if (!value) return []
          return [value]
        }),
    )
  }

  /** Exported for tests: delete leftovers `git clean` reported it could not remove. */
  export async function prune(root: string, entries: string[]) {
    const base = await canonical(root)
    await Promise.all(
      entries.map(async (entry) => {
        // Contain by the canonical parent but delete the entry's own path:
        // canonicalizing the entry itself follows a symlink, and removing the
        // resolved target would recursively delete the tree it points at.
        const target = path.resolve(root, entry)
        const parent = await canonical(path.dirname(target))
        if (parent !== base && !parent.startsWith(`${base}${path.sep}`)) return
        if (path.basename(target) === "" || target === path.resolve(root)) return
        await fs
          .rm(path.join(await realOnDiskPath(path.dirname(target)), path.basename(target)), {
            recursive: true,
            force: true,
          })
          .catch(() => undefined)
      }),
    )
  }

  async function sweep(root: string) {
    const first = await git(["clean", "-ffdx"], { cwd: root })
    if (first.exitCode === 0) return first

    const entries = failed(first)
    if (!entries.length) return first

    await prune(root, entries)
    return git(["clean", "-ffdx"], { cwd: root })
  }

  async function canonical(input: string) {
    const abs = path.resolve(input)
    const real = await fs.realpath(abs).catch(() => abs)
    const normalized = path.normalize(real)
    return process.platform === "win32" || process.platform === "darwin" ? normalized.toLowerCase() : normalized
  }

  /**
   * Realpath WITHOUT the case folding `canonical()` applies. Instance cache keys
   * come from `Filesystem.resolve` (case-preserving), so only this spelling can
   * match them; the lowercased form is for comparison keys (git, sandboxes).
   */
  async function realOnDiskPath(input: string) {
    const abs = path.resolve(input)
    const real = await fs.realpath(abs).catch(() => abs)
    return path.normalize(real)
  }

  function worktreeName(directory: string) {
    return path.basename(directory) || directory
  }

  async function worktreeBranchMap() {
    const result = await git(["worktree", "list", "--porcelain"], { cwd: Instance.worktree })
    if (result.exitCode !== 0) {
      log.warn("failed to read git worktree list", { message: errorText(result) })
      return new Map<string, string>()
    }

    const map = new Map<string, string>()
    const entries = outputText(result.stdout)
      .split("\n")
      .map((line) => line.trim())
      .reduce<{ path?: string; branch?: string }[]>((acc, line) => {
        if (!line) return acc
        if (line.startsWith("worktree ")) {
          acc.push({ path: line.slice("worktree ".length).trim() })
          return acc
        }
        const current = acc[acc.length - 1]
        if (!current) return acc
        if (line.startsWith("branch ")) {
          current.branch = line
            .slice("branch ".length)
            .trim()
            .replace(/^refs\/heads\//, "")
        }
        return acc
      }, [])

    for (const entry of entries) {
      if (!entry.path || !entry.branch) continue
      map.set(await canonical(entry.path), entry.branch)
    }
    return map
  }

  export async function list(): Promise<ListItem[]> {
    const sandboxes = await Project.sandboxes(Instance.project.id)
    const branches = Instance.project.vcs === "git" ? await worktreeBranchMap() : new Map<string, string>()
    const items = await Promise.all(
      sandboxes.map(async (sandbox) => {
        // Compare against the branch map by the case-folded key, but RETURN the
        // recorded spelling: clients send it back as `x-ax-code-directory`, and
        // Instance keys on the case-preserving Filesystem.resolve, so a
        // lowercased value boots a second Instance for the same directory.
        const branch = branches.get(await canonical(sandbox))
        return ListItem.parse({
          directory: sandbox,
          name: worktreeName(sandbox),
          ...(branch ? { branch } : {}),
        })
      }),
    )
    return items
  }

  type BranchChoice = { branch?: string; existingBranch?: string }

  async function candidate(root: string, base?: string, choice: BranchChoice = {}) {
    for (const attempt of Array.from({ length: 26 }, (_, i) => i)) {
      // Use randomName for all non-first attempts to reduce TOCTOU collision window
      const name = base ? (attempt === 0 ? base : `${base}-${randomName()}`) : randomName()
      const branch = choice.existingBranch ?? choice.branch ?? `ax-code/${name}`
      const directory = path.join(root, name)

      if (await exists(directory)) continue

      if (!choice.existingBranch) {
        const ref = `refs/heads/${branch}`
        const branchCheck = await git(["show-ref", "--verify", "--quiet", ref], {
          cwd: Instance.worktree,
        })
        if (branchCheck.exitCode === 0) {
          // A caller-chosen name is not renamed behind its back.
          if (choice.branch) throw new CreateFailedError({ message: `Branch ${branch} already exists` })
          continue
        }
      }

      // Attempt to create the directory atomically to close the TOCTOU window.
      // If another process created it between our exists() check and now, mkdir
      // throws EEXIST and we retry with a new name.
      try {
        await fs.mkdir(directory, { recursive: false })
      } catch (e: unknown) {
        if ((e as { code?: string }).code === "EEXIST") continue
        throw e
      }

      return Info.parse({ name, branch, directory })
    }

    throw new NameGenerationFailedError({ message: "Failed to generate a unique worktree name" })
  }

  async function runStartCommand(directory: string, cmd: string) {
    if (process.platform === "win32") {
      return Process.run(["cmd", "/c", cmd], { cwd: directory, nothrow: true })
    }
    return Process.run(["bash", "-c", cmd], { cwd: directory, nothrow: true })
  }

  type StartKind = "project" | "worktree"

  async function runStartScript(directory: string, cmd: string, kind: StartKind) {
    const text = cmd.trim()
    if (!text) return true

    const ran = await runStartCommand(directory, text)
    if (ran.code === 0) return true

    log.error("worktree start command failed", {
      kind,
      directory,
      message: errorText(ran),
    })
    return false
  }

  export async function runStartScripts(directory: string, input: { projectID: ProjectID; extra?: string }) {
    const project = Project.get(input.projectID)
    const startup = project?.commands?.start?.trim() ?? ""
    const ok = await runStartScript(directory, startup, "project")
    if (!ok) return false

    const extra = input.extra ?? ""
    return runStartScript(directory, extra, "worktree")
  }

  function cancelTimers(directory: string) {
    const timers = startScriptTimers.get(directory)
    if (!timers) return
    for (const timer of timers) clearTimeout(timer)
    startScriptTimers.delete(directory)
  }

  function trackTimer(directory: string, timer: ReturnType<typeof setTimeout>) {
    const timers = startScriptTimers.get(directory) ?? new Set<ReturnType<typeof setTimeout>>()
    timers.add(timer)
    startScriptTimers.set(directory, timers)
  }

  function releaseTimer(directory: string, timer: ReturnType<typeof setTimeout>) {
    const timers = startScriptTimers.get(directory)
    if (!timers) return
    timers.delete(timer)
    if (timers.size === 0) startScriptTimers.delete(directory)
  }

  function queueStartScripts(directory: string, input: { projectID: ProjectID; extra?: string }) {
    // Defer start-scripts to the next tick so the caller sees the
    // worktree info synchronously before hooks run. The callback is
    // tracked so dispose() / remove() can cancel it — previously it
    // was a pure fire-and-forget that could fire against a worktree
    // the user had already removed. `.unref()` keeps the event loop
    // from being held open by a pending timer after all other work
    // is done.
    const timer = setTimeout(() => {
      releaseTimer(directory, timer)
      const start = async () => {
        await runStartScripts(directory, input)
      }

      void start().catch((error) => {
        log.error("worktree start task failed", { directory, error })
      })
    }, 0)
    timer.unref?.()
    trackTimer(directory, timer)
  }

  // Pending start-script timers, tracked so cleanup paths can cancel
  // them before they fire against a worktree that has already been
  // torn down.
  const startScriptTimers = new Map<string, Set<ReturnType<typeof setTimeout>>>()

  /**
   * Cancel all pending worktree start-script timers. Called from
   * `remove()` so a rapid create/remove cycle does not execute the
   * start script against a now-deleted directory.
   */
  export function cancelPendingStartScripts(directory?: string) {
    if (directory) {
      cancelTimers(directory)
      return
    }
    for (const [key] of startScriptTimers) cancelTimers(key)
  }

  export async function makeWorktreeInfo(name?: string, choice: BranchChoice = {}): Promise<Info> {
    if (Instance.project.vcs !== "git") {
      throw new NotGitError({ message: "Worktrees are only supported for git projects" })
    }

    const root = path.join(Global.Path.data, "worktree", Instance.project.id)
    await fs.mkdir(root, { recursive: true })

    const base = name ? slug(name) : ""
    return candidate(root, base || undefined, choice)
  }

  // ADR-260: branch ownership lives in the repository's git config, which git
  // writes under its own lock and drops when the branch is deleted. Removal and
  // reset act only on branches AX Code positively owns, so a lost or unreadable
  // marker leaves a branch behind instead of deleting the user's work.
  const OWNED_KEY = "axCodeOwned"
  const BORROWED_KEY = "axCodeBorrowed"

  // A flag's value is the branch name it was written for: `git branch -c`
  // copies branch config, and a copied flag must not transfer to the copy.
  type FlagState = "set" | "absent" | "unknown"

  async function branchFlag(branch: string, key: string, cwd: string = Instance.worktree): Promise<FlagState> {
    const read = await git(["config", "--get", `branch.${branch}.${key}`], { cwd })
    // `git config --get` exits 1 only when the key is missing; anything else is
    // an unreadable or invalid config and must not be read as "not borrowed".
    if (read.exitCode === 1) return "absent"
    if (read.exitCode !== 0) return "unknown"
    return outputText(read.stdout).trim() === branch ? "set" : "unknown"
  }

  async function setBranchFlag(branch: string, key: string, cwd: string = Instance.worktree) {
    const written = await git(["config", `branch.${branch}.${key}`, branch], { cwd })
    if (written.exitCode !== 0) {
      throw new CreateFailedError({ message: errorText(written) || `Failed to mark branch ${branch}` })
    }
  }

  /** The branch a worktree borrowed from the user, if its checkout is marked borrowed (ADR-260). */
  export async function borrowedBranch(directory: string): Promise<string | undefined> {
    const head = await git(["symbolic-ref", "--quiet", "--short", "HEAD"], { cwd: directory }).catch(() => undefined)
    const branch = head && head.exitCode === 0 ? outputText(head.stdout).trim() : ""
    if (!branch) return undefined
    return (await branchFlag(branch, BORROWED_KEY)) === "set" ? branch : undefined
  }

  /**
   * Whether AX Code may delete or reset `branch` (ADR-260). It must provably not be borrowed: any borrowed flag, or an
   * unreadable one, denies. Branches AX Code created carry the owned flag; the `ax-code/` and `opencode/` prefixes cover
   * branches created before the flag existed.
   */
  export async function ownsBranch(branch: string | undefined, cwd: string = Instance.worktree) {
    if (!branch) return false
    if ((await branchFlag(branch, BORROWED_KEY, cwd)) !== "absent") return false
    const owned = await branchFlag(branch, OWNED_KEY, cwd)
    if (owned === "set") return true
    if (owned === "unknown") return false
    return branch.startsWith("ax-code/") || branch.startsWith("opencode/")
  }

  // Serializes ownership decisions with borrowing and branch deletion inside
  // this process, so a branch cannot be borrowed between remove()'s ownership
  // check and its `git branch -D`. Separate processes are not coordinated.
  const branchLocks = new Map<string, Promise<unknown>>()

  async function withBranchLock<T>(task: () => Promise<T>): Promise<T> {
    const key = Instance.worktree
    const previous = branchLocks.get(key) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(task)
    branchLocks.set(key, next)
    try {
      return await next
    } finally {
      if (branchLocks.get(key) === next) branchLocks.delete(key)
    }
  }

  export async function createFromInfo(
    info: Info,
    startCommand?: string,
    startPoint?: string,
    options: { borrowed?: boolean } = {},
  ) {
    const args = options.borrowed
      ? ["worktree", "add", "--no-checkout", info.directory, info.branch]
      : ["worktree", "add", "--no-checkout", "-b", info.branch, info.directory]
    if (startPoint && !options.borrowed) args.push(StartPoint.parse(startPoint))
    // Mark a borrowed branch before git publishes the worktree, so no window
    // exists in which it could be treated as owned. A mark this call added is
    // withdrawn when git refuses the worktree (for example the branch is
    // checked out elsewhere), so a failed borrow does not pin the branch. The
    // owned mark is written under the same lock, right after git creates the
    // branch.
    const created = await withBranchLock(async () => {
      const markedHere = options.borrowed && (await branchFlag(info.branch, BORROWED_KEY)) === "absent"
      if (options.borrowed) await setBranchFlag(info.branch, BORROWED_KEY)
      const result = await git(args, { cwd: Instance.worktree })
      if (result.exitCode !== 0) {
        if (markedHere)
          await git(["config", "--unset", `branch.${info.branch}.${BORROWED_KEY}`], { cwd: Instance.worktree })
        return result
      }
      // A failure here is retried and surfaced below, outside the lock.
      if (!options.borrowed) await setBranchFlag(info.branch, OWNED_KEY).catch(() => undefined)
      return result
    })
    if (created.exitCode !== 0) {
      throw new CreateFailedError({ message: errorText(created) || "Failed to create git worktree" })
    }

    try {
      // Unflagged, a new non-prefixed branch would merely be kept on removal;
      // verify the mark so ownership stays exact.
      if (!options.borrowed && (await branchFlag(info.branch, OWNED_KEY)) !== "set") {
        await setBranchFlag(info.branch, OWNED_KEY)
      }
      await Project.addSandbox(Instance.project.id, info.directory)
    } catch (err) {
      log.warn("failed to record worktree in database; rolling back git worktree", {
        directory: info.directory,
        error: toErrorMessage(err),
      })
      const removed = await git(["worktree", "remove", "--force", info.directory], { cwd: Instance.worktree })
      if (removed.exitCode !== 0) {
        log.error("failed to roll back untracked worktree", {
          directory: info.directory,
          message: errorText(removed) || "git worktree remove failed",
        })
      }
      if (!options.borrowed && removed.exitCode === 0) {
        const deletedBranch = await git(["branch", "-D", info.branch], { cwd: Instance.worktree })
        if (deletedBranch.exitCode !== 0) {
          log.warn("failed to delete rolled-back worktree branch", {
            branch: info.branch,
            message: errorText(deletedBranch) || "git branch delete failed",
          })
        }
      }
      await fs.rm(info.directory, { recursive: true, force: true }).catch((removeError) => {
        log.warn("failed to remove rolled-back worktree directory", {
          directory: info.directory,
          error: toErrorMessage(removeError),
        })
      })
      throw new CreateFailedError({
        message: `Failed to record worktree in database: ${toErrorMessage(err)}`,
      })
    }

    const projectID = Instance.project.id
    const extra = startCommand?.trim()

    return () => {
      const start = async () => {
        const populated = await git(["reset", "--hard"], { cwd: info.directory })
        if (populated.exitCode !== 0) {
          const message = errorText(populated) || "Failed to populate worktree"
          log.error("worktree checkout failed", { directory: info.directory, message })
          GlobalBus.emit("event", {
            directory: info.directory,
            payload: {
              type: Event.Failed.type,
              properties: {
                message,
              },
            },
          })
          return false
        }

        const booted = await Instance.provide({
          directory: info.directory,
          init: InstanceBootstrap,
          fn: () => undefined,
        })
          .then(() => true)
          .catch((error) => {
            const message = NamedError.message(error)
            log.error("worktree bootstrap failed", { directory: info.directory, message })
            GlobalBus.emit("event", {
              directory: info.directory,
              payload: {
                type: Event.Failed.type,
                properties: {
                  message,
                },
              },
            })
            return false
          })
        if (!booted) return false

        const started = await runStartScripts(info.directory, { projectID, extra })
        if (!started) {
          GlobalBus.emit("event", {
            directory: info.directory,
            payload: {
              type: Event.Failed.type,
              properties: {
                message: "Worktree start command failed",
              },
            },
          })
          return false
        }

        GlobalBus.emit("event", {
          directory: info.directory,
          payload: {
            type: Event.Ready.type,
            properties: {
              name: info.name,
              branch: info.branch,
            },
          },
        })
        return true
      }

      return start().catch((error) => {
        log.error("worktree start task failed", { directory: info.directory, error })
        // Clients wait for ready or failed; an unexpected throw must still
        // settle them like the handled failure paths above.
        GlobalBus.emit("event", {
          directory: info.directory,
          payload: {
            type: Event.Failed.type,
            properties: {
              message: NamedError.message(error) || "Worktree start task failed",
            },
          },
        })
        return false
      })
    }
  }

  async function validateBranchChoice(input: CreateInput | undefined, startPoint?: string) {
    if (input?.existingBranch && (input.branch || startPoint)) {
      throw new CreateFailedError({ message: "existingBranch cannot be combined with branch or startRef" })
    }
    for (const name of [input?.branch, input?.existingBranch]) {
      if (!name) continue
      const valid = await git(["check-ref-format", "--branch", name], { cwd: Instance.worktree })
      if (valid.exitCode !== 0) throw new CreateFailedError({ message: `Invalid branch name: ${name}` })
    }
    if (input?.existingBranch) {
      const found = await git(["show-ref", "--verify", "--quiet", `refs/heads/${input.existingBranch}`], {
        cwd: Instance.worktree,
      })
      if (found.exitCode !== 0) {
        throw new CreateFailedError({ message: `Branch ${input.existingBranch} does not exist` })
      }
    }
  }

  async function prepareCreate(input: CreateInput | undefined, startPoint?: string) {
    if (Instance.project.vcs !== "git") {
      throw new NotGitError({ message: "Worktrees are only supported for git projects" })
    }
    await validateBranchChoice(input, startPoint)
    const borrowed = Boolean(input?.existingBranch)
    const info = await makeWorktreeInfo(input?.name, { branch: input?.branch, existingBranch: input?.existingBranch })
    const bootstrap = await createFromInfo(info, input?.startCommand, startPoint, { borrowed }).catch(async (error) => {
      await fs.rm(info.directory, { recursive: true, force: true }).catch((cleanupError) => {
        log.warn("failed to clean up failed worktree creation", {
          directory: info.directory,
          error: toErrorMessage(cleanupError),
        })
      })
      throw error
    })
    return { info, bootstrap }
  }

  // ADR-260: creates keyed by client operation ID, newest last, bounded.
  const MAX_OPERATIONS = 256
  const operations = new Map<string, { request: string; pending: Promise<Info> }>()
  const settledOperations = new Set<string>()

  // The request an operation ID was first used with: reusing the ID for a
  // different worktree is a caller bug, not a retry.
  function operationRequest(input: CreateInput) {
    const { operationId: _operationId, ...request } = input
    return JSON.stringify(
      Object.keys(request)
        .sort()
        .map((key) => [key, request[key as keyof typeof request]]),
    )
  }

  async function forgetOperationsFor(directory: string) {
    const key = await canonical(directory)
    for (const [id, entry] of operations) {
      const info = await entry.pending.catch(() => undefined)
      if (info && (await canonical(info.directory)) === key) {
        operations.delete(id)
        settledOperations.delete(id)
      }
    }
  }

  export const create = fn(CreateInput.optional(), async (input) => {
    if (!input?.operationId) return createNow(input)
    // Scope by the repository's common git directory: separate clones of one
    // project share a project ID but must not share created worktrees.
    const common = await git(["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: Instance.worktree })
    const repository =
      common.exitCode === 0 ? await realOnDiskPath(outputText(common.stdout).trim()) : Instance.worktree
    const key = `${repository}\u0000${input.operationId}`
    const request = operationRequest(input)
    const known = operations.get(key)
    if (known) {
      if (known.request !== request) {
        throw new CreateFailedError({ message: `Operation ${input.operationId} was already used for another worktree` })
      }
      return known.pending
    }
    const pending = createNow(input)
    operations.set(key, { request, pending })
    pending.then(
      () => {
        settledOperations.add(key)
        // Only settled operations are evicted; an in-flight one stays joinable.
        for (const old of settledOperations) {
          if (operations.size <= MAX_OPERATIONS) break
          settledOperations.delete(old)
          operations.delete(old)
        }
      },
      () => {
        // A failed create may be retried with the same ID.
        if (operations.get(key)?.pending === pending) operations.delete(key)
      },
    )
    return pending
  })

  async function createNow(input: CreateInput | undefined): Promise<Info> {
    const { info, bootstrap } = await prepareCreate(input, input?.startRef)
    // Defer bootstrap to the next microtask so callers see the
    // worktree info synchronously before post-create hooks run.
    // Tracked via startScriptTimers so cancelPendingStartScripts()
    // can cancel it if the worktree is removed before the tick.
    // `.unref()` lets the event loop exit if nothing else is alive.
    const timer = setTimeout(() => {
      releaseTimer(info.directory, timer)
      bootstrap()
    }, 0)
    timer.unref?.()
    trackTimer(info.directory, timer)
    return info
  }

  export const createReady = fn(CreateReadyInput.optional(), async (input) => {
    const { info, bootstrap } = await prepareCreate(input, input?.startPoint ?? input?.startRef)
    if (await bootstrap()) return info

    await remove({ directory: info.directory }).catch((error) => {
      log.warn("failed to clean up worktree that did not become ready", {
        directory: info.directory,
        error: toErrorMessage(error),
      })
    })
    throw new StartCommandFailedError({ message: "Worktree failed to become ready" })
  })

  export const remove = fn(RemoveInput, async (input) => {
    if (Instance.project.vcs !== "git") {
      throw new NotGitError({ message: "Worktrees are only supported for git projects" })
    }

    // Cancel any pending start-script / bootstrap timers queued by a
    // recent create() so they don't fire against the directory we're
    // about to remove. A rapid create→remove cycle would otherwise
    // run the user's start script in a now-deleted directory.
    cancelPendingStartScripts(input.directory)
    // A removed worktree must not be returned again for its operation ID.
    await forgetOperationsFor(input.directory)

    const directory = await canonical(input.directory)
    // Case-preserving spelling for the Instance cache, which keys on
    // Filesystem.resolve and does not fold case on macOS/Windows.
    const realDirectory = await realOnDiskPath(input.directory)
    // Git calls in this removal need a cwd that survives it. Instance.worktree
    // is the CURRENT checkout, which is the very directory being removed when
    // the caller runs inside its own worktree: after `git worktree remove`
    // deletes it, every later spawn fails and collapses to exitCode 1
    // (util/git.ts), which `branchFlag` reads as "absent" — so the owned
    // branch was never deleted. Project.fromDirectory records the primary
    // checkout in Instance.project.worktree, which outlives every linked
    // worktree removal. Only removing the primary itself (git refuses that
    // below, before deleting anything) can match it; fall back to the common
    // git dir, captured while it still exists — its parent would be the
    // checkout being removed.
    const repository = await (async () => {
      const primary = await realOnDiskPath(Instance.project.worktree)
      if ((await canonical(primary)) !== directory) return primary
      const common = await git(["rev-parse", "--path-format=absolute", "--git-common-dir"], {
        cwd: Instance.worktree,
      })
      if (common.exitCode === 0 && outputText(common.stdout)) return realOnDiskPath(outputText(common.stdout))
      return Instance.worktree
    })()
    // Capture the recorded spellings before Git or filesystem cleanup removes
    // the paths. Canonical comparison keys may change case on macOS/Windows
    // and cannot replace the original database keys after the directory is gone.
    const recordedDirectories = (
      await Promise.all(
        (await Project.sandboxes(Instance.project.id)).map(async (sandbox) =>
          (await canonical(sandbox)) === directory ? sandbox : undefined,
        ),
      )
    ).filter((sandbox): sandbox is string => sandbox !== undefined)
    const locate = async (stdout: Uint8Array | undefined) => {
      const lines = outputText(stdout)
        .split("\n")
        .map((line) => line.trim())
      const entries = lines.reduce<{ path?: string; branch?: string }[]>((acc, line) => {
        if (!line) return acc
        if (line.startsWith("worktree ")) {
          acc.push({ path: line.slice("worktree ".length).trim() })
          return acc
        }
        const current = acc[acc.length - 1]
        if (!current) return acc
        if (line.startsWith("branch ")) {
          current.branch = line.slice("branch ".length).trim()
        }
        return acc
      }, [])

      return (async () => {
        for (const item of entries) {
          if (!item.path) continue
          const key = await canonical(item.path)
          if (key === directory) return item
        }
      })()
    }

    const clean = (target: string) =>
      fs
        .rm(target, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 100,
        })
        .catch((error) => {
          const message = NamedError.message(error)
          throw new RemoveFailedError({ message: message || "Failed to remove git worktree directory" })
        })

    const stop = async (target: string) => {
      if (!(await exists(target))) return
      await git(["fsmonitor--daemon", "stop"], { cwd: target })
    }

    const cleanupInstance = async () => {
      if (Instance.list().includes(realDirectory)) {
        await Instance.provide({
          directory: realDirectory,
          fn: async () => {
            await Instance.dispose()
          },
        }).catch((error) => {
          log.warn("failed to dispose removed worktree instance", {
            directory: realDirectory,
            error: toErrorMessage(error),
          })
        })
      }
    }

    const cleanupSandbox = async () => {
      for (const sandbox of recordedDirectories) {
        await Project.removeSandbox(Instance.project.id, sandbox).catch((error) => {
          log.warn("failed to remove worktree from project sandboxes", {
            directory: sandbox,
            projectID: Instance.project.id,
            error: toErrorMessage(error),
          })
        })
      }
    }

    const list = await git(["worktree", "list", "--porcelain"], { cwd: repository })
    if (list.exitCode !== 0) {
      throw new RemoveFailedError({ message: errorText(list) || "Failed to read git worktrees" })
    }

    const entry = await locate(list.stdout)

    if (!entry?.path) {
      // Git no longer lists this path. Only delete leftovers we own: a
      // recorded sandbox for this project, or an unregistered directory
      // under the per-project worktree root. A missing git entry must not
      // recursively delete an arbitrary existing folder (including paths
      // inside the primary workspace).
      const primary = await canonical(Instance.worktree)
      if (directory === primary || Filesystem.contains(primary, directory)) {
        throw new RemoveFailedError({ message: "Worktree not found" })
      }
      const managedRoot = await canonical(path.join(Global.Path.data, "worktree", Instance.project.id))
      const recorded = recordedDirectories.length > 0
      if (!recorded && (directory === managedRoot || !Filesystem.contains(managedRoot, directory))) {
        throw new RemoveFailedError({ message: "Worktree not found" })
      }
      const directoryExists = await exists(directory)
      if (directoryExists) await stop(directory)
      await cleanupInstance()
      if (directoryExists) await clean(directory)
      // A failed cleanup must retain ownership so an external leftover can be retried.
      await cleanupSandbox()
      return true
    }

    // A timer queued under git's spelling of the path (list/restart paths)
    // is not keyed by the caller's spelling cancelled above.
    cancelPendingStartScripts(entry.path)
    await stop(entry.path)
    const removed = await git(["worktree", "remove", "--force", entry.path], {
      cwd: repository,
    })
    if (removed.exitCode !== 0) {
      const next = await git(["worktree", "list", "--porcelain"], { cwd: repository })
      if (next.exitCode !== 0) {
        throw new RemoveFailedError({
          message: errorText(removed) || errorText(next) || "Failed to remove git worktree",
        })
      }

      const stale = await locate(next.stdout)
      if (stale?.path) {
        throw new RemoveFailedError({ message: errorText(removed) || "Failed to remove git worktree" })
      }
    }

    await cleanupInstance()

    // ADR-260: delete only a branch AX Code owns; a borrowed or unknown branch
    // belongs to the user.
    const checkedOut = entry.branch?.replace(/^refs\/heads\//, "")
    let branch: string | undefined
    let cleanupError: unknown
    let branchError: unknown
    try {
      await clean(entry.path)
    } catch (error) {
      cleanupError = error
    } finally {
      await withBranchLock(async () => {
        branch = (await ownsBranch(checkedOut, repository)) ? checkedOut : undefined
        if (!branch) return
        const deleted = await git(["branch", "-D", branch], { cwd: repository })
        // A concurrent remover may have deleted the branch first; a missing
        // branch is the state this removal wanted.
        if (
          deleted.exitCode !== 0 &&
          (await git(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { cwd: repository })).exitCode !== 1
        ) {
          branchError = new RemoveFailedError({
            message: errorText(deleted) || "Failed to delete worktree branch",
          })
        }
      })
    }
    if (cleanupError) {
      if (branchError) {
        log.warn("failed to delete worktree branch after cleanup failure", {
          directory: entry.path,
          branch,
          error: toErrorMessage(branchError),
        })
      }
      throw cleanupError
    }
    await cleanupSandbox()
    if (branchError) throw branchError

    return true
  })

  export const reset = fn(ResetInput, async (input) => {
    if (Instance.project.vcs !== "git") {
      throw new NotGitError({ message: "Worktrees are only supported for git projects" })
    }

    cancelPendingStartScripts(input.directory)

    const directory = await canonical(input.directory)
    // Instance.worktree is the CURRENT checkout (a sandbox when the instance
    // runs inside a linked worktree), so it must not stand in for the primary
    // checkout: reset({directory: <main repo>}) from a sandbox would otherwise
    // reset the user's main worktree. Use the project's recorded worktree.
    const primary = await canonical(Instance.project.worktree)
    if (directory === primary) {
      throw new ResetFailedError({ message: "Cannot reset the primary workspace" })
    }

    const list = await git(["worktree", "list", "--porcelain"], { cwd: Instance.worktree })
    if (list.exitCode !== 0) {
      throw new ResetFailedError({ message: errorText(list) || "Failed to read git worktrees" })
    }

    const lines = outputText(list.stdout)
      .split("\n")
      .map((line) => line.trim())
    const entries = lines.reduce<{ path?: string; branch?: string }[]>((acc, line) => {
      if (!line) return acc
      if (line.startsWith("worktree ")) {
        acc.push({ path: line.slice("worktree ".length).trim() })
        return acc
      }
      const current = acc[acc.length - 1]
      if (!current) return acc
      if (line.startsWith("branch ")) {
        current.branch = line.slice("branch ".length).trim()
      }
      return acc
    }, [])

    const entry = await (async () => {
      for (const item of entries) {
        if (!item.path) continue
        const key = await canonical(item.path)
        if (key === directory) return item
      }
    })()
    if (!entry?.path) {
      throw new ResetFailedError({ message: "Worktree not found" })
    }
    // ADR-260: resetting would overwrite a branch that is not AX Code's.
    if (!(await ownsBranch(entry.branch?.replace(/^refs\/heads\//, "")))) {
      throw new ResetFailedError({ message: "Cannot reset a worktree whose branch AX Code did not create" })
    }

    const remoteList = await git(["remote"], { cwd: Instance.worktree })
    if (remoteList.exitCode !== 0) {
      throw new ResetFailedError({ message: errorText(remoteList) || "Failed to list git remotes" })
    }

    const remotes = outputText(remoteList.stdout)
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)

    const remote = remotes.includes("origin")
      ? "origin"
      : remotes.length === 1
        ? remotes[0]
        : remotes.includes("upstream")
          ? "upstream"
          : ""

    const remoteHead = remote
      ? await git(["symbolic-ref", `refs/remotes/${remote}/HEAD`], { cwd: Instance.worktree })
      : { exitCode: 1, stdout: undefined, stderr: undefined }

    const remoteRef = remoteHead.exitCode === 0 ? outputText(remoteHead.stdout) : ""
    const remoteTarget = remoteRef ? remoteRef.replace(/^refs\/remotes\//, "") : ""
    const remoteBranch = remote && remoteTarget.startsWith(`${remote}/`) ? remoteTarget.slice(`${remote}/`.length) : ""

    const mainCheck = await git(["show-ref", "--verify", "--quiet", "refs/heads/main"], {
      cwd: Instance.worktree,
    })
    const masterCheck = await git(["show-ref", "--verify", "--quiet", "refs/heads/master"], {
      cwd: Instance.worktree,
    })
    let localBranch = mainCheck.exitCode === 0 ? "main" : masterCheck.exitCode === 0 ? "master" : ""
    if (!localBranch) {
      // A local-only repository can carry its primary branch under any name
      // (for example `trunk`): the primary checkout's own HEAD is the
      // repository's default branch, so fall back to it before failing.
      // Instance.worktree is the sandbox itself when the instance runs inside
      // one; its HEAD is the sandbox branch, so reset would target itself.
      const head = await git(["symbolic-ref", "--short", "HEAD"], { cwd: Instance.project.worktree })
      const headBranch = head.exitCode === 0 ? outputText(head.stdout).trim() : ""
      if (headBranch) {
        const headCheck = await git(["show-ref", "--verify", "--quiet", `refs/heads/${headBranch}`], {
          cwd: Instance.worktree,
        })
        if (headCheck.exitCode === 0) localBranch = headBranch
      }
    }

    const target = remoteBranch ? `${remote}/${remoteBranch}` : localBranch
    if (!target) {
      throw new ResetFailedError({ message: "Default branch not found" })
    }

    if (remoteBranch) {
      const fetch = await git(["fetch", remote, remoteBranch], { cwd: Instance.worktree })
      if (fetch.exitCode !== 0) {
        throw new ResetFailedError({ message: errorText(fetch) || `Failed to fetch ${target}` })
      }
    }

    if (!entry.path) {
      throw new ResetFailedError({ message: "Worktree path not found" })
    }

    const worktreePath = entry.path
    cancelPendingStartScripts(worktreePath)

    const resetToTarget = await git(["reset", "--hard", target], { cwd: worktreePath })
    if (resetToTarget.exitCode !== 0) {
      throw new ResetFailedError({ message: errorText(resetToTarget) || "Failed to reset worktree to target" })
    }

    const clean = await sweep(worktreePath)
    if (clean.exitCode !== 0) {
      throw new ResetFailedError({ message: errorText(clean) || "Failed to clean worktree" })
    }

    const update = await git(["submodule", "update", "--init", "--recursive", "--force"], { cwd: worktreePath })
    if (update.exitCode !== 0) {
      throw new ResetFailedError({ message: errorText(update) || "Failed to update submodules" })
    }

    const subReset = await git(["submodule", "foreach", "--recursive", "git", "reset", "--hard"], {
      cwd: worktreePath,
    })
    if (subReset.exitCode !== 0) {
      throw new ResetFailedError({ message: errorText(subReset) || "Failed to reset submodules" })
    }

    const subClean = await git(["submodule", "foreach", "--recursive", "git", "clean", "-fdx"], {
      cwd: worktreePath,
    })
    if (subClean.exitCode !== 0) {
      throw new ResetFailedError({ message: errorText(subClean) || "Failed to clean submodules" })
    }

    const status = await git(["-c", "core.fsmonitor=false", "status", "--porcelain=v1"], { cwd: worktreePath })
    if (status.exitCode !== 0) {
      throw new ResetFailedError({ message: errorText(status) || "Failed to read git status" })
    }

    const dirty = outputText(status.stdout)
    if (dirty) {
      throw new ResetFailedError({ message: `Worktree reset left local changes:\n${dirty}` })
    }

    const projectID = Instance.project.id
    queueStartScripts(worktreePath, { projectID })

    return true
  })
}
