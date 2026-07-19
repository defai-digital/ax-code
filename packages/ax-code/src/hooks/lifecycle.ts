/**
 * User-visible lifecycle hooks (ADR-048 Phase 3).
 *
 * Maps Claude-style PreToolUse / PostToolUse / Stop names onto AX Code's
 * plugin triggers and session end, and loads shell packs from:
 * - built-in packs under packages/ax-code/hooks/packs
 * - project `.ax-code/hooks.json`
 * - config `hooks` field
 */

import { spawn } from "child_process"
import fs from "fs/promises"
import path from "path"
import z from "zod"
import { Log } from "@/util/log"
import { parseJsonResult } from "@/util/json-value"
import { Global } from "@/global"
import { Instance } from "@/project/instance"
import { ProjectConfigTrust } from "@/config/project-config-trust"

const log = Log.create({ service: "hooks.lifecycle" })

export namespace LifecycleHooks {
  const HOOK_TIMEOUT_MS = 30_000
  const MAX_CONCURRENT_HOOKS = 4
  const MAX_CAPTURE_BYTES = 1024 * 1024
  const MAX_COMPAT_ENV_BYTES = 32 * 1024
  const READ_HOOK_ARGS =
    "const fs=require('fs');const raw=process.env.HOOK_ARGS_JSON||fs.readFileSync(0,'utf8')||'{}';const a=JSON.parse(raw);"
  let activeHooks = 0
  const hookWaiters: Array<() => void> = []

  async function acquireHookSlot() {
    if (activeHooks < MAX_CONCURRENT_HOOKS) {
      activeHooks++
      return
    }
    await new Promise<void>((resolve) => hookWaiters.push(resolve))
  }

  function releaseHookSlot() {
    const next = hookWaiters.shift()
    if (next) next()
    else activeHooks--
  }
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
          command: `node -e "${READ_HOOK_ARGS}const c=String(a.command||'');if(/git\\s+push\\s+.*(--force|-f)\\b/.test(c)){console.error('Blocked force push by block-force-push hook');process.exit(2)}"`,
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
          command: `node -e "${READ_HOOK_ARGS}const s=JSON.stringify(a);if(/\\.env($|[^a-z])/i.test(s)){console.error('[hook:protect-env-files] Tool args reference .env — double-check secrets handling');}"`,
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
          command: `node -e "${READ_HOOK_ARGS}console.error('[hook:log-bash]', String(a.command||'').slice(0,500))"`,
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

  export async function loadProjectHooks(
    directory: string,
    trusted = ProjectConfigTrust.enabled(),
  ): Promise<HookCommand[]> {
    if (!trusted) return []
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

  function appendCaptured(current: string, chunk: Buffer | string) {
    if (Buffer.byteLength(current) >= MAX_CAPTURE_BYTES) return current
    const remaining = MAX_CAPTURE_BYTES - Buffer.byteLength(current)
    return current + Buffer.from(chunk).subarray(0, remaining).toString("utf8")
  }

  async function runHookProcess(hook: HookCommand, input: RunInput): Promise<RunResult["outputs"][number]> {
    const argsJson = JSON.stringify(input.args ?? {})
    const env = {
      ...process.env,
      HOOK_EVENT: input.event,
      HOOK_TOOL: input.tool ?? "",
      HOOK_SESSION_ID: input.sessionID ?? "",
      // Preserve compatibility for ordinary payloads. Large payloads travel
      // only over stdin so spawning cannot fail with E2BIG.
      HOOK_ARGS_JSON: Buffer.byteLength(argsJson) <= MAX_COMPAT_ENV_BYTES ? argsJson : "",
      HOOK_ARGS_STDIN: "1",
      HOOK_PACK: hook.pack ?? "",
    }
    const detached = process.platform !== "win32"
    const child = spawn(hook.command, {
      shell: true,
      cwd: input.cwd ?? process.cwd(),
      env,
      detached,
      stdio: ["pipe", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    let timedOut = false
    let settled = false
    child.stdout.on("data", (chunk) => {
      stdout = appendCaptured(stdout, chunk)
    })
    child.stderr.on("data", (chunk) => {
      stderr = appendCaptured(stderr, chunk)
    })
    // A hook may exit before consuming its input. EPIPE is part of normal
    // process teardown and must not become an uncaught exception.
    child.stdin.on("error", () => undefined)
    child.stdin.end(argsJson)

    const exit = await new Promise<number>((resolve) => {
      const finish = (code: number) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(code)
      }
      const timer = setTimeout(() => {
        timedOut = true
        if (detached && child.pid) {
          try {
            process.kill(-child.pid, "SIGKILL")
          } catch {
            child.kill("SIGKILL")
          }
        } else {
          child.kill("SIGKILL")
        }
      }, HOOK_TIMEOUT_MS)
      timer.unref?.()
      child.once("error", (error) => {
        stderr = appendCaptured(stderr, error instanceof Error ? error.message : String(error))
        finish(1)
      })
      child.once("close", (code, signal) => finish(timedOut ? 124 : (code ?? (signal ? 1 : 0))))
    })

    return { command: hook.command, exit, stdout, stderr }
  }

  async function runHook(hook: HookCommand, input: RunInput): Promise<RunResult["outputs"][number]> {
    await acquireHookSlot()
    try {
      return await runHookProcess(hook, input)
    } finally {
      releaseHookSlot()
    }
  }

  export async function runHooks(hooks: readonly HookCommand[], input: RunInput): Promise<RunResult> {
    const selected = selectHooks(hooks, input.event, input.tool)
    const outputs: RunResult["outputs"] = []
    let blocked = false
    for (const hook of selected) {
      const result = await runHook(hook, input)
      outputs.push(result)
      if (result.exit !== 0) {
        log.warn("lifecycle hook non-zero", { event: input.event, tool: input.tool, exit: result.exit })
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
