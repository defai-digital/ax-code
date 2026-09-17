/**
 * User-visible lifecycle hooks (ADR-048 Phase 3).
 *
 * Maps Claude-style PreToolUse / PostToolUse / Stop / UserPromptSubmit /
 * PreCompact / SubagentStop names onto AX Code's
 * plugin triggers and session end, and loads shell packs from:
 * - built-in packs under packages/ax-code/hooks/packs
 * - project `.ax-code/hooks.json`
 * - config `hooks` field
 *
 * Observation-only events (ADR-057): SessionStart, SessionEnd, PostCompact,
 * Interrupt, PostToolUseFailure. They are NOT in BLOCKABLE_EVENTS, so a
 * non-zero exit can never veto anything — `runHooks` logs the failure and
 * continues.
 *
 * Claude Code wire protocol (ADR-048 D4, opt-in per entry): a hook entry may
 * declare `"protocol": "claude-code"`. For blockable events (PreToolUse,
 * UserPromptSubmit) the process output is then decoded with Claude Code
 * semantics INSTEAD of the legacy `blockOnFailure` check:
 * - exit 2 blocks and surfaces stderr as the reason (a structured stdout
 *   `reason` wins when present; malformed stdout still blocks — fail-safe)
 * - exit 0 with stdout JSON `{"permissionDecision": "allow"|"deny"|"ask",
 *   "reason"?}` maps to proceed / block with reason / interactive
 *   confirmation. The nested Claude Code shape
 *   `{"hookSpecificOutput": {"permissionDecision", "permissionDecisionReason"}}`
 *   is accepted as an alias. "ask" is surfaced as `RunResult.ask`; the tool
 *   lifecycle routes it through the calling tool's permission channel (an
 *   interactive-only `hook` permission), and sites without such a channel
 *   (UserPromptSubmit) keep the fail-safe block.
 * - any other exit is a non-blocking error
 * Observation-only events ignore the decoder entirely (fail-open preserved),
 * and entries without the field behave byte-identically to the legacy path.
 *
 * PostToolUse feedback: a PostToolUse hook can hand text back to the model.
 * Legacy entries contribute their trimmed stdout; `protocol: "claude-code"`
 * entries contribute `hookSpecificOutput.additionalContext`, a
 * `{"decision": "block", "reason"}` reason, or exit-2 stderr. Feedback is
 * bounded (per hook and in total) and appended to the tool result by the
 * tool lifecycle; it never replaces the tool output and never blocks.
 *
 * PostToolUseFailure fires (observation-only) when a tool throws after
 * PreToolUse admitted it; its args carry the error message.
 *
 * Security note: hook child processes receive `Env.sanitize(process.env)` by
 * default. This removes ambient secrets, credential helpers, credential-bearing
 * URLs, and process-injection variables before repository-controlled hook code
 * runs. Fully trusted legacy hooks can opt back into the complete environment
 * with the host-only `AX_CODE_HOOKS_FULL_ENV=1` escape hatch (ADR-057 D4).
 * Hooks remain arbitrary, unsandboxed shell code and must still be reviewed.
 */

import { spawn } from "child_process"
import fs from "fs/promises"
import path from "path"
import z from "zod"
import { Log } from "@/util/log"
import { parseJsonResult, parseJsonPayload } from "@/util/json-value"
import { Env } from "@/util/env"
import { Global } from "@/global"
import { Instance } from "@/project/instance"
import { ProjectConfigTrust } from "@/config/project-config-trust"

const log = Log.create({ service: "hooks.lifecycle" })

