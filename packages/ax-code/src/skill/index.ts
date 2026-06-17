import os from "os"
import path from "path"
import { pathToFileURL } from "url"
import z from "zod"
import type { Agent } from "@/agent/agent"
import { Flag } from "@/flag/flag"
import { Global } from "@/global"
import { Permission } from "@/permission"
import { Instance } from "@/project/instance"
import { Filesystem } from "@/util/filesystem"
import { recordCount } from "@/util/record"
import { Config } from "../config/config"
import { ConfigMarkdown } from "../config/markdown"
import { Glob } from "../util/glob"
import { Log } from "../util/log"
import { Discovery } from "./discovery"
import { SkillValidate } from "./validate"

export namespace Skill {
  const log = Log.create({ service: "skill" })
  const EXTERNAL_DIRS = [".claude", ".agents", ".opencode"]
  const EXTERNAL_SKILL_PATTERN = "skills/**/SKILL.md"
  const AX_CODE_SKILL_PATTERN = "{skill,skills}/**/SKILL.md"
  const SKILL_PATTERN = "**/SKILL.md"

  export const Info = z.object({
    name: z.string(),
    description: z.string(),
    location: z.string(),
    content: z.string(),
    agent: z.string().optional(),
    paths: z.array(z.string()).optional(),
    license: z.string().optional(),
    compatibility: z.string().optional(),
    metadata: z.record(z.string(), z.string()).optional(),
    allowedTools: z.array(z.string()).optional(),
    argumentHint: z.string().optional(),
    standardIssues: z.array(z.string()).optional(),
    sourceTool: z.enum(["ax-code", "agents", "opencode", "claude", "builtin", "config"]).optional(),
    scope: z.enum(["builtin", "project", "user", "config", "compat"]).optional(),
    builtin: z.boolean().optional(),
  })
  export type Info = z.infer<typeof Info>

  type State = {
    skills: Record<string, Info>
    dirs: Set<string>
  }

  async function addSkill(
    state: State,
    match: string,
    source?: { sourceTool?: Info["sourceTool"]; scope?: Info["scope"] },
  ) {
    const md = await ConfigMarkdown.parse(match).catch(async (err) => {
      const message = ConfigMarkdown.FrontmatterError.isInstance(err)
        ? err.data.message
        : `Failed to parse skill ${match}`
      const { Session } = await import("@/session")
      Session.publishError({ message })
      log.error("failed to load skill", { skill: match, err })
      return undefined
    })

    if (!md) return

    const data = md.data as Record<string, unknown>
    const parsed = Info.pick({ name: true, description: true }).safeParse(data)
    if (!parsed.success) return

    if (state.skills[parsed.data.name]) {
      log.warn("duplicate skill name", {
        name: parsed.data.name,
        existing: state.skills[parsed.data.name].location,
        duplicate: match,
      })
    }

    const raw = data.paths
    const paths = Array.isArray(raw)
      ? raw.filter((p: unknown) => typeof p === "string")
      : typeof raw === "string"
        ? raw
            .split(",")
            .map((s: string) => s.trim())
            .filter(Boolean)
        : undefined
    const license = typeof data.license === "string" ? data.license : undefined
    const compatibility = typeof data.compatibility === "string" ? data.compatibility : undefined
    const agent = typeof data.agent === "string" ? data.agent : undefined
    const metadata = z.record(z.string(), z.string()).safeParse(data.metadata)
    const allowedTools =
      typeof data["allowed-tools"] === "string"
        ? data["allowed-tools"]
            .split(/\s+/)
            .map((s: string) => s.trim())
            .filter(Boolean)
        : undefined
    const argumentHint = typeof data["argument-hint"] === "string" ? data["argument-hint"] : undefined
    const standardIssues = validateStandardSkill({
      name: parsed.data.name,
      description: parsed.data.description,
      location: match,
      compatibility,
      hasInvalidMetadata: data.metadata !== undefined && !metadata.success,
    })

    state.dirs.add(path.dirname(match))
    state.skills[parsed.data.name] = {
      name: parsed.data.name,
      description: parsed.data.description,
      location: match,
      content: md.content,
      ...(agent ? { agent } : {}),
      ...(paths?.length ? { paths } : {}),
      ...(license ? { license } : {}),
      ...(compatibility ? { compatibility } : {}),
      ...(metadata.success ? { metadata: metadata.data } : {}),
      ...(allowedTools?.length ? { allowedTools } : {}),
      ...(argumentHint ? { argumentHint } : {}),
      ...(standardIssues.length ? { standardIssues } : {}),
      ...(source?.sourceTool ? { sourceTool: source.sourceTool } : {}),
      ...(source?.scope ? { scope: source.scope } : {}),
    }
  }

