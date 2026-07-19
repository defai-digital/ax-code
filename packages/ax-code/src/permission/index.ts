import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Config } from "@/config/config"
import { AgentControlEvents } from "@/control-plane/agent-control-events"
import { SafetyPolicy } from "@/control-plane/safety-policy"
import { Recorder } from "@/replay/recorder"
import { ProjectID } from "@/project/schema"
import { Instance } from "@/project/instance"
import { MessageID, SessionID } from "@/session/schema"
import { PermissionTable } from "@/session/session.sql"
import { Database, eq } from "@/storage/db"
import { Log } from "@/util/log"
import { Wildcard } from "@/util/wildcard"
import { Filesystem } from "@/util/filesystem"
import os from "os"
import path from "path"
import z from "zod"
import { evaluate as evalRule } from "./evaluate"
import { classify as classifyRisk } from "./risk-classes"
import { PermissionID } from "./schema"
import { Flag } from "@/flag/flag"
import { ScopedFlag } from "@/flag/scoped"
import { ProjectConfigTrust } from "@/config/project-config-trust"
import { FileLock } from "@/util/filelock"

export namespace Permission {
  const log = Log.create({ service: "permission" })

  export const Action = z.enum(["allow", "deny", "ask"]).meta({
    ref: "PermissionAction",
  })
  export type Action = z.infer<typeof Action>

  export const Rule = z
    .object({
      permission: z.string(),
      pattern: z.string(),
      action: Action,
    })
    .meta({
      ref: "PermissionRule",
    })
  export type Rule = z.infer<typeof Rule>

  export const Ruleset = Rule.array().meta({
    ref: "PermissionRuleset",
  })
  export type Ruleset = z.infer<typeof Ruleset>

  export const Request = z
    .object({
      id: PermissionID.zod,
      sessionID: SessionID.zod,
      permission: z.string(),
      patterns: z.string().array(),
      metadata: z.record(z.string(), z.any()),
      always: z.string().array(),
      tool: z
        .object({
          messageID: MessageID.zod,
          callID: z.string(),
        })
        .optional(),
    })
    .meta({
      ref: "PermissionRequest",
    })
  export type Request = z.infer<typeof Request>

  export const Reply = z.enum(["once", "always", "reject"])
  export type Reply = z.infer<typeof Reply>

  export const Event = {
    Asked: BusEvent.define("permission.asked", Request),
    Replied: BusEvent.define(
      "permission.replied",
      z.object({
        sessionID: SessionID.zod,
        requestID: PermissionID.zod,
        reply: Reply,
      }),
    ),
  }

  export class RejectedError extends Error {
    override readonly name = "PermissionRejectedError"

    constructor(options?: ErrorOptions) {
      super("The user rejected permission to use this specific tool call.", options)
    }
  }

  export class CorrectedError extends Error {
    override readonly name = "PermissionCorrectedError"
    readonly feedback: string

    constructor(input: { feedback: string; options?: ErrorOptions }) {
      super(
        `The user rejected permission to use this specific tool call with the following feedback: ${input.feedback}`,
        input.options,
      )
      this.feedback = input.feedback
    }
  }

  function formatRulesetForDeniedError(ruleset: unknown) {
    const seen = new WeakSet<object>()
    try {
      return (
        JSON.stringify(ruleset, (_key, value) => {
          if (typeof value === "bigint") return value.toString()
          if (value && typeof value === "object") {
            if (seen.has(value)) return "[Circular]"
            seen.add(value)
          }
          return value
        }) ?? "undefined"
      )
    } catch {
      return "[Unserializable ruleset]"
    }
  }

  export class DeniedError extends Error {
    override readonly name = "PermissionDeniedError"
    readonly ruleset: unknown
    readonly agent?: string

    constructor(input: { ruleset: unknown; agent?: string; options?: ErrorOptions }) {
      const base = `The user has specified a rule which prevents you from using this specific tool call. Here are some of the relevant rules ${formatRulesetForDeniedError(input.ruleset)}`
      super(
        input.agent
          ? `${base}\n\nThis is because you are running as the "${input.agent}" agent, which is read-only and cannot modify files. You should inform the user that this task requires code changes, and suggest they switch to the Dev agent (press Tab or use @build).`
          : base,
        input.options,
      )
      this.ruleset = input.ruleset
      this.agent = input.agent
    }
  }

  export type Error = DeniedError | RejectedError | CorrectedError

  export const AskInput = Request.partial({ id: true }).extend({
    ruleset: Ruleset,
    agent: z.string().optional(),
  })

