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
 * Interrupt, PostToolUseFailure, and the ADR-259 trio PermissionRequest,
 * StopFailure, Notification. They are NOT in BLOCKABLE_EVENTS, so a
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
import { Instance } from "@/project/instance"
import { ProjectConfigTrust } from "@/config/project-config-trust"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { truncateUtf8Bytes } from "@/tool/bash-helpers"
import { StringDecoder } from "node:string_decoder"

const log = Log.create({ service: "hooks.lifecycle" })

export namespace LifecycleHooks {
  const HOOK_TIMEOUT_MS = 30_000
  const MAX_TIMER_MS = 2_147_483_647
  const MAX_CONCURRENT_HOOKS = 4
  const MAX_CAPTURE_BYTES = 1024 * 1024
  /** Read per call so tests can shorten it; an invalid value falls back. */
  function hookTimeoutMs(): number {
    const raw = process.env["AX_CODE_HOOK_TIMEOUT_MS"]
    const parsed = raw === undefined || raw === "" ? Number.NaN : Number(raw)
    // Node treats a delay above 2^31-1 ms as 1 ms, which would kill every hook
    // at once (and block every blockOnFailure tool), so reject those too.
    return Number.isFinite(parsed) && parsed > 0 && parsed <= MAX_TIMER_MS ? parsed : HOOK_TIMEOUT_MS
  }
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
    // ADR-259 observation-only events: a permission prompt was raised, a turn
    // ended in failure, or a user-facing notification fired. Payloads are
    // redacted at the log boundary and never carry tool arguments.
    "PermissionRequest",
    "StopFailure",
    "Notification",
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
      // Each field is read independently, so a wrong-typed sibling (e.g. a
      // serialized `reason: null`) must not discard an otherwise valid verdict
      // — that turned a `deny` into an allow (fail-open). Coerce an individual
      // field to undefined on a type mismatch instead of failing the object.
      permissionDecision: z.enum(["allow", "deny", "ask"]).optional().catch(undefined),
      updatedInput: z.record(z.string(), z.unknown()).optional().catch(undefined),
      reason: z.string().optional().catch(undefined),
      decision: z.enum(["approve", "block"]).optional().catch(undefined),
      hookSpecificOutput: z
        .object({
          permissionDecision: z.enum(["allow", "deny", "ask"]).optional().catch(undefined),
          permissionDecisionReason: z.string().optional().catch(undefined),
          additionalContext: z.string().optional().catch(undefined),
          updatedInput: z.record(z.string(), z.unknown()).optional().catch(undefined),
        })
        .partial()
        .optional()
        .catch(undefined),
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
  export function decodeClaudeCodeDecision(output: RunResult["outputs"][number]): {
    block: boolean
    ask?: boolean
    updatedInput?: Record<string, unknown>
    reason?: string
  } {
    const stderr = output.stderr.trim()
    const structured = parseStructuredStdout(output)
    const reason = permissionReasonOf(structured)
    if (output.exit === 2) {
      return { block: true, reason: reason ?? (stderr || undefined) }
    }
    if (output.exit !== 0 || !structured) return { block: false }
    // The schema admits the PostToolUse-style top-level `decision: "block"`
    // on every event; a hook that uses it on a blockable event means deny,
    // not "proceed" because only permissionDecision was consulted.
    if (structured.decision === "block") {
      return { block: true, reason: reason ?? (stderr || undefined) }
    }
    const decision = permissionDecisionOf(structured)
    const updatedInput = structured.updatedInput ?? structured.hookSpecificOutput?.updatedInput
    if (decision === undefined || decision === "allow") return { block: false, updatedInput }
    if (decision === "deny") {
      return { block: true, reason: reason ?? (stderr || undefined) }
    }
    return { block: false, ask: true, updatedInput, reason: reason ?? "hook requested user confirmation" }
  }

