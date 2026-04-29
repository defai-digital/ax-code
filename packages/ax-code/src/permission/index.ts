import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Config } from "@/config/config"
import { Recorder } from "@/replay/recorder"
import { makeRunPromise } from "@/effect/run-service"
import { ProjectID } from "@/project/schema"
import { Instance } from "@/project/instance"
import { MessageID, SessionID } from "@/session/schema"
import { PermissionTable } from "@/session/session.sql"
import { Database, eq } from "@/storage/db"
import { Log } from "@/util/log"
import { Wildcard } from "@/util/wildcard"
import { Effect, Layer, Schema, ServiceMap } from "effect"
import os from "os"
import path from "path"
import z from "zod"
import { evaluate as evalRule } from "./evaluate"
import { classify as classifyRisk } from "./risk-classes"
import { PermissionID } from "./schema"

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

  export class RejectedError extends Schema.TaggedErrorClass<RejectedError>()("PermissionRejectedError", {}) {
    override get message() {
      return "The user rejected permission to use this specific tool call."
    }
  }

  export class CorrectedError extends Schema.TaggedErrorClass<CorrectedError>()("PermissionCorrectedError", {
    feedback: Schema.String,
  }) {
    override get message() {
      return `The user rejected permission to use this specific tool call with the following feedback: ${this.feedback}`
    }
  }

  export class DeniedError extends Schema.TaggedErrorClass<DeniedError>()("PermissionDeniedError", {
    ruleset: Schema.Any,
    agent: Schema.optional(Schema.String),
  }) {
    override get message() {
      const base = `The user has specified a rule which prevents you from using this specific tool call. Here are some of the relevant rules ${JSON.stringify(this.ruleset)}`
      if (!this.agent) return base
      return `${base}\n\nThis is because you are running as the "${this.agent}" agent, which is read-only and cannot modify files. You should inform the user that this task requires code changes, and suggest they switch to the Dev agent (press Tab or use @build).`
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

  export interface Interface {
    readonly ask: (input: z.infer<typeof AskInput>) => Effect.Effect<void, Error>
    readonly reply: (input: z.infer<typeof ReplyInput>) => Effect.Effect<void>
    readonly list: () => Effect.Effect<Request[]>
  }

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
  // and cannot be auto-approved by wildcard rules. This prevents agent
  // default rules like {permission:"*",action:"allow",pattern:"*"} from
  // silently bypassing critical safety checks.
  const INTERACTIVE_ONLY: ReadonlySet<string> = new Set(["isolation_escalation"])

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

  async function askPromise(input: z.infer<typeof AskInput>, options?: { signal?: AbortSignal }): Promise<void> {
    const { approved, pending } = await state()
    const { ruleset, ...request } = input
    let needsAsk = false

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
    //   - RISK permissions (edit/write/apply_patch/bash/network/...)
    //     fall through to the existing ruleset/ask path so user-defined
    //     deny rules still apply and pre-approved patterns still match.
    //   - Unknown permissions log a warning and default to allow,
    //     matching legacy behavior. Set
    //     `experimental.autonomous_strict_permission: true` to ask
    //     instead.
    if (process.env["AX_CODE_AUTONOMOUS"] === "true" && !INTERACTIVE_ONLY.has(request.permission)) {
      const riskClass = classifyRisk(request.permission)
      if (riskClass === "safe") {
        log.info("autonomous auto-approve (safe)", { permission: request.permission, patterns: request.patterns })
        return
      }
      if (riskClass === "unknown") {
        const strict = (await Config.get()).experimental?.autonomous_strict_permission === true
        if (!strict) {
          log.warn("autonomous: unknown permission risk class, defaulting to allow", {
            permission: request.permission,
          })
          return
        }
        log.info("autonomous strict mode: prompting unknown permission", { permission: request.permission })
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
      if (signal) deferred.reject(abortError(signal))
    }
    signal?.addEventListener("abort", onAbort, { once: true })
    if (signal?.aborted) onAbort()

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

  async function replyPromise(input: z.infer<typeof ReplyInput>) {
    const { approved, pending, projectID } = await state()
    const existing = pending.get(input.requestID)
    if (!existing) return

    pending.delete(input.requestID)
    Bus.publishDetached(Event.Replied, {
      sessionID: existing.info.sessionID,
      requestID: existing.info.id,
      reply: input.reply,
    })
    if (Recorder.active(existing.info.sessionID)) {
      Recorder.emit({
        type: "permission.reply",
        sessionID: existing.info.sessionID,
        permission: existing.info.permission,
        reply: input.reply,
      })
    }

    if (input.reply === "reject") {
      existing.deferred.reject(input.message ? new CorrectedError({ feedback: input.message }) : new RejectedError())

      for (const [id, item] of pending.entries()) {
        if (item.info.sessionID !== existing.info.sessionID) continue
        pending.delete(id)
        Bus.publishDetached(Event.Replied, {
          sessionID: item.info.sessionID,
          requestID: item.info.id,
          reply: "reject",
        })
        if (Recorder.active(item.info.sessionID)) {
          Recorder.emit({
            type: "permission.reply",
            sessionID: item.info.sessionID,
            permission: item.info.permission,
            reply: "reject",
          })
        }
        item.deferred.reject(new RejectedError())
      }
      return
    }

    existing.deferred.resolve(undefined)
    if (input.reply === "once") return

    for (const pattern of existing.info.always) {
      approved.push({
        permission: existing.info.permission,
        pattern,
        action: "allow",
      })
    }

    Database.use((db) =>
      db
        .insert(PermissionTable)
        .values({
          project_id: projectID,
          data: approved,
          time_created: Date.now(),
          time_updated: Date.now(),
        })
        .onConflictDoUpdate({
          target: PermissionTable.project_id,
          set: {
            data: approved,
            time_updated: Date.now(),
          },
        })
        .run(),
    )

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
  }

  async function listPromise() {
    const pending = (await state()).pending
    return Array.from(pending.values(), (item) => item.info)
  }

  export function evaluate(permission: string, pattern: string, ...rulesets: Ruleset[]): Rule {
    log.debug("evaluate", { permission, pattern, ruleCount: rulesets.reduce((s, r) => s + r.length, 0) })
    return evalRule(permission, pattern, ...rulesets)
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@ax-code/Permission") {}

  export const layer = Layer.effect(
    Service,
    Effect.sync(() => {
      const ask = Effect.fn("Permission.ask")((input: z.infer<typeof AskInput>) =>
        Effect.tryPromise({
          try: (signal) => askPromise(input, { signal }),
          catch: (error) => error as Error,
        }),
      )

      const reply = Effect.fn("Permission.reply")((input: z.infer<typeof ReplyInput>) =>
        Effect.promise(() => replyPromise(input)),
      )

      const list = Effect.fn("Permission.list")(() => Effect.promise(() => listPromise()))

      return Service.of({ ask, reply, list })
    }),
  )

  function expand(pattern: string): string {
    if (pattern.startsWith("~/")) return os.homedir() + pattern.slice(1)
    if (pattern === "~") return os.homedir()
    if (pattern.startsWith("$HOME/")) return os.homedir() + pattern.slice(5)
    if (pattern.startsWith("$HOME")) return os.homedir() + pattern.slice(5)
    return pattern
  }

  export function fromConfig(permission: Config.Permission) {
    const ruleset: Ruleset = []
    for (const [key, value] of Object.entries(permission)) {
      if (typeof value === "string") {
        ruleset.push({ permission: key, action: value, pattern: "*" })
        continue
      }
      ruleset.push(
        ...Object.entries(value).map(([pattern, action]) => ({ permission: key, pattern: expand(pattern), action })),
      )
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
      const file = Bun.file(filepath)
      if (!(await file.exists())) return []
      const raw = await file.json()
      const policy = PolicyFile.parse(raw)
      log.info("loaded policy", { name: policy.name, rules: policy.rules.length, path: filepath })
      return fromPolicy(policy, currentAgent)
    } catch (e) {
      log.error("failed to load policy", { path: filepath, error: e })
      return [{ permission: "*", pattern: "*", action: "deny" }]
    }
  }

  const EDIT_TOOLS = ["edit", "write", "apply_patch", "multiedit"]

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

  export const runPromise = makeRunPromise(Service, layer)

  export async function ask(input: z.infer<typeof AskInput>) {
    return askPromise(input)
  }

  export async function reply(input: z.infer<typeof ReplyInput>) {
    return replyPromise(input)
  }

  export async function list() {
    return listPromise()
  }
}
