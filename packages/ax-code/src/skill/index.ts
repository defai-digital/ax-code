import os from "os"
import path from "path"
import { pathToFileURL } from "url"
import z from "zod"
import { Effect, Layer, ServiceMap } from "effect"
import { NamedError } from "@ax-code/util/error"
import type { Agent } from "@/agent/agent"
import { Bus } from "@/bus"
import { InstanceState } from "@/effect/instance-state"
import { makeRunPromise } from "@/effect/run-service"
import { Flag } from "@/flag/flag"
import { Global } from "@/global"
import { Permission } from "@/permission"
import { Filesystem } from "@/util/filesystem"
import { Config } from "../config/config"
import { ConfigMarkdown } from "../config/markdown"
import { Glob } from "../util/glob"
import { Log } from "../util/log"
import { Discovery } from "./discovery"

export namespace Skill {
  const log = Log.create({ service: "skill" })
  const EXTERNAL_DIRS = [".claude", ".agents"]
  const EXTERNAL_SKILL_PATTERN = "skills/**/SKILL.md"
  const AX_CODE_SKILL_PATTERN = "{skill,skills}/**/SKILL.md"
  const SKILL_PATTERN = "**/SKILL.md"

  export const Info = z.object({
    name: z.string(),
    description: z.string(),
    location: z.string(),
    content: z.string(),
    paths: z.array(z.string()).optional(),
  })
  export type Info = z.infer<typeof Info>

  type State = {
    skills: Record<string, Info>
    dirs: Set<string>
  }

  export interface Interface {
    readonly get: (name: string) => Effect.Effect<Info | undefined>
    readonly all: () => Effect.Effect<Info[]>
    readonly dirs: () => Effect.Effect<string[]>
    readonly available: (agent?: Agent.Info) => Effect.Effect<Info[]>
  }

