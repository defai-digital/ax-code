import path from "path"
import fs from "fs/promises"
import z from "zod"
import { ConfigMarkdown } from "../config/markdown"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"
import { Glob } from "../util/glob"
import { mapWithConcurrency, OutboundLimits } from "../util/concurrency"
import { Log } from "../util/log"

const log = Log.create({ service: "command.file" })

export namespace FileCommand {
  export const SourceTool = z.enum(["ax-code", "agents", "opencode", "claude"])
  export type SourceTool = z.infer<typeof SourceTool>

  export const Scope = z.enum(["project", "user", "config"])
  export type Scope = z.infer<typeof Scope>

  export const Warning = z.object({
    code: z.string(),
    message: z.string(),
    severity: z.enum(["info", "warn", "error"]),
  })
  export type Warning = z.infer<typeof Warning>

  export const Info = z.object({
    name: z.string(),
    description: z.string().optional(),
    agent: z.string().optional(),
    model: z.string().optional(),
    subtask: z.boolean().optional(),
    workflow: z.string().optional(),
    template: z.string(),
    location: z.string(),
    sourceTool: SourceTool,
    scope: Scope,
    warnings: z.array(Warning).optional(),
    allowShell: z.literal(false),
  })
  export type Info = z.infer<typeof Info>

  const Frontmatter = z
    .object({
      description: z.string().optional(),
      agent: z.string().optional(),
      model: z.string().optional(),
      subtask: z.boolean().optional(),
      workflow: z.string().optional(),
    })
    .passthrough()

  const FRONTMATTER_FIELDS = new Set(["description", "agent", "model", "subtask", "workflow"])
  const COMMAND_PATTERN = "commands/**/*.md"
  const SCOPE_PRIORITY: Record<Scope, number> = { project: 0, user: 1, config: 2 }