export namespace LifecycleHooks {
  const HOOK_TIMEOUT_MS = 30_000
  const MAX_CONCURRENT_HOOKS = 4
  const MAX_CAPTURE_BYTES = 1024 * 1024
  const MAX_COMPAT_ENV_BYTES = 32 * 1024
  const FULL_ENV_FLAG = "AX_CODE_HOOKS_FULL_ENV"
  const READ_HOOK_ARGS =
    "const fs=require('fs');const raw=process.env.HOOK_ARGS_JSON||fs.readFileSync(0,'utf8')||'{}';const a=JSON.parse(raw);"
  let activeHooks = 0
  let fullEnvWarningShown = false
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
  /** Per-hook and aggregate ceilings for model-visible PostToolUse feedback. */
  const MAX_FEEDBACK_CHARS_PER_HOOK = 4_000
  const MAX_FEEDBACK_CHARS_TOTAL = 8_000
  const EventNameSchema = z.enum([
    "PreToolUse",
    "PostToolUse",
    "PostToolUseFailure",
    "Stop",
    "UserPromptSubmit",
    "PreCompact",
    "SubagentStop",
    "SessionStart",
    "SessionEnd",
    "PostCompact",
    "Interrupt",
  ])
  const HookCommandSchema = z.object({
    event: EventNameSchema,
    /** Shell command; receives env HOOK_EVENT, HOOK_TOOL, HOOK_SESSION_ID, HOOK_ARGS_JSON. */
    command: z.string().min(1).max(100_000),
    /** Optional matcher: tool id glob (* = all). */
    matcher: z.string().max(500).optional(),
    /** When true, non-zero exit blocks the action (PreToolUse and UserPromptSubmit only). */
    blockOnFailure: z.boolean().optional(),
    /**
     * Opt-in wire protocol decoder. "claude-code" decodes process output with
     * Claude Code hook semantics (exit 2 blocks; stdout permissionDecision
     * JSON) for blockable events, replacing the blockOnFailure check.
     */
    protocol: z.literal("claude-code").optional(),
    pack: z.string().max(500).optional(),
  })

  /**
   * Structured stdout contract for `protocol: "claude-code"` entries. The
   * flat shape is AX Code's documented form; the nested `hookSpecificOutput`
   * shape is what Claude Code hooks actually emit, so both are accepted.
   */
  const ClaudeCodeDecisionSchema = z
    .object({
      permissionDecision: z.enum(["allow", "deny", "ask"]).optional(),
      reason: z.string().optional(),
      decision: z.enum(["approve", "block"]).optional(),
      hookSpecificOutput: z
        .object({
          permissionDecision: z.enum(["allow", "deny", "ask"]).optional(),
          permissionDecisionReason: z.string().optional(),
          additionalContext: z.string().optional(),
        })
        .partial()
        .optional(),
    })
    .partial()

  type ClaudeCodeDecision = z.infer<typeof ClaudeCodeDecisionSchema>

  function parseStructuredStdout(output: RunResult["outputs"][number]): ClaudeCodeDecision | undefined {
    const text = output.stdout.trim()
    const parsed = text.startsWith("{") ? parseJsonPayload(text) : undefined
    const decision = parsed === undefined ? undefined : ClaudeCodeDecisionSchema.safeParse(parsed)
    return decision?.success ? decision.data : undefined
  }

  function permissionDecisionOf(structured: ClaudeCodeDecision | undefined) {
    return structured?.permissionDecision ?? structured?.hookSpecificOutput?.permissionDecision
  }

  function permissionReasonOf(structured: ClaudeCodeDecision | undefined) {
    return structured?.reason ?? structured?.hookSpecificOutput?.permissionDecisionReason
  }

  /**
   * Decode a finished hook process under Claude Code wire semantics. Only
   * consulted for blockable events on entries that opted in via `protocol`.
   * Exit 2 always blocks (structured `reason` beats raw stderr; malformed
   * stdout still blocks). On exit 0 a `permissionDecision` of `deny` blocks
   * with its reason and `ask` requests interactive confirmation, which the
   * caller must either route to a permission channel or treat as a block.
   */
  function decodeClaudeCodeDecision(output: RunResult["outputs"][number]): {
    block: boolean
    ask?: boolean
    reason?: string
  } {
    const stderr = output.stderr.trim()
    const structured = parseStructuredStdout(output)
    const reason = permissionReasonOf(structured)
    if (output.exit === 2) {
      return { block: true, reason: reason ?? (stderr || undefined) }
    }
    if (output.exit !== 0 || !structured) return { block: false }
    const decision = permissionDecisionOf(structured)
    if (decision === undefined || decision === "allow") return { block: false }
    if (decision === "deny") {
      return { block: true, reason: reason ?? (stderr || undefined) }
    }
    return { block: false, ask: true, reason: reason ?? "hook requested user confirmation" }
  }

  function boundFeedback(text: string, limit: number) {
    const trimmed = text.trim()
    if (trimmed.length <= limit) return trimmed
    return `${trimmed.slice(0, limit)}\n[hook feedback truncated to ${limit} characters]`
  }

