import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { FileWatcher } from "@/file/watcher"
import { Log } from "@/util/log"
import { git } from "@/util/git"
import { sleep } from "@/util/timeout"
import { Instance } from "./instance"
import z from "zod"

export namespace Vcs {
  const log = Log.create({ service: "vcs" })

  export const Event = {
    BranchUpdated: BusEvent.define(
      "vcs.branch.updated",
      z.object({
        branch: z.string().optional(),
      }),
    ),
  }

  export const Info = z
    .object({
      // Absent outside a Git repository, matching Event.BranchUpdated.
      branch: z.string().optional(),
    })
    .meta({
      ref: "VcsInfo",
    })
  export type Info = z.infer<typeof Info>

  interface State {
    current: string | undefined
    disposed?: boolean
    unsubscribe?: () => void
  }

  const state = Instance.state(
    async () => {
      if (Instance.project.vcs !== "git") {
        return { current: undefined } satisfies State
      }

      // `failed` distinguishes a git error (lock, partial HEAD write, timeout)
      // from a successful read that names no branch.
      const readCurrentBranch = async () => {
        const result = await git(["symbolic-ref", "--quiet", "HEAD"], {
          cwd: Instance.worktree,
          timeout: 5_000,
        })
        if (result.exitCode === 0) {
          // Full symbolic refs work before the first commit and cannot become
          // ambiguous when a tag has the same name as the current branch.
          const ref = result.text().trim()
          if (!ref.startsWith("refs/heads/")) return { failed: true as const }
          return { failed: false as const, branch: ref.slice("refs/heads/".length) }
        }
        if (result.exitCode !== 1) return { failed: true as const }
        const detached = await git(["rev-parse", "--verify", "HEAD"], {
          cwd: Instance.worktree,
          timeout: 5_000,
        })
        if (detached.exitCode !== 0) return { failed: true as const }
        return { failed: false as const, branch: "HEAD" }
      }
      const getCurrentBranch = async () => {
        const read = await readCurrentBranch()
        return read.failed ? undefined : read.branch
      }

      const value: State = {
        current: undefined,
      }

      // Serialize refreshes: concurrent HEAD events (rebase, rapid switches) can
      // finish their git reads out of order and let a stale branch win.
      // Subscribe before awaiting initialization so a HEAD event during the
      // first read queues a refresh instead of being permanently lost.
      let refreshing = getCurrentBranch().then((branch) => {
        value.current = branch
      })
      const refresh = async () => {
        if (value.disposed) return
        let read = await readCurrentBranch()
        // A HEAD rewrite can be caught mid-write; one HEAD event may be the only
        // signal, so re-read once before giving up on it.
        if (read.failed) {
          await sleep(250)
          read = await readCurrentBranch()
        }
        // A transient git failure must not clear a known branch.
        if (read.failed || value.disposed) return
        const next = read.branch
        if (next === value.current) return
        log.info("branch changed", { from: value.current, to: next })
        value.current = next
        await Bus.publish(Event.BranchUpdated, { branch: next })
      }

      value.unsubscribe = Bus.subscribe(
        FileWatcher.Event.Updated,
        Instance.bind(async (evt) => {
          if (!evt.properties.file.endsWith("HEAD")) return
          const run = refreshing.then(refresh, refresh)
          refreshing = run.catch(() => undefined)
          await run
        }),
      )

      await refreshing
      log.info("initialized", { branch: value.current })
      return value
    },
    async (entry) => {
      entry.disposed = true
      entry.unsubscribe?.()
    },
  )

  export function init() {
    return state().then(() => undefined)
  }

  export function branch() {
    return state().then((entry) => entry.current)
  }

  /** Local branch names for command argument completion. No remote refs or worktree mutation. */
  export async function branches(): Promise<string[]> {
    if (Instance.project.vcs !== "git") return []
    const result = await git(["for-each-ref", "--format=%(refname:lstrip=2)", "refs/heads"], {
      cwd: Instance.worktree,
      timeout: 5_000,
    })
    if (result.exitCode !== 0) throw new Error("Unable to list local Git branches")
    return result.text().split("\n").filter(Boolean)
  }
}