  async function scanDir(
    state: State,
    root: string,
    pattern: string,
    opts?: { dot?: boolean; scope?: string; sourceTool?: Info["sourceTool"]; skillScope?: Info["scope"] },
  ) {
    const matches = await Glob.scan(pattern, {
      cwd: root,
      absolute: true,
      include: "file",
      symlink: true,
      dot: opts?.dot,
    }).catch((error) => {
      if (opts?.scope) {
        log.error(`failed to scan ${opts.scope} skills`, { dir: root, error })
        return [] as string[]
      }
      throw error
    })
    for (const match of matches) {
      await addSkill(state, match, { sourceTool: opts?.sourceTool, scope: opts?.skillScope })
    }
  }

  export const BUILTIN_NAMES = new Set(["debug-only", "debug-n-fix", "improve-overall", "improve-security", "mcp"])

  declare const AX_CODE_BUILTIN_SKILLS: unknown

  const BuiltinSkillEntry = z.object({
    location: z.string(),
    content: z.string(),
  })

  export function parseBuiltinSkillEntries(input: unknown): Array<{ location: string; content: string }> {
    const raw = typeof input === "string" ? JSON.parse(input) : input
    return z.array(BuiltinSkillEntry).parse(raw)
  }

  async function loadBuiltinSkills(): Promise<Array<{ location: string; content: string }>> {
    if (typeof AX_CODE_BUILTIN_SKILLS !== "undefined") {
      return parseBuiltinSkillEntries(AX_CODE_BUILTIN_SKILLS)
    }
    const builtinDir = path.resolve(import.meta.dirname, "../../skills")
    const entries = await Filesystem.isDir(builtinDir).then((exists) => {
      if (!exists) return [] as string[]
      return Glob.scan("*/SKILL.md", { cwd: builtinDir, absolute: true, include: "file" }).catch(() => [] as string[])
    })
    return Promise.all(entries.map(async (location) => ({ location, content: await Filesystem.readText(location) })))
  }

  async function addBuiltinSkill(state: State, entry: { location: string; content: string }) {
    const md = await ConfigMarkdown.parseText(entry.location, entry.content).catch((err) => {
      log.error("failed to load built-in skill", { location: entry.location, err })
      return undefined
    })
    if (!md) return
    const data = md.data as Record<string, unknown>
    const parsed = Info.pick({ name: true, description: true }).safeParse(data)
    if (!parsed.success) return
    const agent = typeof data.agent === "string" ? data.agent : undefined
    const argumentHint = typeof data["argument-hint"] === "string" ? data["argument-hint"] : undefined
    state.skills[parsed.data.name] = {
      name: parsed.data.name,
      description: parsed.data.description,
      location: entry.location,
      content: md.content,
      ...(agent ? { agent } : {}),
      ...(argumentHint ? { argumentHint } : {}),
      sourceTool: "builtin",
      scope: "builtin",
      builtin: true,
    }
  }