  /**
   * Model-visible feedback from a finished PostToolUse hook. Legacy entries
   * hand back their stdout; protocol entries hand back the Claude Code
   * `additionalContext`, a block reason, or exit-2 stderr. Timeouts and
   * unexpected exits contribute nothing so a broken hook cannot spam the
   * model.
   */
  function decodePostToolUseFeedback(hook: HookCommand, output: RunResult["outputs"][number]): string | undefined {
    if (hook.protocol !== "claude-code") {
      if (output.exit !== 0) return undefined
      const text = boundFeedback(output.stdout, MAX_FEEDBACK_CHARS_PER_HOOK)
      return text.length > 0 ? text : undefined
    }
    if (output.exit === 2) {
      const structured = parseStructuredStdout(output)
      const text = boundFeedback(structured?.reason ?? output.stderr, MAX_FEEDBACK_CHARS_PER_HOOK)
      return text.length > 0 ? text : undefined
    }
    if (output.exit !== 0) return undefined
    const structured = parseStructuredStdout(output)
    if (!structured) return undefined
    const pieces: string[] = []
    if (structured.decision === "block" && structured.reason) pieces.push(structured.reason)
    const context = structured.hookSpecificOutput?.additionalContext
    if (context) pieces.push(context)
    const text = boundFeedback(pieces.join("\n"), MAX_FEEDBACK_CHARS_PER_HOOK)
    return text.length > 0 ? text : undefined
  }

  /** Events where a blockOnFailure hook with non-zero exit vetoes the action. */
  const BLOCKABLE_EVENTS: ReadonlySet<z.infer<typeof EventNameSchema>> = new Set(["PreToolUse", "UserPromptSubmit"])

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
    /** Block reason surfaced by the claude-code protocol decoder, when set. */
    blockReason?: string
    /**
     * A PreToolUse protocol hook answered `ask`: the action is admissible only
     * after interactive confirmation. Callers without a permission channel
     * must treat this as a block. A later deny still wins over an ask.
     */
    ask?: { reason: string }
    /**
     * Bounded, model-visible text handed back by PostToolUse hooks, joined in
     * hook order. Undefined when no hook produced feedback.
     */
    feedback?: string
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

  function hookProcessEnv(): NodeJS.ProcessEnv {
    if (Env.parseBoolean(process.env[FULL_ENV_FLAG]) !== true) return Env.sanitize(process.env)
    if (!fullEnvWarningShown) {
      fullEnvWarningShown = true
      log.warn("lifecycle hooks are inheriting the full process environment", {
        flag: FULL_ENV_FLAG,
        risk: "hook commands can read ambient credentials and process-injection variables",
      })
    }
    return { ...process.env }
  }

  async function runHookProcess(hook: HookCommand, input: RunInput): Promise<RunResult["outputs"][number]> {
    const argsJson = JSON.stringify(input.args ?? {})
    const env = {
      ...hookProcessEnv(),
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
    let blockReason: string | undefined
    let ask: RunResult["ask"]
    const feedback: string[] = []
    let feedbackChars = 0
    for (const hook of selected) {
      const result = await runHook(hook, input)
      outputs.push(result)
      if (input.event === "PostToolUse") {
        const text = decodePostToolUseFeedback(hook, result)
        if (text !== undefined && feedbackChars < MAX_FEEDBACK_CHARS_TOTAL) {
          const room = MAX_FEEDBACK_CHARS_TOTAL - feedbackChars
          const piece = text.length > room ? boundFeedback(text, room) : text
          feedback.push(piece)
          feedbackChars += piece.length
        }
      }
      if (hook.protocol === "claude-code" && BLOCKABLE_EVENTS.has(input.event)) {
        // Opted-in entries follow Claude Code wire semantics instead of the
        // legacy blockOnFailure check.
        const decoded = decodeClaudeCodeDecision(result)
        if (decoded.block) {
          log.warn("lifecycle hook blocked (claude-code protocol)", {
            event: input.event,
            tool: input.tool,
            exit: result.exit,
          })
          blocked = true
          blockReason = decoded.reason
          break
        }
        if (decoded.ask) {
          // Keep evaluating: a later hook may still deny, and deny wins.
          ask = ask ?? { reason: decoded.reason ?? "hook requested user confirmation" }
        }
        if (result.exit !== 0) {
          log.warn("lifecycle hook non-zero", { event: input.event, tool: input.tool, exit: result.exit })
        }
        continue
      }
      if (result.exit !== 0) {
        log.warn("lifecycle hook non-zero", { event: input.event, tool: input.tool, exit: result.exit })
        if (hook.blockOnFailure && BLOCKABLE_EVENTS.has(input.event)) {
          blocked = true
          break
        }
      }
    }
    return {
      ok: !blocked,
      blocked,
      ...(blockReason === undefined ? {} : { blockReason }),
      ...(blocked || ask === undefined ? {} : { ask }),
      ...(feedback.length === 0 ? {} : { feedback: feedback.join("\n\n") }),
      outputs,
    }
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
