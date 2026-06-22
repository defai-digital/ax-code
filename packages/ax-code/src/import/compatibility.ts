import path from "path"
import z from "zod"
import { ConfigMarkdown } from "../config/markdown"
import { Filesystem } from "../util/filesystem"
import { Glob } from "../util/glob"

export namespace CompatibilityImport {
  export const Source = z.enum(["opencode", "claude", "codex"])
  export type Source = z.infer<typeof Source>

  export const Candidate = z.object({
    source: Source,
    kind: z.enum(["command", "skill", "agent", "instruction"]),
    action: z.enum(["copy", "skip"]),
    sourcePath: z.string(),
    targetPath: z.string(),
    reason: z.string().optional(),
    warnings: z.array(z.string()).optional(),
  })
  export type Candidate = z.infer<typeof Candidate>

  export const Report = z.object({
    source: Source,
    dryRun: z.boolean(),
    total: z.number().int().nonnegative(),
    copy: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    candidates: z.array(Candidate),
  })
  export type Report = z.infer<typeof Report>

  const ROOTS: Record<Source, string> = {
    opencode: ".opencode",
    claude: ".claude",
    codex: ".codex",
  }

  export async function plan(input: { source: Source; directory: string }): Promise<Report> {
    const parsedSource = Source.parse(input.source)
    const root = path.join(input.directory, ROOTS[parsedSource])
    const targetRoot = path.join(input.directory, ".ax-code")
    const candidates: Candidate[] = []

    candidates.push(...(await commandCandidates({ source: parsedSource, root, targetRoot })))
    candidates.push(...(await skillCandidates({ source: parsedSource, root, targetRoot })))
    candidates.push(...(await agentCandidates({ source: parsedSource, root, targetRoot })))
    if (parsedSource === "codex") {
      const agents = path.join(input.directory, "AGENTS.md")
      if (await Filesystem.exists(agents)) {
        candidates.push(
          await candidate(parsedSource, "instruction", agents, path.join(targetRoot, "instructions", "AGENTS.md")),
        )
      }
    }

    return report(parsedSource, true, candidates)
  }

  export async function run(input: { source: Source; directory: string; write: boolean }): Promise<Report> {
    const planned = await plan({ source: input.source, directory: input.directory })
    if (!input.write) return planned

    for (const item of planned.candidates) {
      if (item.action !== "copy") continue
      await Filesystem.write(item.targetPath, await Filesystem.readText(item.sourcePath))
    }

    return report(planned.source, false, planned.candidates)
  }

  async function commandCandidates(input: { source: Source; root: string; targetRoot: string }) {
    const matches = await scan(input.root, "commands/**/*.md")
    return Promise.all(
      matches.map(async (sourcePath) => {
        const rel = path.relative(path.join(input.root, "commands"), sourcePath)
        const targetPath = path.join(input.targetRoot, "commands", rel)
        const warnings = await commandWarnings(sourcePath)
        return candidate(input.source, "command", sourcePath, targetPath, warnings)
      }),
    )
  }

  async function skillCandidates(input: { source: Source; root: string; targetRoot: string }) {
    const matches = await scan(input.root, "skills/**/SKILL.md")
    return Promise.all(
      matches.map(async (sourcePath) => {
        const rel = path.relative(path.join(input.root, "skills"), sourcePath)
        const targetPath = path.join(input.targetRoot, "skill", rel)
        return candidate(input.source, "skill", sourcePath, targetPath)
      }),
    )
  }

  async function agentCandidates(input: { source: Source; root: string; targetRoot: string }) {
    const matches = await scan(input.root, "{agent,agents}/**/*.md")
    return Promise.all(
      matches.map(async (sourcePath) => {
        const rel = relativeAfterAny(sourcePath, [path.join(input.root, "agent"), path.join(input.root, "agents")])
        const targetPath = path.join(input.targetRoot, "agent", rel)
        return candidate(input.source, "agent", sourcePath, targetPath)
      }),
    )
  }

  async function candidate(
    source: Source,
    kind: Candidate["kind"],
    sourcePath: string,
    targetPath: string,
    warnings?: string[],
  ): Promise<Candidate> {
    const exists = await Filesystem.exists(targetPath)
    return {
      source,
      kind,
      action: exists ? "skip" : "copy",
      sourcePath,
      targetPath,
      ...(exists ? { reason: "target_exists" } : {}),
      ...(warnings?.length ? { warnings } : {}),
    }
  }

  async function commandWarnings(sourcePath: string) {
    const md = await ConfigMarkdown.parse(sourcePath).catch(() => undefined)
    if (!md) return ["invalid_frontmatter"]
    const warnings: string[] = []
    if (ConfigMarkdown.shell(md.content).length > 0) warnings.push("unsupported_shell_interpolation")
    if (typeof (md.data as Record<string, unknown>).workflow === "string")
      warnings.push("workflow_requires_runtime_flag")
    return warnings
  }

  async function scan(root: string, pattern: string) {
    return Glob.scan(pattern, {
      cwd: root,
      absolute: true,
      include: "file",
      symlink: true,
      dot: true,
    }).catch(() => [] as string[])
  }

  function relativeAfterAny(file: string, roots: string[]) {
    for (const root of roots) {
      const rel = path.relative(root, file)
      if (Filesystem.contains(root, file)) return rel
    }
    return path.basename(file)
  }

  function report(source: Source, dryRun: boolean, candidates: Candidate[]): Report {
    return {
      source,
      dryRun,
      total: candidates.length,
      copy: candidates.filter((item) => item.action === "copy").length,
      skipped: candidates.filter((item) => item.action === "skip").length,
      candidates,
    }
  }
}
