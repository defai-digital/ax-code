/**
 * User-visible lifecycle hooks (ADR-048 Phase 3).
 *
 * Maps Claude-style PreToolUse / PostToolUse / Stop names onto AX Code's
 * plugin triggers and session end, and loads shell packs from:
 * - built-in packs under packages/ax-code/hooks/packs
 * - project `.ax-code/hooks.json`
 * - config `hooks` field
 */

import { spawnSync } from "child_process"
import fs from "fs/promises"
import path from "path"
import z from "zod"
import { Log } from "@/util/log"
import { parseJsonResult } from "@/util/json-value"
import { Global } from "@/global"
import { Instance } from "@/project/instance"

const log = Log.create({ service: "hooks.lifecycle" })

export namespace LifecycleHooks {
  const EventNameSchema = z.enum(["PreToolUse", "PostToolUse", "Stop"])
  const HookCommandSchema = z.object({
    event: EventNameSchema,
    /** Shell command; receives env HOOK_EVENT, HOOK_TOOL, HOOK_SESSION_ID, HOOK_ARGS_JSON. */
    command: z.string().min(1).max(100_000),
    /** Optional matcher: tool id glob (* = all). */
    matcher: z.string().max(500).optional(),
    /** When true, non-zero exit blocks the tool (PreToolUse only). */
    blockOnFailure: z.boolean().optional(),
    pack: z.string().max(500).optional(),
  })

  export type EventName = z.infer<typeof EventNameSchema>
  export type HookCommand = z.infer<typeof HookCommandSchema>

  const ProjectHooksSchema = z.object({
    hooks: z.array(HookCommandSchema).max(100).optional(),
    packs: z.array(z.string().min(1).max(500)).max(100).optional(),
  })

  export type Pack = {
    name: string
    description: string
    hooks: HookCommand[]
  }

  export type RunInput = {
    event: EventName
    sessionID?: string
    tool?: string
    args?: unknown
    cwd?: string
  }

  export type RunResult = {
    ok: boolean
    blocked: boolean
    outputs: Array<{ command: string; exit: number; stdout: string; stderr: string }>
  }

  const BUILTIN_PACKS: Pack[] = [
    {
      name: "format-after-edit",
      description: "Hint to run project formatter after edit/write tools",
      hooks: [
        {
          event: "PostToolUse",
          matcher: "edit|write|multiedit|apply_patch",
          command: 'echo "[hook:format-after-edit] Consider formatting changed files (prettier/eslint --fix/rustfmt)."',
          pack: "format-after-edit",
        },
      ],
    },
    {
      name: "block-force-push",
      description: "Block bash force-push to remote",
      hooks: [
        {
          event: "PreToolUse",
          matcher: "bash",
          blockOnFailure: true,
          command: `node -e "const a=JSON.parse(process.env.HOOK_ARGS_JSON||'{}');const c=String(a.command||'');if(/git\\s+push\\s+.*(--force|-f)\\b/.test(c)){console.error('Blocked force push by block-force-push hook');process.exit(2)}"`,
          pack: "block-force-push",
        },
      ],
    },
    {
      name: "require-tests-on-stop",
      description: "Remind agent to verify before ending a mutating session",
      hooks: [
        {
          event: "Stop",
          command:
            'echo "[hook:require-tests-on-stop] If files were changed this session, ensure tests/typecheck/verify_project ran after the last mutation."',
          pack: "require-tests-on-stop",
        },
      ],
    },
    {
      name: "protect-env-files",
      description: "Warn when tools target .env files",
      hooks: [
        {
          event: "PreToolUse",
          matcher: "read|edit|write|bash",
          command: `node -e "const a=JSON.parse(process.env.HOOK_ARGS_JSON||'{}');const s=JSON.stringify(a);if(/\\.env($|[^a-z])/i.test(s)){console.error('[hook:protect-env-files] Tool args reference .env — double-check secrets handling');}"`,
          pack: "protect-env-files",
        },
      ],
    },
    {
      name: "log-bash-commands",
      description: "Log every bash command to stderr for audit",
      hooks: [
        {
          event: "PreToolUse",
          matcher: "bash",
          command: `node -e "const a=JSON.parse(process.env.HOOK_ARGS_JSON||'{}');console.error('[hook:log-bash]', String(a.command||'').slice(0,500))"`,
          pack: "log-bash-commands",
        },
      ],
    },
  ]

