import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { FileWatcher } from "@/file/watcher"
import { Log } from "@/util/log"
import { git } from "@/util/git"
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
      branch: z.string(),
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

      const getCurrentBranch = async () => {
        const result = await git(["rev-parse", "--abbrev-ref", "HEAD"], {
          cwd: Instance.worktree,
        })
        if (result.exitCode !== 0) return undefined
        const text = result.text().trim()
        return text || undefined
      }

      const value: State = {
        current: await getCurrentBranch(),
      }
      log.info("initialized", { branch: value.current })

      value.unsubscribe = Bus.subscribe(
        FileWatcher.Event.Updated,
        Instance.bind(async (evt) => {
          if (!evt.properties.file.endsWith("HEAD")) return
          const next = await getCurrentBranch()
          if (next === value.current) return
          log.info("branch changed", { from: value.current, to: next })
          value.current = next
          await Bus.publish(Event.BranchUpdated, { branch: next })
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
}