  export const ReplyInput = z.object({
    requestID: PermissionID.zod,
    reply: Reply,
    message: z.string().optional(),
  })

  interface PromiseDeferred<T> {
    promise: Promise<T>
    resolve(value: T): void
    reject(reason: unknown): void
  }

  interface PendingEntry {
    info: Request
    ruleset: Ruleset
    deferred: PromiseDeferred<void>
  }

  interface State {
    pending: Map<PermissionID, PendingEntry>
    approved: Ruleset
    // Captured at state init so the reply handler can persist the
    // updated `approved` array back to the database. Using
    // `Instance.project.id` at reply time would also work, but the
    // per-instance state is already scoped to a specific project so
    // capturing once is simpler and cannot drift.
    projectID: ProjectID
    // Per-instance mutex for "always" replies. Module-level storage would
    // needlessly serialize concurrent project instances (e.g. worktrees).
    alwaysReplyQueue: Promise<void>
  }

  const state = Instance.state(
    async () => {
      const row = Database.use((db) =>
        db.select().from(PermissionTable).where(eq(PermissionTable.project_id, Instance.project.id)).get(),
      )
      return {
        pending: new Map<PermissionID, PendingEntry>(),
        approved: row?.data ?? [],
        projectID: Instance.project.id,
        alwaysReplyQueue: Promise.resolve(),
      } satisfies State
    },
    async (state) => {
      for (const item of state.pending.values()) {
        item.deferred.reject(new RejectedError())
      }
      state.pending.clear()
    },
  )

  // Permissions that must always require interactive user confirmation
  // and cannot be auto-approved by wildcard rules or headless autonomous
  // auto-reply. This prevents agent default rules like
  // {permission:"*",action:"allow",pattern:"*"} and headless projection
  // from silently bypassing critical safety checks.
  export const INTERACTIVE_ONLY: ReadonlySet<string> = new Set(["isolation_escalation", "bash_destructive"])

  export function isInteractiveOnly(permission: string): boolean {
    return INTERACTIVE_ONLY.has(permission)
  }

  async function serializeAlwaysReply<T>(s: State, fn: () => Promise<T>) {
    const previous = s.alwaysReplyQueue
    let release!: () => void
    s.alwaysReplyQueue = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous.catch(() => {})
    try {
      return await fn()
    } finally {
      release()
    }
  }

  function createDeferred<T>(): PromiseDeferred<T> {
    let resolve!: (value: T) => void
    let reject!: (reason: unknown) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }

  function abortError(signal: AbortSignal): globalThis.Error {
    if (signal.reason instanceof globalThis.Error) return signal.reason
    const error = new globalThis.Error("The operation was aborted")
    error.name = "AbortError"
    return error
  }

  // Evaluates SafetyPolicy.decide for this request. Deny outcomes are
  // ENFORCED in autonomous mode for non-safe permission classes: a mutating
  // permission whose target matches a protected path throws before the
  // ruleset is consulted, so a wildcard allow rule cannot bypass it. Read
  // class permissions are exempt (denying reads of .env-shaped paths would
  // break routine context gathering; the write-side block is what protects
  // the secret). In normal (supervised) mode the decision remains advisory
  // telemetry — the user is present and the ask path retains final say.
  function enforceSafetyPolicy(request: Omit<z.infer<typeof AskInput>, "ruleset" | "agent">, agent?: string) {
    const tool = typeof request.metadata?.tool === "string" ? request.metadata.tool : undefined
    const decision = SafetyPolicy.decide({
      mode: ScopedFlag.autonomous() ? "autonomous" : "normal",
      permission: request.permission,
      tool,
      path: request.patterns[0],
      paths: request.patterns,
    })
    const enforced =
      decision.action === "deny" && ScopedFlag.autonomous() && classifyRisk(request.permission) !== "safe"
    if (Recorder.active(request.sessionID) && (decision.action !== "allow" || decision.checkpointRequired)) {
      Recorder.emit(
        AgentControlEvents.safetyDecided({
          sessionID: request.sessionID,
          messageID: request.tool?.messageID,
          action: decision.action,
          risk: decision.risk,
          reason: decision.reason,
          permission: request.permission,
          tool,
          path: request.patterns[0],
          checkpointRequired: decision.checkpointRequired,
          matchedRule: decision.matchedRule,
          shadow: !enforced,
        }),
      )
    }
    if (!enforced) return
    log.warn("safety policy denied permission", {
      permission: request.permission,
      patterns: request.patterns,
      reason: decision.reason,
      matchedRule: decision.matchedRule,
    })
    throw new DeniedError({
      ruleset: [
        {
          permission: request.permission,
          action: "deny",
          pattern: decision.matchedRule ?? "*",
          reason: decision.reason,
        },
      ],
      agent,
    })
  }

