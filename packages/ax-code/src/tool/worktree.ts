import z from "zod"
import path from "path"
import { Tool } from "./tool"
import DESCRIPTION from "./worktree.txt"
import { Worktree } from "../worktree"
import { Instance } from "../project/instance"
import { toErrorMessage } from "../util/error-message"

const CreateInput = z.object({
  name: z
    .string()
    .min(1)
    .optional()
    .describe("Optional slug for the new worktree. A random adjective+name is used if omitted."),
  startPoint: z
    .string()
    .min(1)
    .max(1024)
    .refine((value) => !value.startsWith("-"), "Git revision cannot start with '-'")
    .optional()
    .describe("Git revision (branch, tag, or commit) the new worktree should start from."),
})

const ListInput = z.object({})

const RemoveInput = z.object({
  directory: z.string().min(1).describe("Absolute path of a worktree directory returned by worktree_list."),
})

type WorktreeMetadata = {
  action: "list" | "create" | "remove"
  notGit?: boolean
  count?: number
  name?: string
  branch?: string
  directory?: string
  found?: boolean
  removed?: boolean
  error?: string
}

function notGitMessage(): string {
  // `Worktree.NotGitError` always carries this string; the public error
  // type is not exported from the host to keep the tool surface narrow.
  return "Worktrees are only supported for git projects"
}

function isNotGit(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const name = (error as { name?: unknown }).name
  return name === "WorktreeNotGitError"
}

function outputList(items: Worktree.ListItem[]): string {
  if (items.length === 0) return "No worktrees."
  const lines = items.map((item) => {
    const branch = item.branch ? ` (${item.branch})` : ""
    return `- ${item.name}${branch}: ${item.directory}`
  })
  return lines.join("\n")
}

export const WorktreeListTool = Tool.define<typeof ListInput, WorktreeMetadata>("worktree_list", {
  description: DESCRIPTION,
  parameters: ListInput,
  async execute(_args, _ctx) {
    if (Instance.project.vcs !== "git") {
      return {
        title: "Worktrees unavailable",
        metadata: { action: "list", notGit: true },
        output: notGitMessage(),
      }
    }
    const items = await Worktree.list()
    return {
      title: `${items.length} worktree${items.length === 1 ? "" : "s"}`,
      metadata: { action: "list", count: items.length },
      output: outputList(items),
    }
  },
})

export const WorktreeCreateTool = Tool.define<typeof CreateInput, WorktreeMetadata>("worktree_create", {
  description: DESCRIPTION,
  parameters: CreateInput,
  async execute(params, ctx) {
    if (Instance.project.vcs !== "git") {
      return {
        title: "Worktrees unavailable",
        metadata: { action: "create", notGit: true },
        output: notGitMessage(),
      }
    }
    // Ask first so the user approves a project-data mutation before we
    // allocate a worktree directory and branch. The directory lives under
    // Global.Path.data, outside the project working copy; surfacing that
    // in the rule pattern keeps permission boundaries consistent.
    await ctx.ask({
      permission: "edit",
      patterns: [path.join("worktree", params.name ?? "*")],
      always: ["*"],
      metadata: {
        action: "worktree_create",
        name: params.name,
        startPoint: params.startPoint,
      },
    })

    let info: Worktree.Info
    try {
      info = await Worktree.createReady({
        ...(params.name !== undefined ? { name: params.name } : {}),
        ...(params.startPoint !== undefined ? { startPoint: params.startPoint } : {}),
      })
    } catch (error) {
      if (isNotGit(error)) {
        return {
          title: "Worktrees unavailable",
          metadata: { action: "create", notGit: true },
          output: notGitMessage(),
        }
      }
      throw error
    }

    return {
      title: `Created worktree ${info.name}`,
      metadata: {
        action: "create",
        name: info.name,
        branch: info.branch,
        directory: info.directory,
      },
      output: `Worktree ${info.name} created at ${info.directory} on branch ${info.branch}.`,
    }
  },
})

export const WorktreeRemoveTool = Tool.define<typeof RemoveInput, WorktreeMetadata>("worktree_remove", {
  description: DESCRIPTION,
  parameters: RemoveInput,
  async execute(params, ctx) {
    if (Instance.project.vcs !== "git") {
      return {
        title: "Worktrees unavailable",
        metadata: { action: "remove", notGit: true },
        output: notGitMessage(),
      }
    }

    // Refuse before the ask: `Worktree.remove` already validates against
    // `git worktree list`, but checking first lets us short-circuit the
    // approval UI for a request the runtime would reject anyway.
    const list = await Worktree.list()
    const matched = list.find((entry) => entry.directory === params.directory)
    if (!matched) {
      return {
        title: "Worktree not found",
        metadata: { action: "remove", found: false, directory: params.directory },
        output: `Worktree directory not found: ${params.directory}. Call worktree_list to see current worktrees.`,
      }
    }

    await ctx.ask({
      permission: "edit",
      patterns: [params.directory],
      always: ["*"],
      metadata: {
        action: "worktree_remove",
        directory: params.directory,
        name: matched.name,
        branch: matched.branch,
      },
    })

    let removed: boolean
    try {
      removed = await Worktree.remove({ directory: params.directory })
    } catch (error) {
      if (isNotGit(error)) {
        return {
          title: "Worktrees unavailable",
          metadata: { action: "remove", notGit: true },
          output: notGitMessage(),
        }
      }
      const message = toErrorMessage(error)
      return {
        title: "Worktree remove failed",
        metadata: { action: "remove", directory: params.directory, error: message },
        output: `Worktree remove failed: ${message}`,
      }
    }

    return {
      title: `Removed worktree ${matched.name}`,
      metadata: {
        action: "remove",
        name: matched.name,
        directory: params.directory,
        removed,
      },
      output: `Worktree ${matched.name} (${params.directory}) removed.`,
    }
  },
})