  const addSkill = (state: State, match: string) =>
    Effect.promise(async () => {
      const md = await ConfigMarkdown.parse(match).catch(async (err) => {
        const message = ConfigMarkdown.FrontmatterError.isInstance(err)
          ? err.data.message
          : `Failed to parse skill ${match}`
        const { Session } = await import("@/session")
        Bus.publishDetached(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
        log.error("failed to load skill", { skill: match, err })
        return undefined
      })

      if (!md) return

      const parsed = Info.pick({ name: true, description: true }).safeParse(md.data)
      if (!parsed.success) return

      if (state.skills[parsed.data.name]) {
        log.warn("duplicate skill name", {
          name: parsed.data.name,
          existing: state.skills[parsed.data.name].location,
          duplicate: match,
        })
      }

      const raw = md.data.paths
      const paths = Array.isArray(raw)
        ? raw.filter((p: unknown) => typeof p === "string")
        : typeof raw === "string"
          ? raw
              .split(",")
              .map((s: string) => s.trim())
              .filter(Boolean)
          : undefined

      state.dirs.add(path.dirname(match))
      state.skills[parsed.data.name] = {
        name: parsed.data.name,
        description: parsed.data.description,
        location: match,
        content: md.content,
        ...(paths?.length ? { paths } : {}),
      }
    })

  const scanDir = (state: State, root: string, pattern: string, opts?: { dot?: boolean; scope?: string }) =>
    Effect.promise(() =>
      Glob.scan(pattern, {
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
      }),
    ).pipe(Effect.flatMap((matches) => Effect.forEach(matches, (match) => addSkill(state, match), { discard: true })))

  export class Service extends ServiceMap.Service<Service, Interface>()("@ax-code/Skill") {}

  export const layer: Layer.Layer<Service, never, Discovery.Service> = Layer.effect(
    Service,
    Effect.gen(function* () {
      const discovery = yield* Discovery.Service
      const state = yield* InstanceState.make(
        Effect.fn("Skill.state")(function* (ctx) {
          const s: State = {
            skills: {},
            dirs: new Set<string>(),
          }

          if (!Flag.AX_CODE_DISABLE_EXTERNAL_SKILLS) {
            for (const dir of EXTERNAL_DIRS) {
              const root = path.join(Global.Path.home, dir)
              const exists = yield* Effect.promise(() => Filesystem.isDir(root))
              if (!exists) continue
              yield* scanDir(s, root, EXTERNAL_SKILL_PATTERN, { dot: true, scope: "global" })
            }

            const roots = yield* Effect.promise(async () => {
              const result: string[] = []
              for await (const root of Filesystem.up({
                targets: EXTERNAL_DIRS,
                start: ctx.directory,
                stop: ctx.worktree,
              })) {
                result.push(root)
              }
              return result
            })
            yield* Effect.forEach(
              roots,
              (root) => scanDir(s, root, EXTERNAL_SKILL_PATTERN, { dot: true, scope: "project" }),
              { discard: true },
            )
          }

          const configDirs = yield* Effect.promise(() => Config.directories())
          yield* Effect.forEach(configDirs, (dir) => scanDir(s, dir, AX_CODE_SKILL_PATTERN), { discard: true })

          const cfg = yield* Effect.promise(() => Config.get())
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
            const exists = yield* Effect.promise(() => Filesystem.isDir(resolved))
            if (!exists) {
              log.warn("skill path not found", { path: resolved })
              continue
            }
            yield* scanDir(s, resolved, SKILL_PATTERN)
          }

          for (const url of cfg.skills?.urls ?? []) {
            const dirs = yield* discovery.pull(url)
            for (const dir of dirs) {
              s.dirs.add(dir)
              yield* scanDir(s, dir, SKILL_PATTERN)
            }
          }

          log.info("init", { count: Object.keys(s.skills).length })
          return s
        }),
      )

      const get = Effect.fn("Skill.get")(function* (name: string) {
        const s = yield* InstanceState.get(state)
        return s.skills[name]
      })

      const all = Effect.fn("Skill.all")(function* () {
        const s = yield* InstanceState.get(state)
        return Object.values(s.skills)
      })

      const dirs = Effect.fn("Skill.dirs")(function* () {
        const s = yield* InstanceState.get(state)
        return Array.from(s.dirs)
      })

      const available = Effect.fn("Skill.available")(function* (agent?: Agent.Info) {
        const s = yield* InstanceState.get(state)
        const list = Object.values(s.skills).toSorted((a, b) => a.name.localeCompare(b.name))
        if (!agent) return list
        return list.filter((skill) => Permission.evaluate("skill", skill.name, agent.permission).action !== "deny")
      })

      return Service.of({ get, all, dirs, available })
    }),
  )

  export const defaultLayer: Layer.Layer<Service> = layer.pipe(Layer.provide(Discovery.defaultLayer))

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

  export function fmt(list: Info[], opts: { verbose: boolean; recommended?: Set<string> }) {
    if (list.length === 0) return "No skills are currently available."

    if (opts.verbose) {
      return [
        "<available_skills>",
        ...list.flatMap((skill) => {
          const auto = opts.recommended?.has(skill.name)
          return [
            auto ? `  <skill auto_activated="true">` : "  <skill>",
            `    <name>${escapeMetadata(skill.name)}</name>`,
            `    <description>${escapeMetadata(skill.description)}</description>`,
            `    <location>${pathToFileURL(skill.location).href}</location>`,
            ...(auto ? [`    <note>This skill matches files in the current context. Consider loading it.</note>`] : []),
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

  const runPromise = makeRunPromise(Service, defaultLayer)

  export async function get(name: string) {
    return runPromise((skill) => skill.get(name))
  }

  export async function all() {
    return runPromise((skill) => skill.all())
  }

  export async function dirs() {
    return runPromise((skill) => skill.dirs())
  }

  export async function available(agent?: Agent.Info) {
    return runPromise((skill) => skill.available(agent))
  }
}