  const state = Instance.state(async () => {
    const ctx = Instance.current
    const s: State = {
      skills: {},
      dirs: new Set<string>(),
    }

    const builtins = await loadBuiltinSkills()
    for (const entry of builtins) {
      await addBuiltinSkill(s, entry)
    }

    if (!Flag.AX_CODE_DISABLE_EXTERNAL_SKILLS) {
      for (const dir of EXTERNAL_DIRS) {
        const root = path.join(Global.Path.home, dir)
        const exists = await Filesystem.isDir(root)
        if (!exists) continue
        await scanDir(s, root, EXTERNAL_SKILL_PATTERN, {
          dot: true,
          scope: "global",
          sourceTool: sourceToolFromDir(dir),
          skillScope: "user",
        })
      }

      const roots: string[] = []
      for await (const root of Filesystem.up({
        targets: EXTERNAL_DIRS,
        start: ctx.directory,
        stop: ctx.worktree,
      })) {
        roots.push(root)
      }
      for (const root of roots) {
        await scanDir(s, root, EXTERNAL_SKILL_PATTERN, {
          dot: true,
          scope: "project",
          sourceTool: sourceToolFromDir(path.basename(root)),
          skillScope: "project",
        })
      }
    }

    const configDirs = await Config.directories()
    for (const dir of configDirs) {
      await scanDir(s, dir, AX_CODE_SKILL_PATTERN, { sourceTool: "ax-code", skillScope: "config" })
    }

    const cfg = await Config.get()
    for (const item of cfg.skills?.paths ?? []) {
      const expanded = item.startsWith("~/") ? path.join(os.homedir(), item.slice(2)) : item
      const dir = path.isAbsolute(expanded) ? expanded : path.join(ctx.directory, expanded)
      // Resolve symlinks and normalize before the containment check
      // so `../../etc` can't escape via relative path segments.
      const resolved = path.resolve(dir)
      const home = os.homedir()
      const workspace = path.resolve(ctx.directory)
      if (
        !resolved.startsWith(workspace + path.sep) &&
        !resolved.startsWith(home + path.sep) &&
        resolved !== workspace &&
        resolved !== home
      ) {
        log.warn("skill path outside workspace and home; skipping", { path: dir, resolved })
        continue
      }
      const exists = await Filesystem.isDir(resolved)
      if (!exists) {
        log.warn("skill path not found", { path: resolved })
        continue
      }
      await scanDir(s, resolved, SKILL_PATTERN, { sourceTool: "config", skillScope: "config" })
    }

    for (const url of cfg.skills?.urls ?? []) {
      const dirs = await Discovery.pull(url)
      for (const dir of dirs) {
        s.dirs.add(dir)
        await scanDir(s, dir, SKILL_PATTERN, { sourceTool: "config", skillScope: "config" })
      }
    }

    log.info("init", { count: recordCount(s.skills) })
    return s
  })

  function escapeMetadata(value: string) {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;")
      .replace(/\s+/g, " ")
      .trim()
  }

  function formatLocation(skill: Info) {
    if (skill.builtin) return `builtin://${encodeURIComponent(skill.name)}/SKILL.md`
    return pathToFileURL(skill.location).href
  }

  export function fmt(list: Info[], opts: { verbose: boolean; recommended?: Set<string> }) {
    if (list.length === 0) return "No skills are currently available."

    if (opts.verbose) {
      return [
        "<available_skills>",
        ...list.flatMap((skill) => {
          const recommended = opts.recommended?.has(skill.name)
          return [
            recommended ? `  <skill recommended="true">` : "  <skill>",
            `    <name>${escapeMetadata(skill.name)}</name>`,
            `    <description>${escapeMetadata(skill.description)}</description>`,
            `    <location>${formatLocation(skill)}</location>`,
            ...(recommended
              ? [`    <note>This skill matches files in the current context. Consider loading it.</note>`]
              : []),
            "  </skill>",
          ]
        }),
        "</available_skills>",
      ].join("\n")
    }

    return [
      "## Available Skills",
      ...list.map((skill) => {
        const marker = opts.recommended?.has(skill.name) ? " (recommended - matches current files)" : ""
        return `- **${escapeMetadata(skill.name)}**: ${escapeMetadata(skill.description)}${marker}`
      }),
    ].join("\n")
  }

  export function matchByPaths(skills: Info[], filePaths: string[]): Info[] {
    if (filePaths.length === 0) return []
    return skills.filter((skill) => {
      if (!skill.paths?.length) return false
      return skill.paths.some((pattern) => filePaths.some((fp) => Glob.match(pattern, fp)))
    })
  }

  const validateStandardSkill = SkillValidate.validateStandardSkill

  function sourceToolFromDir(dir: string): Info["sourceTool"] {
    if (dir === ".opencode") return "opencode"
    if (dir === ".claude") return "claude"
    if (dir === ".agents") return "agents"
    return "ax-code"
  }

  export async function get(name: string) {
    const s = await state()
    return s.skills[name]
  }

  export async function all() {
    const s = await state()
    return Object.values(s.skills)
  }

  export async function dirs() {
    const s = await state()
    return Array.from(s.dirs)
  }

  export async function available(agent?: Agent.Info) {
    const s = await state()
    const list = Object.values(s.skills).toSorted((a, b) => a.name.localeCompare(b.name))
    if (!agent) return list
    return list.filter((skill) => Permission.evaluate("skill", skill.name, agent.permission).action !== "deny")
  }
}