  async function askPromise(input: z.infer<typeof AskInput>, options?: { signal?: AbortSignal }): Promise<void> {
    const { approved, pending } = await state()
    const { ruleset, ...request } = input
    let needsAsk = false
    enforceSafetyPolicy(request, input.agent)

    for (const pattern of request.patterns) {
      const rule = evaluate(request.permission, pattern, ruleset, approved)
      log.info("evaluated", { permission: request.permission, pattern, action: rule })
      if (rule.action === "deny") {
        throw new DeniedError({
          ruleset: ruleset.filter((rule) => Wildcard.match(request.permission, rule.permission)),
          agent: input.agent,
        })
      }
      if (rule.action === "allow" && !INTERACTIVE_ONLY.has(request.permission)) continue
      needsAsk = true
    }

    if (!needsAsk) return

    // Autonomous mode: hybrid policy (ADR-004 / PRD v4.2.0).
    //   - SAFE permissions (read/glob/grep/list/...) auto-approve.
    //   - RISK permissions (edit/bash/webfetch/task/...)
    //     fall through to the existing ruleset/ask path so user-defined
    //     deny rules still apply and pre-approved patterns still match.
    //   - Unknown permissions ask by default so enforcement matches
    //     SafetyPolicy.decide(). Set
    //     `experimental.autonomous_strict_permission: false` only as an
    //     explicit compatibility escape hatch for the legacy allow behavior.
    //
    // When the isolation sandbox is set to `full-access` the user has
    // explicitly opted out of all restrictions. In that posture, risk-class
    // permissions are auto-approved so the sandbox toggle meaningfully
    // controls whether the agent runs without approval prompts.
    if (ScopedFlag.autonomous() && !INTERACTIVE_ONLY.has(request.permission)) {
      const riskClass = classifyRisk(request.permission)
      if (riskClass === "safe") {
        log.info("autonomous auto-approve (safe)", { permission: request.permission, patterns: request.patterns })
        return
      }
      if (Flag.AX_CODE_ISOLATION_MODE === "full-access" && riskClass === "risk") {
        log.info("autonomous auto-approve (risk, full-access sandbox)", {
          permission: request.permission,
          patterns: request.patterns,
        })
        return
      }
      if (riskClass === "unknown") {
        const strict = (await Config.get()).experimental?.autonomous_strict_permission !== false
        if (!strict) {
          log.warn("autonomous: unknown permission risk class allowed by compatibility config", {
            permission: request.permission,
          })
          return
        }
        log.info("autonomous: prompting unknown permission", { permission: request.permission })
        // fall through to ask path below
      } else {
        log.info("autonomous risk-class: falling through to ruleset", {
          permission: request.permission,
          patterns: request.patterns,
        })
        // fall through to ask path below
      }
    }

    const signal = options?.signal
    if (signal?.aborted) throw abortError(signal)

    const id = request.id ?? PermissionID.ascending()
    const info: Request = {
      id,
      ...request,
    }
    log.info("asking", { id, permission: info.permission, patterns: info.patterns })

    const deferred = createDeferred<void>()
    pending.set(id, { info, ruleset, deferred })

    const onAbort = () => {
      if (!pending.delete(id)) return
      // The ask died without a user decision (turn aborted, session
      // cancelled). Publish a reject reply so subscribed prompts (TUI,
      // desktop) unmount instead of lingering as an unanswerable dialog —
      // replies to a deleted pending entry are silent no-ops. See
      // .internal/bugs BUG-005.
      Bus.publishDetached(Event.Replied, {
        sessionID: info.sessionID,
        requestID: id,
        reply: "reject",
      })
      if (signal) deferred.reject(abortError(signal))
    }
    signal?.addEventListener("abort", onAbort, { once: true })
    if (signal?.aborted) {
      onAbort()
      return await deferred.promise
    }

    Bus.publishDetached(Event.Asked, info)
    if (Recorder.active(info.sessionID)) {
      Recorder.emit({
        type: "permission.ask",
        sessionID: info.sessionID,
        permission: info.permission,
        patterns: info.patterns,
        tool: typeof info.metadata?.tool === "string" ? info.metadata.tool : undefined,
      })
    }

    try {
      return await deferred.promise
    } finally {
      signal?.removeEventListener("abort", onAbort)
      pending.delete(id)
    }
  }

