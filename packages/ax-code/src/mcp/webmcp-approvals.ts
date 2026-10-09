import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import z from "zod"
import { Config } from "../config/config"
import { Global } from "../global"
import { Instance } from "../project/instance"
import { Filesystem } from "../util/filesystem"
import { FileLock } from "../util/filelock"
import { Lock } from "../util/lock"
import { McpTrust } from "./trust"
import { WebMcpProfile } from "./webmcp-profile"

export namespace WebMcpApprovals {
  const POLICY_VERSION = 1
  const MAX_RECORDS = 1024
  // @scan-suppress security_scan - the filename is a fixed literal under the user-owned XDG data directory; no request or repository value participates in this path.
  export const filepath = path.join(Global.Path.data, "webmcp-approvals.json")
  const Origin = z
    .string()
    .max(2048)
    .refine((value) => !value.includes("*") && WebMcpProfile.grantableOrigin(value) === value)
  export const Scope = z.discriminatedUnion("capability", [
    z.object({ capability: z.literal("list_pages") }).strict(),
    z.object({ capability: z.literal("navigate"), origin: Origin }).strict(),
    z.object({ capability: z.literal("read"), origin: Origin }).strict(),
    z.object({ capability: z.literal("close"), origin: Origin }).strict(),
  ])
  export type Scope = z.infer<typeof Scope>
  export const Summary = z
    .object({ server: z.string(), project: z.string(), scope: Scope })
    .strict()
    .meta({ ref: "WebMcpApprovalSummary" })
  export type Summary = z.infer<typeof Summary>
  export const Record = Summary.extend({
    id: z.string().regex(/^[a-f0-9]{64}$/),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    revision: z.string().uuid(),
    policyVersion: z.literal(POLICY_VERSION),
    createdAt: z.number().int().nonnegative(),
  })
    .strict()
    .meta({ ref: "WebMcpApprovalRecord" })
  export type Record = z.infer<typeof Record>
  const Store = z.object({ version: z.literal(1), records: Record.array().max(MAX_RECORDS) }).strict()
  type Store = z.infer<typeof Store>
  export type Candidate = Summary & {
    fingerprint: string
    profile: WebMcpProfile.Configuration
    admission?: { permission: string; patterns: string[] }
  }
  const candidates = new WeakMap<object, Candidate>()
  const reused = new WeakSet<object>()
  const calls = new WeakMap<object, Candidate>()
  const denialChecks = new WeakMap<object, () => Promise<void>>()
  const closeTargets = new WeakMap<object, { pageId: number; origin: string | undefined }>()
  const continuedReads = new WeakMap<object, { origin: string; check: () => Promise<void> }>()

  export function bindCloseTarget(call: { pageId: number }, origin: string | undefined) {
    closeTargets.set(call, { pageId: call.pageId, origin })
  }

  export function checkCloseTarget(call: object, pageId: number, origin: string | undefined) {
    const target = closeTargets.get(call)
    if (target && (target.pageId !== pageId || target.origin !== origin)) {
      throw new Error("WebMCP page changed after close approval; inspect list_pages before closing it")
    }
  }

  export function bindReadContinuation(call: object, origin: string, check: () => Promise<void>) {
    continuedReads.set(call, { origin, check })
  }

  export async function checkReadContinuation(call: object, origin: string) {
    const expected = continuedReads.get(call)
    if (expected && expected.origin !== origin) {
      throw new Error("WebMCP page changed while read approval was pending; request a fresh read")
    }
    await expected?.check()
  }

  // Only runtime code registers these object identities. Serialized metadata,
  // project configuration and page annotations cannot mint an approval.
  export function bind(
    metadata: object,
    candidate: Candidate | undefined,
    admission?: { permission: string; patterns: string[] },
  ) {
    if (candidate) candidates.set(metadata, admission ? { ...candidate, admission } : candidate)
    return metadata
  }
  export function candidate(metadata: object): Candidate | undefined {
    return candidates.get(metadata)
  }
  export function markReused(metadata: object) {
    reused.add(metadata)
  }
  export function usedSavedApproval(metadata: object) {
    return reused.has(metadata)
  }
  export function bindCall(call: object, metadata: object, checkDenials?: () => Promise<void>) {
    if (checkDenials) denialChecks.set(call, checkDenials)
    const found = candidates.get(metadata)
    if (found && reused.has(metadata)) calls.set(call, found)
  }

  function projectScope() {
    return Instance.project.id === "global" ? `directory:${Instance.directory}` : Instance.project.id
  }

  async function identity(server: string) {
    const cfg = await Config.get()
    const entry = cfg.mcp?.[server]
    if (!entry || !("type" in entry) || entry.type !== "local" || !entry.webmcp) return undefined
    const profile = WebMcpProfile.validateLaunch(entry)
    if (!profile) return undefined
    const normalized = { ...entry, ...WebMcpProfile.config(profile, entry.enabled) }
    return { cfg, fingerprint: McpTrust.fingerprint(server, normalized) }
  }

