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
        const result = await git(["rev-parse", "--abbrev-ref", "HEAD"], {
          cwd: Instance.worktree,
          timeout: 5_000,
        })
        if (result.exitCode !== 0) return { failed: true as const }
        return { failed: false as const, branch: result.text().trim() || undefined }
      }
      const getCurrentBranch = async () => {
        const read = await readCurrentBranch()
        return read.failed ? undefined : read.branch
      }

      const value: State = {
        current: await getCurrentBranch(),
      }
      log.info("initialized", { branch: value.current })

      // Serialize refreshes: concurrent HEAD events (rebase, rapid switches) can
      // finish their git reads out of order and let a stale branch win.
      let refreshing: Promise<void> = Promise.resolve()
      const refresh = async () => {
        let read = await readCurrentBranch()
        // A HEAD rewrite can be caught mid-write; one HEAD event may be the only
        // signal, so re-read once before giving up on it.
        if (read.failed) {
          await sleep(250)
          read = await readCurrentBranch()
        }
        // A transient git failure must not clear a known branch.
        if (read.failed) return
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

      return value
    },
    async (entry) => {
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