  export async function parse(input: {
    name: string
    location: string
    sourceTool: SourceTool
    scope: Scope
    data: Record<string, unknown>
    content: string
  }): Promise<Info> {
    const parsed = Frontmatter.safeParse(input.data)
    const warnings: Warning[] = []

    for (const key of Object.keys(input.data)) {
      if (!FRONTMATTER_FIELDS.has(key)) {
        warnings.push({
          code: "unknown_frontmatter",
          message: `Unsupported frontmatter field ignored: ${key}`,
          severity: "warn",
        })
      }
    }

    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        warnings.push({
          code: "invalid_frontmatter",
          message: issue.message,
          severity: "error",
        })
      }
    }

    const data = parsed.success ? parsed.data : {}
    if (data.model && !data.model.includes("/")) {
      warnings.push({
        code: "invalid_model",
        message: "Model should use provider/model format.",
        severity: "warn",
      })
    }
    if (data.workflow) {
      warnings.push({
        code: "workflow_command",
        message: "Workflow-backed command execution is gated by AX_CODE_WORKFLOW_RUNTIME.",
        severity: "info",
      })
    }

    const template = input.content.trim()
    if (!template) {
      warnings.push({
        code: "empty_template",
        message: "Command template body is empty.",
        severity: "warn",
      })
    }
    if (ConfigMarkdown.shell(template).length > 0) {
      warnings.push({
        code: "unsupported_shell_interpolation",
        message: "Shell-output interpolation is not executed for file-backed commands.",
        severity: "warn",
      })
    }

    return {
      name: input.name,
      ...(typeof data.description === "string" ? { description: data.description } : {}),
      ...(typeof data.agent === "string" ? { agent: data.agent } : {}),
      ...(typeof data.model === "string" ? { model: data.model } : {}),
      ...(typeof data.subtask === "boolean" ? { subtask: data.subtask } : {}),
      ...(typeof data.workflow === "string" ? { workflow: data.workflow } : {}),
      template,
      location: input.location,
      sourceTool: input.sourceTool,
      scope: input.scope,
      ...(warnings.length ? { warnings } : {}),
      allowShell: false,
    }
  }

  export async function parseFile(input: {
    file: string
    root: string
    sourceTool: SourceTool
    scope: Scope
  }): Promise<Info | undefined> {
    // Glob follows symlinks; a symlinked command file inside a cloned repo could
    // point at any readable file (e.g. ~/.ssh/id_rsa) and have its bytes become
    // the command template. Reject anything that resolves outside the config
    // directory, mirroring loadContainedMarkdownConfig.
    if (!(await isContainedCommandFile(input.root, input.file))) {
      log.warn("ignoring command file symlink outside commands directory", { file: input.file, root: input.root })
      return undefined
    }
    const md = await ConfigMarkdown.parse(input.file).catch((error) => {
      if (isMissingFile(error)) return undefined
      throw error
    })
    if (!md) return undefined
    return parse({
      name: commandName(input.file, input.root),
      location: input.file,
      sourceTool: input.sourceTool,
      scope: input.scope,
      data: md.data as Record<string, unknown>,
      content: md.content,
    })
  }

  export async function discover(input: { directory: string; worktree: string }): Promise<Info[]> {
    const results: Info[] = []
    const globalRoots = [
      { dir: path.join(Global.Path.home, ".agents"), sourceTool: "agents" },
      { dir: path.join(Global.Path.home, ".opencode"), sourceTool: "opencode" },
      { dir: path.join(Global.Path.home, ".claude"), sourceTool: "claude" },
    ] as const

    for (const root of globalRoots) {
      if (!(await Filesystem.isDir(root.dir))) continue
      results.push(...(await scanRoot({ root: root.dir, sourceTool: root.sourceTool, scope: "user" })))
    }

    const projectRoots: Array<{ root: string; sourceTool: SourceTool }> = []
    for await (const root of Filesystem.up({
      targets: [".agents", ".opencode", ".claude"],
      start: input.directory,
      stop: input.worktree,
    })) {
      projectRoots.push({ root, sourceTool: sourceToolFromRoot(root) })
    }
    for (const root of projectRoots) {
      results.push(...(await scanRoot({ root: root.root, sourceTool: root.sourceTool, scope: "project" })))
    }

    // Sort by name for stable display, but break ties on scope (project before
    // user) rather than the location string: a project's absolute path can sort
    // after a global one purely due to path characters (e.g. "code/myrepo" vs
    // ".agents"), which would silently let a global command shadow a
    // same-named project override in the "first entry wins" merge in
    // Command.state(). Array.prototype.sort is stable, so entries that also
    // share a scope keep their original discovery order (closer project roots,
    // then farther ones; global roots in their fixed .agents/.opencode/.claude
    // order).
    return results.sort((a, b) => a.name.localeCompare(b.name) || SCOPE_PRIORITY[a.scope] - SCOPE_PRIORITY[b.scope])
  }

  const fileConcurrency = 8

  async function scanRoot(input: { root: string; sourceTool: SourceTool; scope: Scope }) {
    const matches = await Glob.scan(COMMAND_PATTERN, {
      cwd: input.root,
      absolute: true,
      include: "file",
      symlink: true,
      dot: true,
    }).catch((error) => {
      if (Filesystem.isEnoent(error)) return [] as string[]
      throw error
    })
    // Bound the fan-out: a global root plus several project roots can surface
    // hundreds of command files, and an unbridled Promise.all would open every
    // one of them at once. The numeric cap bounds this scan and the shared
    // limiter keeps it from composing with other file I/O into FD exhaustion.
    const parsed = await mapWithConcurrency(matches, fileConcurrency, (file) =>
      OutboundLimits.fileIO.run(() =>
        parseFile({
          file,
          root: input.root,
          sourceTool: input.sourceTool,
          scope: input.scope,
        }),
      ),
    )
    return parsed.filter((item): item is Info => !!item)
  }

  function sourceToolFromRoot(root: string): SourceTool {
    const base = path.basename(root)
    if (base === ".opencode") return "opencode"
    if (base === ".claude") return "claude"
    return "agents"
  }

  export function commandName(file: string, root: string) {
    const relative = path.relative(path.join(root, "commands"), file)
    const ext = path.extname(relative)
    const name = ext ? relative.slice(0, -ext.length) : relative
    return name.split(path.sep).join("/")
  }

  function isMissingFile(error: unknown) {
    if (Filesystem.isEnoent(error)) return true
    if (!ConfigMarkdown.FrontmatterError.isInstance(error)) return false
    return Filesystem.isEnoent((error as Error).cause)
  }

  async function isContainedCommandFile(root: string, file: string) {
    const rootReal = await fs.realpath(path.resolve(root)).catch(() => path.resolve(root))
    const fileReal = await fs.realpath(path.resolve(file)).catch(() => undefined)
    return !!fileReal && Filesystem.contains(rootReal, fileReal)
  }
}