  function boundFeedback(text: string, limit: number) {
    const trimmed = text.trim()
    if (trimmed.length <= limit) return trimmed
    const suffix = `\n[hook feedback truncated to ${limit} characters]`
    if (limit <= suffix.length) return trimmed.slice(0, limit)
    return `${trimmed.slice(0, limit - suffix.length)}${suffix}`
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

  /** Longest block or ask reason carried on a `hook.completed` event. */
  const MAX_EVENT_REASON_CHARS = 1_000

  /**
   * ADR-211: one event per executed hook entry so clients can show hook
   * activity. Redacted on purpose (ADR-057 D4): no stdout, stderr or tool
   * arguments, only the bounded decision reason the model already sees.
   */
  export const Event = {
    Completed: BusEvent.define(
      "hook.completed",
      z
        .object({
          sessionID: z.string().optional(),
          event: EventNameSchema,
          tool: z.string().optional(),
          command: z.string(),
          source: z.enum(["project", "pack"]),
          pack: z.string().optional(),
          exit: z.number().int(),
          durationMs: z.number().nonnegative(),
          outcome: z.enum(["ok", "failed", "blocked", "ask", "rewritten"]),
          reason: z.string().optional(),
        })
        .meta({ ref: "HookCompleted" }),
    ),
  }

  export const Entry = z
    .object({
      event: EventNameSchema,
      matcher: z.string().optional(),
      command: z.string(),
      protocol: z.literal("claude-code").optional(),
      blockOnFailure: z.boolean().optional(),
      source: z.enum(["project", "pack"]),
      pack: z.string().optional(),
    })
    .meta({ ref: "HookEntry" })
  export type Entry = z.infer<typeof Entry>

  /** ADR-211: the hooks in effect for a directory, and why a project file may be ignored. */
  export const Workspace = z
    .object({
      trusted: z.boolean(),
      file: z.object({
        path: z.string(),
        exists: z.boolean(),
        valid: z.boolean(),
        error: z.string().optional(),
      }),
      hooks: Entry.array(),
      packs: z
        .object({
          name: z.string(),
          description: z.string(),
          enabled: z.boolean(),
        })
        .array(),
    })
    .meta({ ref: "HookWorkspace" })
  export type Workspace = z.infer<typeof Workspace>

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
    /** Runtime/config ceiling; false disables collecting rewrites. */
    allowInputRewrite?: boolean
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
    rewrite?: { updatedInput: Record<string, unknown>; hooks: string[] }
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
          // Quote-aware token scan per command segment, recursing into quoted
          // nested commands (sh -c '...'): git options may precede `push`
          // (git -C repo push), short flags cluster (-uf), and a `+refspec`
          // force-updates without any flag. The plain substring check stays as
          // a second net for shapes the tokenizer does not model.
          command: `node -e "${READ_HOOK_ARGS}const D=String.fromCharCode(34),S=String.fromCharCode(39);const tok=s=>{const o=[];let c='',q='';for(const h of s){if(q){if(h===q)q='';else c+=h}else if(h===D||h===S)q=h;else if(/\\s/.test(h)){if(c)o.push(c);c=''}else c+=h}if(c)o.push(c);return o};const opt=['-C','-c','--git-dir','--work-tree','--namespace','--super-prefix','--attr-source','--config-env','--exec-path','--list-cmds'];const chk=s=>s.split(/[;&|\\n]+/).some(seg=>{const t=tok(seg).map(x=>x.replace(/^[($\\x60{]+/,'').replace(/[)\\x60}]+$/,''));if(t.some(x=>/\\s/.test(x)&&chk(x)))return true;const g=t.findIndex(x=>/(^|\\/)git(\\.exe)?$/i.test(x.split(String.fromCharCode(92)).join('/')));if(g<0)return false;let p=-1;for(let i=g+1;i<t.length;i++){if(opt.includes(t[i])){i++;continue}if(t[i].startsWith('-'))continue;p=i;break}if(p<0||t[p]!=='push')return false;return t.slice(p+1).some(x=>x.startsWith('--force')||/^-[a-zA-Z0-9]*f/.test(x)||(x.startsWith('+')&&x.length>1))});const cmd=String(a.command||'');if(chk(cmd)||/git(\\.exe)?\\s+push\\s+.*(--force|-f)\\b/i.test(cmd)){console.error('Blocked force push by block-force-push hook');process.exit(2)}"`,
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

  /**
   * The hooks that would run in `directory`, without running anything. When
   * project config is untrusted the file is still read and validated so a
   * client can say it is ignored, but no entry from it is reported as active.
   */
  export async function describeWorkspace(
    directory: string,
    trusted = ProjectConfigTrust.enabled(),
  ): Promise<Workspace> {
    const file = path.join(directory, ".ax-code", "hooks.json")
    let exists = false
    let parsed: z.infer<typeof ProjectHooksSchema> | undefined
    let error: string | undefined
    try {
      const raw = await fs.readFile(file, "utf8")
      exists = true
      const decoded = parseJsonResult(raw)
      if (!decoded.ok) {
        error = "hooks.json is not valid JSON"
      } else {
        const result = ProjectHooksSchema.safeParse(decoded.value)
        if (result.success) parsed = result.data
        else error = `hooks.json does not match the hook schema: ${result.error.issues[0]?.message ?? "invalid"}`
      }
    } catch (cause) {
      const code = (cause as NodeJS.ErrnoException | undefined)?.code
      if (code !== "ENOENT") {
        exists = code !== "ENOTDIR"
        error = "hooks.json could not be read"
      }
    }

    const enabledPacks = new Set(trusted ? (parsed?.packs ?? []) : [])
    const hooks: Entry[] = []
    if (trusted && parsed) {
      for (const name of parsed.packs ?? []) {
        const pack = BUILTIN_PACKS.find((p) => p.name === name)
        if (pack) hooks.push(...pack.hooks.map((hook) => toEntry(hook, hookSource(hook))))
      }
      hooks.push(...(parsed.hooks ?? []).map((hook) => toEntry(hook, hookSource(hook))))
    }
    return {
      trusted,
      file: { path: file, exists, valid: exists && parsed !== undefined, ...(error ? { error } : {}) },
      hooks,
      packs: BUILTIN_PACKS.map((pack) => ({
        name: pack.name,
        description: pack.description,
        enabled: enabledPacks.has(pack.name),
      })),
    }
  }

  /**
   * Where a resolved entry came from. A project entry may carry its own
   * `pack` label, so only an entry identical to a built-in pack's hook counts
   * as a pack hook; the route and the event agree on this.
   */
  function hookSource(hook: HookCommand): Entry["source"] {
    const pack = hook.pack ? BUILTIN_PACKS.find((candidate) => candidate.name === hook.pack) : undefined
    const builtin = pack?.hooks.some(
      (candidate) =>
        candidate.event === hook.event && candidate.command === hook.command && candidate.matcher === hook.matcher,
    )
    return builtin ? "pack" : "project"
  }

  function toEntry(hook: HookCommand, source: Entry["source"]): Entry {
    return {
      event: hook.event,
      command: hook.command,
      source,
      ...(hook.matcher === undefined ? {} : { matcher: hook.matcher }),
      ...(hook.protocol === undefined ? {} : { protocol: hook.protocol }),
      ...(hook.blockOnFailure === undefined ? {} : { blockOnFailure: hook.blockOnFailure }),
      ...(hook.pack === undefined ? {} : { pack: hook.pack }),
    }
  }

  function publishCompleted(
    hook: HookCommand,
    input: RunInput,
    result: RunResult["outputs"][number],
    durationMs: number,
    outcome: z.infer<typeof Event.Completed.properties>["outcome"],
    reason?: string,
  ) {
    try {
      Bus.publishDetached(Event.Completed, {
        ...(input.sessionID === undefined ? {} : { sessionID: input.sessionID }),
        event: input.event,
        ...(input.tool === undefined ? {} : { tool: input.tool }),
        command: Env.redactForRecord(hook.command),
        source: hookSource(hook),
        ...(hook.pack ? { pack: hook.pack } : {}),
        exit: result.exit,
        durationMs: Math.max(0, Math.round(durationMs)),
        outcome,
        ...(reason ? { reason: Env.redactForRecord(reason).slice(0, MAX_EVENT_REASON_CHARS) } : {}),
      })
    } catch (error) {
      // Observation only: a publish failure (for example outside an instance)
      // must never change the gate result.
      log.warn("hook.completed publish failed", { error: error instanceof Error ? error.message : String(error) })
    }
  }

  // Decode the stream incrementally: a StringDecoder carries a multi-byte
  // UTF-8 sequence split across pipe chunks and replaces genuinely invalid
  // bytes, so neither a split character nor a stray byte can wedge or drop the
  // rest of the capture. The byte cap is applied to the decoded text.
  function createCapture() {
    const decoder = new StringDecoder("utf8")
    let text = ""
    let full = false
    return {
      append(chunk: Buffer | string) {
        if (full) return
        text += typeof chunk === "string" ? chunk : decoder.write(chunk)
        if (Buffer.byteLength(text) > MAX_CAPTURE_BYTES) {
          text = truncateUtf8Bytes(text, MAX_CAPTURE_BYTES)
          full = true
        }
      },
      value() {
        // Once the cap cut the stream the decoder's leftover belongs to the
        // dropped tail; flushing it would exceed the cap with a stray U+FFFD.
        if (full) return text
        const tail = decoder.end()
        if (!tail) return text
        const combined = text + tail
        return Buffer.byteLength(combined) > MAX_CAPTURE_BYTES
          ? truncateUtf8Bytes(combined, MAX_CAPTURE_BYTES)
          : combined
      },
    }
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
    const stdout = createCapture()
    const stderr = createCapture()
    let timedOut = false
    let settled = false
    child.stdout.on("data", (chunk) => {
      stdout.append(chunk)
    })
    child.stderr.on("data", (chunk) => {
      stderr.append(chunk)
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
        // A hook whose descendant survives the kill (Windows: detached is false,
        // so only cmd.exe is killed; POSIX: a child that escaped the group) keeps
        // the inherited stdout/stderr pipes open, so 'close' never fires and this
        // promise — and the hook slot `runHook` holds in its finally — would hang
        // forever. Drop our pipe ends and settle at the timeout instead.
        child.stdout?.destroy()
        child.stderr?.destroy()
        child.stdin?.destroy()
        finish(124)
      }, hookTimeoutMs())
      timer.unref?.()
      child.once("error", (error) => {
        stderr.append(error instanceof Error ? error.message : String(error))
        finish(1)
      })
      child.once("close", (code, signal) => finish(timedOut ? 124 : (code ?? (signal ? 1 : 0))))
    })