  // Returns whether the reply actually applied — false means the request was
  // already resolved (e.g. a prior reply from the same client, or a race
  // between two in-flight replies for the same requestID). Callers must
  // surface `false` as an error rather than the generic success response;
  // an unconditional success response on a no-op reply silently tells the
  // caller their choice took effect when it did not. See #341.
  async function replyPromise(input: z.infer<typeof ReplyInput>): Promise<boolean> {
    const s = await state()
    const { approved, pending, projectID } = s
    const existing = pending.get(input.requestID)
    if (!existing) return false

    const publishReply = (entry: PendingEntry, reply: z.infer<typeof ReplyInput>["reply"]) => {
      Bus.publishDetached(Event.Replied, {
        sessionID: entry.info.sessionID,
        requestID: entry.info.id,
        reply,
      })
      if (Recorder.active(entry.info.sessionID)) {
        Recorder.emit({
          type: "permission.reply",
          sessionID: entry.info.sessionID,
          permission: entry.info.permission,
          reply,
        })
      }
    }

    if (input.reply === "reject") {
      for (const [id, entry] of [...pending.entries()]) {
        if (entry.info.sessionID !== existing.info.sessionID) continue
        pending.delete(id)
        publishReply(entry, input.reply)
        entry.deferred.reject(input.message ? new CorrectedError({ feedback: input.message }) : new RejectedError())
      }
      return true
    }

    if (input.reply === "once") {
      pending.delete(input.requestID)
      publishReply(existing, input.reply)
      existing.deferred.resolve(undefined)
      return true
    }

    return serializeAlwaysReply(s, async () => {
      if (!pending.delete(input.requestID)) return false

      const rules = existing.info.always.map((pattern) => ({
        permission: existing.info.permission,
        pattern,
        action: "allow" as const,
      }))

      try {
        // The in-memory queue serializes replies in this instance; the file
        // lock also protects read-modify-write persistence across processes.
        using _permissionLock = await FileLock.acquire(`${Database.Path}.permissions`)
        const nextApproved = Database.transaction((db) => {
          const latest = db.select().from(PermissionTable).where(eq(PermissionTable.project_id, projectID)).get()
          const merged = [...(latest?.data ?? []), ...rules]
          db.insert(PermissionTable)
            .values({
              project_id: projectID,
              data: merged,
              time_created: Date.now(),
              time_updated: Date.now(),
            })
            .onConflictDoUpdate({
              target: PermissionTable.project_id,
              set: {
                data: merged,
                time_updated: Date.now(),
              },
            })
            .run()
          return merged
        })
        approved.splice(0, approved.length, ...nextApproved)
      } catch (error) {
        existing.deferred.reject(error)
        throw error
      }
      publishReply(existing, input.reply)
      existing.deferred.resolve(undefined)

      for (const [id, item] of pending.entries()) {
        if (item.info.sessionID !== existing.info.sessionID) continue
        const ok = item.info.patterns.every((pattern) => {
          if (INTERACTIVE_ONLY.has(item.info.permission)) return false
          return evaluate(item.info.permission, pattern, item.ruleset, approved).action === "allow"
        })
        if (!ok) continue
        pending.delete(id)
        Bus.publishDetached(Event.Replied, {
          sessionID: item.info.sessionID,
          requestID: item.info.id,
          reply: "always",
        })
        if (Recorder.active(item.info.sessionID)) {
          Recorder.emit({
            type: "permission.reply",
            sessionID: item.info.sessionID,
            permission: item.info.permission,
            reply: "always",
          })
        }
        item.deferred.resolve(undefined)
      }
      return true
    })
  }

  async function listPromise() {
    const pending = (await state()).pending
    return Array.from(pending.values(), (item) => item.info)
  }

  export function evaluate(permission: string, pattern: string, ...rulesets: Ruleset[]): Rule {
    log.debug("evaluate", { permission, pattern, ruleCount: rulesets.reduce((s, r) => s + r.length, 0) })
    return evalRule(permission, pattern, ...rulesets)
  }

  function expand(pattern: string): string {
    if (pattern.startsWith("~/")) return os.homedir() + pattern.slice(1)
    if (pattern === "~") return os.homedir()
    if (pattern.startsWith("$HOME/")) return os.homedir() + pattern.slice(5)
    if (pattern === "$HOME") return os.homedir()
    return pattern
  }