  export function listBuiltinPacks(): Pack[] {
    return BUILTIN_PACKS.map((p) => ({ ...p, hooks: p.hooks.map((h) => ({ ...h })) }))
  }

  export function matcherHits(matcher: string | undefined, tool: string | undefined): boolean {
    if (!matcher || matcher === "*") return true
    if (!tool) return matcher === "*"
    const parts = matcher
      .split("|")
      .map((p) => p.trim())
      .filter(Boolean)
    return parts.some((part) => {
      if (part.endsWith("*")) return tool.startsWith(part.slice(0, -1))
      return part === tool
    })
  }

  export function selectHooks(hooks: readonly HookCommand[], event: EventName, tool?: string): HookCommand[] {
    return hooks.filter((h) => h.event === event && matcherHits(h.matcher, tool))
  }

  export async function loadProjectHooks(directory: string): Promise<HookCommand[]> {
    const file = path.join(directory, ".ax-code", "hooks.json")
    try {
      const raw = await fs.readFile(file, "utf8")
      const decoded = parseJsonResult(raw)
      if (!decoded.ok) return []
      const result = ProjectHooksSchema.safeParse(decoded.value)
      if (!result.success) return []
      const parsed = result.data
      const fromPacks: HookCommand[] = []
      for (const name of parsed.packs ?? []) {
        const pack = BUILTIN_PACKS.find((p) => p.name === name)
        if (pack) fromPacks.push(...pack.hooks)
      }
      return [...fromPacks, ...(parsed.hooks ?? [])]
    } catch {
      return []
    }
  }

  /** Resolve hooks for a workspace: project file + optional pack names from config. */
  export async function resolveHooks(input: {
    directory: string
    packNames?: string[]
    extra?: HookCommand[]
  }): Promise<HookCommand[]> {
    const fromProject = await loadProjectHooks(input.directory)
    const fromConfigPacks: HookCommand[] = []
    for (const name of input.packNames ?? []) {
      const pack = BUILTIN_PACKS.find((p) => p.name === name)
      if (pack) fromConfigPacks.push(...pack.hooks)
    }
    return [...fromConfigPacks, ...fromProject, ...(input.extra ?? [])]
  }

  export function runHooks(hooks: readonly HookCommand[], input: RunInput): RunResult {
    const selected = selectHooks(hooks, input.event, input.tool)
    const outputs: RunResult["outputs"] = []
    let blocked = false
    for (const hook of selected) {
      const env = {
        ...process.env,
        HOOK_EVENT: input.event,
        HOOK_TOOL: input.tool ?? "",
        HOOK_SESSION_ID: input.sessionID ?? "",
        HOOK_ARGS_JSON: JSON.stringify(input.args ?? {}),
        HOOK_PACK: hook.pack ?? "",
      }
      const result = spawnSync(hook.command, {
        shell: true,
        cwd: input.cwd ?? process.cwd(),
        env,
        encoding: "utf8",
        timeout: 30_000,
      })
      const exit = result.status ?? (result.error ? 1 : 0)
      outputs.push({
        command: hook.command,
        exit,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
      })
      if (exit !== 0) {
        log.warn("lifecycle hook non-zero", { event: input.event, tool: input.tool, exit })
        if (hook.blockOnFailure && input.event === "PreToolUse") {
          blocked = true
          break
        }
      }
    }
    return { ok: !blocked, blocked, outputs }
  }

  export async function runForWorkspace(input: RunInput & { packNames?: string[] }): Promise<RunResult> {
    const directory = input.cwd ?? Instance.directory
    const hooks = await resolveHooks({ directory, packNames: input.packNames })
    return runHooks(hooks, { ...input, cwd: directory })
  }

  export function packCatalogMarkdown(): string {
    const lines = [
      "# AX Code official hook packs",
      "",
      "Enable packs via `.ax-code/hooks.json`:",
      "",
      "```json",
      '{ "packs": ["format-after-edit", "block-force-push", "require-tests-on-stop", "protect-env-files", "log-bash-commands"] }',
      "```",
      "",
      "| Pack | Events | Description |",
      "|------|--------|-------------|",
      ...BUILTIN_PACKS.map(
        (p) => `| \`${p.name}\` | ${[...new Set(p.hooks.map((h) => h.event))].join(", ")} | ${p.description} |`,
      ),
      "",
    ]
    return lines.join("\n")
  }

  export function globalHooksDir(): string {
    return path.join(Global.Path.config, "hooks")
  }
}