  export async function captureCall(policy: WebMcpProfile.Policy, call: { [key: string]: unknown }) {
    if (policy.toolName === "list_pages") return capture(policy, { capability: "list_pages" })
    const target = closeTargets.get(call)
    if (policy.toolName === "close_page" && target?.origin && target.pageId === call.pageId) {
      return capture(policy, { capability: "close", origin: target.origin })
    }
    if (["new_page", "navigate_page"].includes(policy.toolName) && typeof call.url === "string") {
      const origin = WebMcpProfile.grantableOrigin(call.url)
      if (origin) return capture(policy, { capability: "navigate", origin })
    }
    return undefined
  }

  export async function capture(policy: WebMcpProfile.Policy, scope: Scope): Promise<Candidate | undefined> {
    const parsed = Scope.safeParse(scope)
    if (!parsed.success || !WebMcpProfile.allows(policy.toolName, policy.profile)) return undefined
    if (scope.capability === "list_pages" && policy.toolName !== "list_pages") return undefined
    if (scope.capability === "navigate" && !["new_page", "navigate_page"].includes(policy.toolName)) return undefined
    if (scope.capability === "close" && policy.toolName !== "close_page") return undefined
    if (
      scope.capability === "read" &&
      ![...WebMcpProfile.READ_SCOPE_TOOLS, "wait_for"].some((tool) => tool === policy.toolName)
    )
      return undefined
    const found = await identity(policy.server)
    if (!found) return undefined
    const value: Candidate = {
      server: policy.server,
      project: projectScope(),
      scope: parsed.data,
      fingerprint: found.fingerprint,
      profile: policy.profile,
    }
    return (await valid(value)) ? value : undefined
  }

  export async function valid(value: Candidate): Promise<boolean> {
    if (value.project !== projectScope()) return false
    const found = await identity(value.server)
    if (!found || found.fingerprint !== value.fingerprint) return false
    const { MCP } = await import("./impl")
    if (!(await MCP.matchesWebMcpProfile(value.server, value.profile, value.fingerprint))) return false
    const decision = WebMcpProfile.evaluate(found.cfg.webmcp, value.profile)
    if (!decision.ok) return false
    if (value.scope.capability === "list_pages") return true
    const { origin } = value.scope
    if (WebMcpProfile.restricted(decision.profile) && !decision.profile.allowedOrigins.includes(origin)) return false
    if (value.scope.capability === "read" && !decision.profile.read) return false
    return true
  }

  function key(value: Candidate) {
    return createHash("sha256")
      .update(JSON.stringify([POLICY_VERSION, value.project, value.server, value.fingerprint, value.scope]))
      .digest("hex")
  }

  async function read(): Promise<Store> {
    const stat = await fs.stat(filepath).catch((error) => {
      if (Filesystem.isEnoent(error)) return undefined
      throw error
    })
    if (!stat) return { version: 1, records: [] }
    if (stat.size > 4 * 1024 * 1024) throw new Error("WebMCP approval store exceeds its size limit")
    return Store.parse(await Filesystem.readJson<unknown>(filepath))
  }

  export async function allowed(value: Candidate): Promise<boolean> {
    if (!(await valid(value))) return false
    const id = key(value)
    return (await read()).records.some((record) => record.id === id)
  }

  export async function checkCall(call: object) {
    await denialChecks.get(call)?.()
    const found = calls.get(call)
    if (
      found?.scope.capability === "navigate" &&
      WebMcpProfile.grantableOrigin((call as { url: string }).url) !== found.scope.origin
    ) {
      throw new Error("WebMCP navigation destination changed after approval")
    }
    if (found && !(await allowed(found))) {
      throw new Error("Saved WebMCP approval is no longer valid; retry for a fresh approval")
    }
  }

  export async function save(
    value: Candidate,
    active: () => boolean,
    accept?: () => void,
    authorize?: () => Promise<void>,
  ) {
    using _lock = await Lock.write(filepath)
    using _fileLock = await FileLock.acquire(filepath)
    if (!active() || !(await valid(value))) throw new Error("WebMCP approval request is no longer valid")
    const store = await read()
    const id = key(value)
    const record = Record.parse({
      server: value.server,
      project: value.project,
      scope: value.scope,
      id,
      fingerprint: value.fingerprint,
      revision: randomUUID(),
      policyVersion: POLICY_VERSION,
      createdAt: Date.now(),
    })
    const next = Store.parse({ version: 1, records: [...store.records.filter((row) => row.id !== id), record] })
    await authorize?.()
    if (!active()) throw new Error("WebMCP approval request was canceled")
    await Filesystem.writeJson(filepath, next, 0o600)
    // Keep the store lock through cancellation rollback, so an unrelated
    // writer cannot replace this revision between the write and rollback.
    try {
      await authorize?.()
      if (!active() || !(await valid(value))) throw new Error("WebMCP approval request was canceled")
      accept?.()
      return record
    } catch (error) {
      await Filesystem.writeJson(filepath, store, 0o600)
      throw error
    }
  }

  export async function list(server: string): Promise<Record[]> {
    return (await read()).records.filter((record) => record.project === projectScope() && record.server === server)
  }

  export async function remove(server: string, id?: string) {
    using _lock = await Lock.write(filepath)
    using _fileLock = await FileLock.acquire(filepath)
    const store = await read()
    store.records = store.records.filter(
      (record) =>
        !(record.project === projectScope() && record.server === server && (id === undefined || record.id === id)),
    )
    await Filesystem.writeJson(filepath, store, 0o600)
  }
}
