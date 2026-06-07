import path from "path"
import z from "zod"
import { ConfigMarkdown } from "../config/markdown"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"
import { Glob } from "../util/glob"

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
    const md = await ConfigMarkdown.parse(input.file).catch(() => undefined)
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

    return results.sort((a, b) => a.name.localeCompare(b.name) || a.location.localeCompare(b.location))
  }

  async function scanRoot(input: { root: string; sourceTool: SourceTool; scope: Scope }) {
    const matches = await Glob.scan(COMMAND_PATTERN, {
      cwd: input.root,
      absolute: true,
      include: "file",
      symlink: true,
      dot: true,
    }).catch(() => [] as string[])
    const parsed = await Promise.all(
      matches.map((file) =>
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
}