    return { command: hook.command, exit, stdout: stdout.value(), stderr: stderr.value() }
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
    let rewrite: RunResult["rewrite"]
    const feedback: string[] = []
    let feedbackChars = 0
    for (const hook of selected) {
      let result: RunResult["outputs"][number]
      const startedAt = performance.now()
      try {
        result = await runHook(hook, { ...input, args: rewrite?.updatedInput ?? input.args })
      } catch (error) {
        // A hook that cannot even be spawned (an invalid command string, a
        // missing cwd) must not take the whole gate down: the tool gate
        // swallows a *thrown* hook failure, so letting it escape would discard
        // every block/ask already collected in this run and let the tool
        // through. Report it as the failed run it is — `blockOnFailure` and the
        // protocol decoder then see the same non-zero result they see for any
        // other failing hook.
        const message = error instanceof Error ? error.message : String(error)
        log.warn("lifecycle hook failed to run", { event: input.event, tool: input.tool, error: message })
        result = { command: hook.command, exit: 1, stdout: "", stderr: message }
      }
      outputs.push(result)
      const durationMs = performance.now() - startedAt
      if (input.event === "PostToolUse") {
        const text = decodePostToolUseFeedback(hook, result)
        if (text !== undefined) {
          const separator = feedback.length === 0 ? 0 : 2
          const room = MAX_FEEDBACK_CHARS_TOTAL - feedbackChars - separator
          if (room > 0) {
            const piece = text.length > room ? boundFeedback(text, room) : text
            if (piece.length > 0) {
              feedback.push(piece)
              feedbackChars += piece.length + separator
            }
          }
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
          publishCompleted(hook, input, result, durationMs, "blocked", decoded.reason)
          break
        }
        let rewritten = false
        if (input.event === "PreToolUse" && input.allowInputRewrite !== false && decoded.updatedInput !== undefined) {
          if ((rewrite?.hooks.length ?? 0) >= 3) {
            log.info("lifecycle hook rewrite limit reached", { event: input.event, tool: input.tool })
          } else {
            // Only the executable basename, never shell arguments, enters the audit.
            const executable = hook.command.trim().match(/^(?:"([^"]+)"|'([^']+)'|([^\s]+))/)
            const token = executable?.[1] ?? executable?.[2] ?? executable?.[3] ?? "hook"
            const name = /[=;&|<>$`(){}\r\n]/.test(token) ? "hook" : path.basename(token)
            rewrite = { updatedInput: decoded.updatedInput, hooks: [...(rewrite?.hooks ?? []), name] }
            rewritten = true
          }
        }
        if (decoded.ask) {
          // Only PreToolUse has an interactive permission channel where the
          // caller can honour `ask`; every other blockable event
          // (UserPromptSubmit) has none, so an `ask` must veto it here instead
          // of being dropped (docs/guides/hooks.md: ask still blocks there).
          if (input.event !== "PreToolUse") {
            blocked = true
            blockReason = decoded.reason ?? "hook requested user confirmation"
            publishCompleted(hook, input, result, durationMs, "blocked", blockReason)
            break
          }
          // Keep evaluating: a later hook may still deny, and deny wins.
          ask = ask ?? { reason: decoded.reason ?? "hook requested user confirmation" }
          if (result.exit !== 0) {
            log.warn("lifecycle hook non-zero", { event: input.event, tool: input.tool, exit: result.exit })
          }
          publishCompleted(
            hook,
            input,
            result,
            durationMs,
            rewritten ? "rewritten" : "ask",
            decoded.reason ?? "hook requested user confirmation",
          )
          continue
        }
        if (result.exit !== 0) {
          log.warn("lifecycle hook non-zero", { event: input.event, tool: input.tool, exit: result.exit })
        }
        publishCompleted(hook, input, result, durationMs, rewritten ? "rewritten" : result.exit === 0 ? "ok" : "failed")
        continue
      }
      if (result.exit !== 0) {
        log.warn("lifecycle hook non-zero", { event: input.event, tool: input.tool, exit: result.exit })
        if (hook.blockOnFailure && BLOCKABLE_EVENTS.has(input.event)) {
          blocked = true
          publishCompleted(hook, input, result, durationMs, "blocked")
          break
        }
      }
      publishCompleted(hook, input, result, durationMs, result.exit === 0 ? "ok" : "failed")
    }
    return {
      ok: !blocked,
      blocked,
      ...(blockReason === undefined ? {} : { blockReason }),
      ...(blocked || ask === undefined ? {} : { ask }),
      ...(blocked || rewrite === undefined ? {} : { rewrite }),
      ...(feedback.length === 0 ? {} : { feedback: feedback.join("\n\n") }),
      outputs,
    }
  }

  export async function runForWorkspace(input: RunInput & { packNames?: string[] }): Promise<RunResult> {
    const directory = input.cwd ?? Instance.directory
    const hooks = await resolveHooks({ directory, packNames: input.packNames })
    // Only PreToolUse can rewrite input, so only that event consults the config ceiling. Reading config for
    // observation events would change when configuration is first loaded for callers that never needed it.
    let allowInputRewrite = input.allowInputRewrite !== false
    if (allowInputRewrite && input.event === "PreToolUse") {
      const { Config } = await import("@/config/config")
      allowInputRewrite = (await Config.get()).hooks?.allow_input_rewrite !== false
    }
    return runHooks(hooks, { ...input, cwd: directory, allowInputRewrite })
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
}