  export function fromConfig(permission: Config.Permission) {
    const ruleset: Ruleset = []
    // Validate each rule through the Zod schema so a typo in `action`
    // (e.g. "alow") fails loudly at config load instead of becoming a
    // silently-ignored rule whose match falls through to whatever the
    // next pattern says.
    const pushValidated = (candidate: { permission: string; pattern: string; action: unknown }) => {
      const parsed = Rule.safeParse(candidate)
      if (!parsed.success) {
        log.warn("ignoring invalid permission rule from config", {
          permission: candidate.permission,
          pattern: candidate.pattern,
          action: candidate.action,
          error: parsed.error.message,
        })
        return
      }
      ruleset.push(parsed.data)
    }
    for (const [key, value] of Object.entries(permission)) {
      if (typeof value === "string") {
        pushValidated({ permission: key, action: value, pattern: "*" })
        continue
      }
      for (const [pattern, action] of Object.entries(value)) {
        pushValidated({ permission: key, pattern: expand(pattern), action })
      }
    }
    return ruleset
  }

  export function merge(...rulesets: Ruleset[]): Ruleset {
    return rulesets.flat()
  }

  // R16: Local policy mode — .ax-code/policy.json
  const PolicyRule = z.object({
    agent: z.string().optional().default("*"),
    tools: z.string().array(),
    files: z.string().array().optional().default(["*"]),
    action: Action,
  })

  const PolicyFile = z.object({
    version: z.string(),
    name: z.string().optional(),
    rules: PolicyRule.array(),
  })
  type PolicyFile = z.infer<typeof PolicyFile>

  /** Convert a policy.json file into a Permission.Ruleset */
  export function fromPolicy(policy: PolicyFile, currentAgent?: string): Ruleset {
    const ruleset: Ruleset = []
    for (const rule of policy.rules) {
      if (rule.agent !== "*" && rule.agent !== currentAgent) continue
      for (const tool of rule.tools) {
        const permission = EDIT_TOOLS.includes(tool) ? "edit" : tool
        for (const file of rule.files) {
          ruleset.push({ permission, pattern: expand(file), action: rule.action })
        }
      }
    }
    return ruleset
  }

  /** Load policy from .ax-code/policy.json if it exists */
  export async function loadPolicy(directory: string, currentAgent?: string): Promise<Ruleset> {
    const filepath = path.join(directory, ".ax-code", "policy.json")
    try {
      const raw = await Filesystem.readJson(filepath)
      const policy = PolicyFile.parse(raw)
      const rules = fromPolicy(policy, currentAgent)
      if (ProjectConfigTrust.enabled()) {
        log.info("loaded trusted project policy", { name: policy.name, rules: rules.length, path: filepath })
        return rules
      }
      const restrictions = rules.filter((rule) => rule.action === "deny")
      if (restrictions.length !== rules.length) {
        log.warn("ignored permission grants from untrusted project policy", {
          name: policy.name,
          ignored: rules.length - restrictions.length,
          path: filepath,
          optIn: ProjectConfigTrust.ENV,
        })
      }
      return restrictions
    } catch (e) {
      const code = errnoCode(e)
      if (code === "ENOENT") return []
      if (code !== undefined) throw e
      log.warn("policy file malformed — all rules ignored until fixed", { path: filepath, error: e })
      return []
    }
  }

  function errnoCode(error: unknown) {
    if (typeof error !== "object" || error === null) return undefined
    const code = (error as { code?: unknown }).code
    return typeof code === "string" ? code : undefined
  }

  const EDIT_TOOLS = ["edit", "write", "apply_patch", "multiedit", "refactor_apply"]

  export function disabled(tools: string[], ruleset: Ruleset): Set<string> {
    const result = new Set<string>()
    for (const tool of tools) {
      const permission = EDIT_TOOLS.includes(tool) ? "edit" : tool
      // Intentional semantics: `disabled()` returns tools that are
      // FULLY denied (i.e. the last matching rule has a wildcard
      // pattern denying everything). A specific allow rule that
      // follows a wildcard deny means the tool is still usable for
      // that specific pattern, so it is shown as enabled in the UI
      // even though some pattern-specific calls will be rejected at
      // enforcement time. See test/permission-task.test.ts for the
      // codified behavior. BUG-18 from the audit was a false positive.
      const rule = ruleset.findLast((rule) => Wildcard.match(permission, rule.permission))
      if (!rule) continue
      if (rule.pattern === "*" && rule.action === "deny") result.add(tool)
    }
    return result
  }

  export async function ask(input: z.infer<typeof AskInput>, options?: { signal?: AbortSignal }) {
    return askPromise(input, options)
  }

  export async function reply(input: z.infer<typeof ReplyInput>) {
    return replyPromise(input)
  }

  export async function list() {
    return listPromise()
  }
}
